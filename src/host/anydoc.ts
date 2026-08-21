/**
 * 用 @firecrawl/anydoc 解析文档 + 纯扫描 PDF 的 PyMuPDF 兜底。
 */
import { formatFromPath, toDocument, toMarkdown, toMarkdownBytes } from '@firecrawl/anydoc'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import { basename, join } from 'node:path'
import { messageOf } from '../common/index.js'
import { imageBudget, docChars, DEFAULT_DESCRIBE_PROMPT } from './config.js'
import { extnameOfMedia, describeImageCached } from './describe.js'
import { sanitizeName, uploadsImagesDir } from './paths.js'
import { createLimiter } from './limiter.js'
import { debugLog } from './logger.js'
import { truncateLong } from './text.js'

/* ═══════════════════════════════════════════════════════════════════
 * 纯扫描/纯图片 PDF 兜底：anydoc 转不出文本时，用 Python(PyMuPDF) 把每页
 * 渲染为 PNG，交给多模态模型逐页识别（纯 JS 提取器已弃用，PyMuPDF 为唯一兜底）。
 * ═══════════════════════════════════════════════════════════════════ */
/** 用 Python(PyMuPDF) 把 PDF 每页渲染为 PNG——当 anydoc 转不出文本时的兜底。 */
async function renderPdfPagesWithPymupdf(filePath: string): Promise<Array<{ data: Buffer; mediaType: string; page: number }>> {
    const script = [
        'import sys',
        'try:',
        '    import pymupdf as fitz',
        'except Exception:',
        '    try:',
        '        import fitz',
        '    except Exception:',
        '        print("__PYMUPDF_MISSING__", file=sys.stderr)',
        '        sys.exit(3)',
        'doc = fitz.open(sys.argv[1])',
        'for i, page in enumerate(doc):',
        '    pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))',
        '    print("__PAGE__%d__" % i, file=sys.stderr)',  // 页面标记只走 stderr，避免污染二进制 stdout
        '    sys.stdout.buffer.write(b"PDFIMG:" + pix.tobytes("png"))',
        '    sys.stdout.buffer.flush()',
        'sys.stdout.buffer.flush()',
    ].join('\n')
    let output: string | Buffer = ''
    let meta = ''
    await new Promise<void>((resolveRun, rejectRun) => {
        const child = spawn('python', ['-c', script, filePath], { stdio: ['ignore', 'pipe', 'pipe'] })
        const outBuf: Buffer[] = []
        child.stdout.on('data', (chunk: Buffer) => {
            outBuf.push(chunk)
        })
        child.stderr.on('data', (chunk: Buffer) => {
            meta += chunk.toString('utf8')
        })
        child.on('error', rejectRun)
        child.on('close', () => {
            output = Buffer.concat(outBuf)
            resolveRun()
        })
    })
    if (meta.includes('__PYMUPDF_MISSING__')) throw new Error('pymupdf 未安装')
    const pages: Array<{ data: Buffer; mediaType: string; page: number }> = []
    const body = Buffer.from(output)
    // 解析 "PDFIMG:" 分隔
    const marker = 'PDFIMG:'
    const markerBuf = Buffer.from(marker, 'latin1')
    let idx = 0
    while (idx < body.length) {
        const pos = body.indexOf(markerBuf, idx)
        if (pos < 0) break
        const start = pos + markerBuf.length
        const next = body.indexOf(markerBuf, start)
        const end = next < 0 ? body.length : next
        const png = body.subarray(start, end)
        if (png.length > 0) pages.push({ data: Buffer.from(png), mediaType: 'image/png', page: pages.length + 1 })
        idx = end
    }
    return pages
}

/**
 * 纯扫描/纯图片 PDF 的多模态兜底：anydoc 转不出文本时，用 PyMuPDF 把每页渲染为 PNG，
 * 交给多模态模型逐页识别（不依赖任何 PDF 解析库的图片提取，PyMuPDF 是唯一兜底通道）。
 */
async function describePdfFallback(cfg: Record<string, any>, filePath: string): Promise<{ images: Array<{ data: Buffer; mediaType: string; page: number }>; errors: string[]; source?: string }> {
    const errors: string[] = []
    try {
        const pages = await renderPdfPagesWithPymupdf(filePath)
        if (pages.length > 0) return { images: pages, errors: [], source: 'pymupdf' as string }
        errors.push('pymupdf 未渲染出页面')
    } catch (error) {
        errors.push('pymupdf 渲染失败：' + messageOf(error))
    }
    return { images: [], errors }
}

/**
 * 用 @firecrawl/anydoc 解析文档。要点（对照 anydoc 0.1.9 API）：
 * - toMarkdownBytes(bytes, format) 对所有格式（含 PDF）都能转 Markdown；
 * - toDocument(bytes, format) 返回 Document.assets（内嵌图片字节），但 PDF 不支持（仅 Markdown 直出）；
 * - formatFromPath 识别格式并显式传给上面两个函数（CSV 等无签名的格式必须显式命名）；
 * - 任一步失败都容错降级，绝不因"含图片/无法转换"而整体报错：文本拿不到就只描述内嵌图片，
 *   图片描述失败只记录该图片错误，都不会中断整份文档的解析。
 */
async function processDocument(
    ctx: any,
    cfg: Record<string, any>,
    cwd: string,
    filePath: string,
    fileName: string,
    limitImages?: number,
    onProgress?: (patch: { stage: string; detail: string; done: number; total: number }) => void,
): Promise<{ markdown: string; images: Array<Record<string, any>>; truncated: boolean; textError?: string }> {
    const imagesDir = uploadsImagesDir(cwd)
    const bytes = await fs.readFile(filePath)
    const fmt = typeof formatFromPath === 'function' ? formatFromPath(filePath) : undefined
    const isPdf = fmt === 'pdf'
    onProgress?.({ stage: 'doc', detail: '正在解析文档...', done: 0, total: 1 })

    // 1) 文档模型 + 内嵌图片（PDF 无文档模型，跳过）
    let assets: any[] = []
    if (!isPdf) {
        try {
            const document = await toDocument(bytes, fmt ?? undefined)
            assets = Array.isArray(document?.assets) ? document.assets : []
        } catch (error) {
            debugLog('toDocument failed for', filePath, messageOf(error))
        }
    }

    // 2) Markdown：优先 toMarkdownBytes（字节 → Markdown，含 PDF），失败回退 toMarkdown(path)
    let markdownRaw = ''
    let mdError: unknown = undefined
    try {
        markdownRaw = await toMarkdownBytes(bytes, fmt ?? undefined)
    } catch (error) {
        mdError = error
    }
    if (typeof markdownRaw !== 'string' || markdownRaw === '') {
        try {
            markdownRaw = await toMarkdown(filePath)
        } catch (error) {
            mdError = mdError ?? error
        }
    }
    markdownRaw = String(markdownRaw || '')

    // 图片识别结果统一收集（PDF 兜底图片 + anydoc 内嵌图片）
    const savedImages: Array<Record<string, any>> = []

    // 2.5) anydoc 支持格式解析失败时的多模态兜底：
    //      - PDF：Markdown 失败/空文本时用 PyMuPDF 逐页渲染 PNG 识别；
    //      - 非 PDF：文档 Markdown 失败时，下方第 3 步会把 toDocument 的图片交给多模态识别。
    const mdLooksUnsupported = markdownRaw === ''
        || mdError !== undefined
        || /unsupported|OCR|no extractable text|scanned/i.test(markdownRaw)
    if (isPdf && mdLooksUnsupported) {
        try {
            const fallback = await describePdfFallback(cfg, filePath)
            if (fallback.images.length > 0) {
                const budget = imageBudget(cfg, limitImages)
                const chosen = fallback.images.slice(0, budget)
                const limitPdf = createLimiter(cfg.concurrency || 1)
                /* 并行识别完成顺序不定，必须按 index（=页码顺序）对齐收集后再拼装，保证扫描件页序不乱。 */
                const pdfResults = new Array(chosen.length)
                await Promise.all(chosen.map(async (img, index) => {
                    try {
                        const ext = img.mediaType === 'image/jpeg' ? '.jpg' : '.png'
                        const stamp = randomUUID().slice(0, 8)
                        const base = sanitizeName(fileName).replace(/\.[^.]+$/, '')
                        const assetPath = join(imagesDir, base + '-pdf-' + stamp + '-' + (index + 1) + ext)
                        await fs.mkdir(imagesDir, { recursive: true })
                        await fs.writeFile(assetPath, img.data)
                        onProgress?.({ stage: 'image', detail: '识别扫描页 ' + (index + 1) + '/' + chosen.length, done: index + 1, total: chosen.length })
                        const description = await limitPdf(() => describeImageCached(ctx, cfg, assetPath, cfg.describePrompt || DEFAULT_DESCRIBE_PROMPT))
                        pdfResults[index] = {
                            path: assetPath,
                            name: basename(assetPath),
                            mediaType: img.mediaType,
                            description,
                            pdfPage: img.page,
                        }
                    } catch (error) {
                        pdfResults[index] = {
                            path: undefined,
                            name: 'pdf-page-' + (index + 1),
                            mediaType: img.mediaType,
                            error: messageOf(error),
                        }
                    }
                }))
                for (const entry of pdfResults) savedImages.push(entry)
            }
        } catch (error) {
            debugLog('PDF 图片兜底失败：' + messageOf(error))
        }
    }

    // 3) 提取并识别内嵌图片（单独保存到 uploads/images/，交给多模态模型）
    const limit = createLimiter(cfg.concurrency || 1)
    const budget = imageBudget(cfg, limitImages)
    const candidates = assets.filter((asset: any) => {
        const mt = String(asset.mediaType || '').toLowerCase()
        return mt.startsWith('image/') && Buffer.isBuffer(asset.data) && asset.data.length > 0
    })
    const chosen = candidates.slice(0, budget)
    /* 保持文档内嵌图片原有顺序：并行识别后按索引对齐再拼装。 */
    const imageResults = new Array(chosen.length)
    await Promise.all(chosen.map(async (asset: any, index: number) => {
        try {
            const ext = extnameOfMedia(asset.mediaType)
            const stamp = randomUUID().slice(0, 8)
            const base = sanitizeName(fileName).replace(/\.[^.]+$/, '')
            const assetPath = join(imagesDir, base + '-' + stamp + '-' + (index + 1) + ext)
            await fs.mkdir(imagesDir, { recursive: true })
            await fs.writeFile(assetPath, asset.data)
            onProgress?.({ stage: 'image', detail: '识别内嵌图片 ' + (index + 1) + '/' + chosen.length, done: index + 1, total: chosen.length })
            const description = await limit(() => describeImageCached(ctx, cfg, assetPath, cfg.describePrompt || DEFAULT_DESCRIBE_PROMPT))
            imageResults[index] = { path: assetPath, name: basename(assetPath), mediaType: asset.mediaType, description }
        } catch (error) {
            imageResults[index] = {
                path: undefined,
                name: 'image-' + (index + 1),
                mediaType: asset.mediaType,
                error: messageOf(error),
            }
        }
    }))
    for (const entry of imageResults) savedImages.push(entry)

    // 4) 组装最终文本：Markdown（失败则说明原因）+ 内嵌图片识别结果
    const maxChars = docChars(cfg)
    let body = ''
    if (markdownRaw !== '') {
        body = truncateLong(markdownRaw, maxChars).body
    } else if (savedImages.length > 0) {
        body = '（该文档文本内容无法提取，已提取其中 ' + savedImages.length + ' 张图片并识别如下；文件绝对路径：' + filePath + '）'
    } else {
        body = '（该文档无法解析出文本内容，文件已保存，绝对路径：' + filePath + '）'
    }
    const textError = mdError !== undefined ? messageOf(mdError).slice(0, 300) : undefined
    if (textError !== undefined) {
        body += '\n\n【解析提示】文本转换未成功：' + textError + '（内容可能仍包含图片，见下方识别结果）'
    }
    if (savedImages.length > 0) {
        const imageSection = savedImages.map((img, i) => {
            if (img.error !== undefined) return '- 图片 ' + (i + 1) + '：识别失败（' + img.error + '）'
            const pageTag = img.pdfPage !== undefined ? '（PDF 第 ' + img.pdfPage + ' 页）' : ''
            return '- 图片 ' + (i + 1) + pageTag + '（' + img.name + '）：' + img.description
        }).join('\n')
        body += '\n\n【文档内嵌图片识别结果】\n' + imageSection
    }
    return { markdown: body, images: savedImages, truncated: markdownRaw.length > maxChars, textError }
}

export { renderPdfPagesWithPymupdf, describePdfFallback, processDocument }
