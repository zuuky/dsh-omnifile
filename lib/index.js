/**
 * dsh-omnifile — 全文件适配插件（Host 端）
 *
 * 整合 dsh-file-upload / dsh-plugin-anydoc / dsh-vision-toolkit：
 * 1. POST /api/omnifile/save     保存浏览器上传的本地文件到会话 uploads/，返回绝对路径
 * 2. POST /api/omnifile/process   用 @firecrawl/anydoc 解析文档，提取内嵌图片交给多模态模型识别，组合结果
 * 3. POST /api/omnifile/describe  单张图片交给多模态模型识别
 * 4. GET  /api/omnifile/file      会话内文件预览/缩略图（仅允许会话 uploads 与工作区内的路径）
 * 5. 变体提供商 omnifile-<upstream>：把文本-only 主模型的图片块改写为多模态模型生成的文字描述（wire-only）
 * 6. 注册 omnifile 工具：主模型可自行解析本地文件
 *
 * 多模态模型采用 OpenAI 兼容 chat/completions 协议，配置位于 settings 的 omnifile 命名空间。
 */

import {defineTool} from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import {formatFromPath, toDocument, toMarkdown, toMarkdownBytes} from '@firecrawl/anydoc'
import fs from 'node:fs/promises'
import {createHash, randomUUID} from 'node:crypto'
import {basename, extname, join, resolve, sep} from 'node:path'
import {spawn} from 'node:child_process'
import {contentHasImage, LlmAdapter} from '@deepseek-ai/dsh-llm'
import {credentialRef} from '@deepseek-ai/dsh-credentials'

export const name = 'dsh-omnifile'
export const inject = ['webServer', 'sessions', 'tools', 'settings', 'credentials', 'llm']

const NAMESPACE = 'omnifile'
const VARIANT_PREFIX = 'omnifile-'
const VARIANT_SUFFIX = ' (Omnifile)'

const DEFAULT_BASE_URL = 'http://10.218.230.4:8015/v1'
const DEFAULT_CREDENTIAL = 'VISION_API_KEY'
const DEFAULT_MODEL = 'general-model'

const MAX_BODY_BYTES = 48 * 1024 * 1024
const MAX_SAVE_BASE64 = 44 * 1024 * 1024

const DESCRIBE_SYSTEM = [
    '你是图像识别助手。用户消息包含一张图片，请客观、详尽地描述它的全部内容，供一个无法查看图片的 AI 助手使用。要求：',
    '1. 完整转写图片中出现的所有文字（代码、报错、日志、界面文案等按原样转写，保留换行与缩进）。',
    '2. 描述界面布局、图表结构、颜色和其他显著视觉元素。',
    '3. 只陈述图片中可见的信息，不要推测或评价。',
    '使用与图片中文字相同的语言作答；图片没有文字时使用中文。',
].join('\n')

export const Config = z.object({
    provider: z.object({
        baseUrl: z.string().default(DEFAULT_BASE_URL).description('多模态模型的 OpenAI 兼容 API 地址（含 /v1）'),
        credential: z.string().default(DEFAULT_CREDENTIAL).description('多模态模型的 API Key（DSH credential 引用或环境变量名）'),
        model: z.string().default(DEFAULT_MODEL).description('多模态模型名称'),
        reasoningEffort: z.string().default('medium').description('启用思考模式时发送的 reasoning_effort 值'),
    }),
    thinking: z.boolean().default(false).description('是否启用多模态模型的思考模式（默认禁止）'),
    describePrompt: z.string().default('请按要求描述这张图片。').description('发送给多模态模型识图时的固定提问'),
    enableVariants: z.boolean().default(true).description('为文本-only 主模型注册 omnifile-* 图像变体提供商'),
    timeoutMs: z.number().default(60000).description('单次多模态调用的超时（毫秒）'),
    maxFileBytes: z.number().default(50 * 1024 * 1024).description('单个上传文件大小上限'),
    maxDocImages: z.number().default(8).description('单个文档最多交给多模态识别的内嵌图片数'),
    docMaxChars: z.number().default(120000).description('文档转 Markdown 后保留的最大字符数（超出部分截断）'),
    concurrency: z.number().default(1).description('调用多模态模型的并发数（默认 1）'),
})

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.svg', '.avif'])
/* anydoc 支持格式（权威来源 = anydoc 的 formatFromPath）：
 * doc/docx/odt/pdf/ppt/pptx/rtf/epub/xlsx/ods/odp/csv 及其容器变体（docm/xlsm/ppsx…）。 */
const TEXT_EXTENSIONS = new Set(['.json', '.txt', '.md', '.html', '.shtml'])
const MEDIA_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac', '.wma', '.mp4', '.mkv', '.webm', '.mov', '.avi', '.flv', '.wmv', '.m4v', '.mpg', '.mpeg', '.3gp', '.ts'])
const MIME_BY_EXT = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
    '.gif': 'image/gif', '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.avif': 'image/avif',
}

function fileKind(name) {
    const ext = extname(name).toLowerCase()
    if (IMAGE_EXTENSIONS.has(ext)) return 'image'
    /* doc 判定以 anydoc 的 formatFromPath 为唯一权威：返回非 null 即 anydoc 支持 */
    if (typeof formatFromPath === 'function') {
        try {
            if (formatFromPath(name) !== null) return 'doc'
        } catch { /* 忽略，走其余分类 */
        }
    }
    if (DOC_EXTENSIONS_FALLBACK.has(ext)) return 'doc'
    if (TEXT_EXTENSIONS.has(ext)) return 'text'
    if (MEDIA_EXTENSIONS.has(ext)) return 'media'
    return 'other'
}

/* 兜底扩展名集（仅当 formatFromPath 不可用时使用；与 anydoc Format 枚举一致） */
const DOC_EXTENSIONS_FALLBACK = new Set(['.doc', '.docx', '.docm', '.ppt', '.pps', '.pot', '.pptx', '.pptm', '.ppsx', '.ppsm', '.xls', '.xlsx', '.xlsm', '.xlsb', '.odt', '.ods', '.odp', '.rtf', '.epub', '.csv', '.pdf'])

function mimeFor(path) {
    const ext = extname(path).toLowerCase()
    return MIME_BY_EXT[ext] ?? 'application/octet-stream'
}

function sanitizeName(name) {
    const base = String(name || '').split(/[\\/]/).pop() || ''
    const cleaned = base
        .replace(/[^\w\u4e00-\u9fa5.\- ]/gu, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/[. ]+$/, '')
    if (cleaned === '' || cleaned === '.' || cleaned === '..') return 'file'
    return cleaned.slice(0, 120)
}

async function sessionCwd(ctx, sessionId) {
    const session = typeof sessionId === 'string' && sessionId !== '' ? ctx.sessions.get(sessionId) : undefined
    const cwd = session?.header?.cwd
    if (typeof cwd !== 'string' || cwd === '') throw new Error('当前会话没有工作目录')
    return cwd
}

/**
 * 从工具执行上下文解析当前会话工作目录。
 * DSH 的工具运行时把所属 agent 放在 exec.agent（ToolRunContext），
 * 会话 cwd 位于 exec.agent.session.header.cwd —— 这是官方推荐的获取方式；
 * 较旧的运行时可能把 session 直接挂在 exec 上，这里做兼容兜底。
 * 取不到时抛「当前会话没有工作目录」（与 sessionCwd 一致）。
 */
function agentCwd(exec) {
    const cwd = exec?.agent?.session?.header?.cwd
        ?? exec?.agent?.session?.cwd
        ?? exec?.session?.header?.cwd
        ?? exec?.cwd
    if (typeof cwd !== 'string' || cwd === '') throw new Error('当前会话没有工作目录')
    return cwd
}

function assertWorkspacePath(cwd, rawPath) {
    if (typeof rawPath !== 'string' || rawPath === '') throw new Error('缺少文件路径')
    const target = resolve(rawPath)
    const root = resolve(cwd) + sep
    if (target !== resolve(cwd) && !target.startsWith(root)) throw new Error('路径不在会话工作区内')
    return target
}

function readBody(req, maxBytes) {
    return new Promise((resolveBody, reject) => {
        const chunks = []
        let total = 0
        let aborted = false
        req.on('data', (chunk) => {
            total += chunk.length
            if (total > maxBytes) {
                aborted = true
                req.destroy()
                reject(new Error('request body too large'))
                return
            }
            chunks.push(chunk)
        })
        req.on('end', () => {
            if (aborted) return
            try {
                resolveBody(Buffer.concat(chunks))
            } catch (error) {
                reject(error)
            }
        })
        req.on('error', reject)
    })
}

function writeJson(res, status, body) {
    res.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'})
    res.end(JSON.stringify(body))
}

async function readJsonBody(req) {
    const buf = await readBody(req, MAX_BODY_BYTES)
    try {
        return buf.length === 0 ? {} : JSON.parse(buf.toString('utf8'))
    } catch {
        throw new Error('请求体不是有效 JSON')
    }
}

function messageOf(error) {
    return error instanceof Error ? error.message : String(error)
}

async function resolveApiKey(ctx, credential) {
    try {
        const ref = credentialRef(String(credential || '').trim())
        const resolved = await ctx.credentials.resolve(ref)
        const key = resolved?.key
        return typeof key === 'string' ? key : ''
    } catch {
        return ''
    }
}

async function describeImage(ctx, cfg, imagePath, prompt) {
    const apiKey = await resolveApiKey(ctx, cfg.provider.credential)
    const baseUrl = String(cfg.provider.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '')
    const data = await fs.readFile(imagePath)
    const mime = mimeFor(imagePath)
    const body = {
        model: cfg.provider.model || DEFAULT_MODEL,
        messages: [
            {role: 'system', content: DESCRIBE_SYSTEM},
            {
                role: 'user',
                content: [
                    {type: 'image_url', image_url: {url: 'data:' + mime + ';base64,' + data.toString('base64')}},
                    {type: 'text', text: prompt || cfg.describePrompt || '请按要求描述这张图片。'},
                ],
            },
        ],
        stream: false,
        max_tokens: 2048,
    }
    const thinking = cfg.thinking === true
    body.reasoning_effort = thinking ? (cfg.provider.reasoningEffort || 'medium') : 'none'
    body.chat_template_kwargs = {enable_thinking: thinking}
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs || 60000)
    try {
        const response = await fetch(baseUrl + '/chat/completions', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                ...(apiKey !== '' ? {authorization: 'Bearer ' + apiKey} : {}),
            },
            body: JSON.stringify(body),
            signal: controller.signal,
        })
        if (!response.ok) {
            const detail = (await response.text().catch(() => '')).slice(0, 500)
            throw new Error('多模态模型请求失败 HTTP ' + response.status + ': ' + detail)
        }
        const json = await response.json()
        const contentValue = json?.choices?.[0]?.message?.content
        const text = Array.isArray(contentValue) ? contentValue.map((part) => part?.text ?? '').join('') : contentValue
        const trimmed = String(text ?? '').trim()
        if (trimmed === '') throw new Error('多模态模型返回空内容')
        return trimmed
    } finally {
        clearTimeout(timer)
    }
}

function createLimiter(limit) {
    const max = Math.max(1, Math.floor(Number(limit) || 1))
    let active = 0
    const waiting = []
    const acquire = () => new Promise((resolveAcquire) => {
        if (active < max) {
            active += 1;
            resolveAcquire();
            return
        }
        waiting.push(resolveAcquire)
    })
    const release = () => {
        const next = waiting.shift()
        if (next !== undefined) {
            next();
            return
        }
        active -= 1
    }
    return async (task) => {
        await acquire()
        try {
            return await task()
        } finally {
            release()
        }
    }
}

function extnameOfMedia(mediaType) {
    switch (String(mediaType).toLowerCase()) {
        case 'image/png':
            return '.png'
        case 'image/jpeg':
            return '.jpg'
        case 'image/webp':
            return '.webp'
        case 'image/gif':
            return '.gif'
        case 'image/bmp':
            return '.bmp'
        case 'image/avif':
            return '.avif'
        default:
            return '.img'
    }
}

/* ═══════════════════════════════════════════════════════════════════
 * 纯扫描/纯图片 PDF 兜底：anydoc 转不出文本时，用 Python(PyMuPDF) 把每页
 * 渲染为 PNG，交给多模态模型逐页识别（纯 JS 提取器已弃用，PyMuPDF 为唯一兜底）。
 * ═══════════════════════════════════════════════════════════════════ */
/** 用 Python(PyMuPDF) 把 PDF 每页渲染为 PNG——当 anydoc 转不出文本时的兜底。 */
async function renderPdfPagesWithPymupdf(filePath) {
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
    let output = ''
    let meta = ''
    await new Promise((resolveRun, rejectRun) => {
        const child = spawn('python', ['-c', script, filePath], {stdio: ['ignore', 'pipe', 'pipe']})
        let outBuf = []
        child.stdout.on('data', (chunk) => {
            outBuf.push(chunk)
        })
        child.stderr.on('data', (chunk) => {
            meta += chunk.toString('utf8')
        })
        child.on('error', rejectRun)
        child.on('close', () => {
            output = Buffer.concat(outBuf)
            resolveRun()
        })
    })
    if (meta.includes('__PYMUPDF_MISSING__')) throw new Error('pymupdf 未安装')
    const pages = []
    const body = output.subarray(0, output.length)
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
        if (png.length > 0) pages.push({data: Buffer.from(png), mediaType: 'image/png', page: pages.length + 1})
        idx = end
    }
    return pages
}

/**
 * 纯扫描/纯图片 PDF 的多模态兜底：anydoc 转不出文本时，用 PyMuPDF 把每页渲染为 PNG，
 * 交给多模态模型逐页识别（不依赖任何 PDF 解析库的图片提取，PyMuPDF 是唯一兜底通道）。
 */
async function describePdfFallback(cfg, filePath) {
    const errors = []
    try {
        const pages = await renderPdfPagesWithPymupdf(filePath)
        if (pages.length > 0) return {images: pages, source: 'pymupdf'}
        errors.push('pymupdf 未渲染出页面')
    } catch (error) {
        errors.push('pymupdf 渲染失败：' + messageOf(error))
    }
    return {images: [], errors}
}

/**
 * 将文件字节解码为文本：UTF-8（含 BOM）优先，替换字符过多时回退 GB18030。
 * 纯文本文件可能是 GBK/GB18030 编码（中文 Windows 常见），TextDecoder('gb18030') 是 Node 内置能力。
 */
function decodeText(bytes) {
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
        return Buffer.from(bytes.subarray(3)).toString('utf8')
    }
    const utf8 = Buffer.from(bytes).toString('utf8')
    const badCount = (utf8.match(/\uFFFD/g) || []).length
    if (badCount === 0) return utf8
    try {
        const gbk = new TextDecoder('gb18030').decode(bytes)
        const gbkBad = (gbk.match(/\uFFFD/g) || []).length
        if (gbkBad < badCount) return gbk
    } catch { /* TextDecoder 不可用时保留 UTF-8 结果 */
    }
    return utf8
}

/** 极简 HTML → 可读文本：去掉 script/style，剥标签，还原常用实体并收拢空白。 */
function htmlToText(raw) {
    return String(raw || '')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|h[1-6]|li|tr|table|section|article)>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}

/**
 * 解析纯文本格式（json/txt/md/html/shtml）：直接解码为文字，不经过 anydoc。
 * JSON 尝试美化（未压缩时更易读）；HTML 剥标签。
 */
async function processText(ctx, cfg, cwd, filePath, fileName) {
    const bytes = await fs.readFile(filePath)
    const ext = extname(fileName || filePath).toLowerCase()
    let raw = decodeText(bytes)
    // 二进制检测：NUL 字节或不可打印控制字符占比过高 → 不是文本文件
    if (isBinaryish(bytes, raw)) {
        throw new Error('该文件不是文本文件（检测到二进制内容）')
    }
    if (ext === '.json') {
        try {
            const parsed = JSON.parse(raw)
            raw = JSON.stringify(parsed, null, 2)
        } catch { /* 非严格 JSON 保持原样 */
        }
    } else if (ext === '.html' || ext === '.shtml') {
        raw = htmlToText(raw)
        if (raw === '') raw = decodeText(bytes)
    }
    const maxChars = cfg.docMaxChars || 120000
    const truncated = raw.length > maxChars
    const body = truncated
        ? raw.slice(0, maxChars) + '\n\n…（内容过长，已截断，原文共 ' + raw.length + ' 字符）'
        : raw
    return {markdown: body, images: [], truncated}
}

/** 判断字节内容是否更像二进制而非文本。 */
function isBinaryish(bytes, decoded) {
    if (bytes.length === 0) return false
    if (bytes.includes(0)) return true
    let control = 0
    const sample = bytes.subarray(0, Math.min(bytes.length, 8192))
    for (const byte of sample) {
        if ((byte < 0x09) || (byte > 0x0d && byte < 0x20) || (byte > 0x7e && byte < 0xa0)) control += 1
    }
    if (sample.length > 0 && control / sample.length > 0.3) return true
    if (typeof decoded === 'string') {
        const bad = (decoded.match(/\uFFFD/g) || []).length
        if (decoded.length > 0 && bad / decoded.length > 0.1) return true
    }
    return false
}

/** 把解析出的 Markdown 落盘到 <uploads>/<basename>.parsed.md，供前端折叠卡片懒加载。 */
async function writeParsedMarkdown(cwd, sourcePath, markdown) {
    try {
        const uploads = join(resolve(cwd), 'uploads')
        await fs.mkdir(uploads, {recursive: true})
        const base = sanitizeName(basename(sourcePath)).replace(/\.[^.]+$/, '') || 'file'
        const parsedPath = join(uploads, base + '.parsed.md')
        await fs.writeFile(parsedPath, String(markdown ?? ''), 'utf8')
        return parsedPath
    } catch (error) {
        if (process.env.DSH_OMNIFILE_DEBUG === '1') {
            console.error('[dsh-omnifile] 写解析结果失败：' + messageOf(error))
        }
        return undefined
    }
}

/**
 * 用 @firecrawl/anydoc 解析文档。要点（对照 anydoc 0.1.9 API）：
 * - toMarkdownBytes(bytes, format) 对所有格式（含 PDF）都能转 Markdown；
 * - toDocument(bytes, format) 返回 Document.assets（内嵌图片字节），但 PDF 不支持（仅 Markdown 直出）；
 * - formatFromPath 识别格式并显式传给上面两个函数（CSV 等无签名的格式必须显式命名）；
 * - 任一步失败都容错降级，绝不因"含图片/无法转换"而整体报错：文本拿不到就只描述内嵌图片，
 *   图片描述失败只记录该图片错误，都不会中断整份文档的解析。
 */
async function processDocument(ctx, cfg, cwd, filePath, fileName, limitImages) {
    const imagesDir = join(resolve(cwd), 'uploads', 'images')
    const bytes = await fs.readFile(filePath)
    const fmt = typeof formatFromPath === 'function' ? formatFromPath(filePath) : undefined
    const isPdf = fmt === 'pdf'

    // 1) 文档模型 + 内嵌图片（PDF 无文档模型，跳过）
    let assets = []
    if (!isPdf) {
        try {
            const document = await toDocument(bytes, fmt ?? undefined)
            assets = Array.isArray(document?.assets) ? document.assets : []
        } catch (error) {
            if (process.env.DSH_OMNIFILE_DEBUG === '1') {
                console.error('[dsh-omnifile] toDocument failed for', filePath, messageOf(error))
            }
        }
    }

    // 2) Markdown：优先 toMarkdownBytes（字节 → Markdown，含 PDF），失败回退 toMarkdown(path)
    let markdownRaw = ''
    let mdError = undefined
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
    const savedImages = []

    // 2.5) 【规则2】仅当 firecrawl/anydoc【支持】的格式解析失败时才走多模态兜底。
    //      - 本函数只处理 kind==='doc'（任何 doc 的扩展名都落在 anydoc 支持集内）；
    //      - PDF 是 anydoc 支持的格式：anydoc 转 Markdown 失败 / 报 unsupported /
    //        返回空文本时，用 PyMuPDF 把每页渲染为 PNG，交给多模态模型逐页识别；
    //      - 非 PDF 文档（docx/pptx/xlsx 等）：若 Markdown 失败，下方第 3 步仍会
    //        把 toDocument 拿到的 assets（图片）交给多模态识别（用 anydoc 自身能力，不自研解压）。
    const mdLooksUnsupported = markdownRaw === ''
        || mdError !== undefined
        || /unsupported|OCR|no extractable text|scanned/i.test(markdownRaw)
    if (isPdf && mdLooksUnsupported) {
        try {
            const fallback = await describePdfFallback(cfg, filePath)
            if (fallback.images.length > 0) {
                const budget = typeof limitImages === 'number' ? limitImages : (cfg.maxDocImages || 8)
                const chosen = fallback.images.slice(0, budget)
                const limitPdf = createLimiter(cfg.concurrency || 1)
                await Promise.all(chosen.map(async (img, index) => {
                    try {
                        const ext = img.mediaType === 'image/jpeg' ? '.jpg' : '.png'
                        const stamp = randomUUID().slice(0, 8)
                        const base = sanitizeName(fileName).replace(/\.[^.]+$/, '')
                        const assetPath = join(imagesDir, base + '-pdf-' + stamp + '-' + (index + 1) + ext)
                        await fs.mkdir(imagesDir, {recursive: true})
                        await fs.writeFile(assetPath, img.data)
                        const description = await limitPdf(() => describeImage(ctx, cfg, assetPath, cfg.describePrompt || '请按要求描述这张图片。'))
                        savedImages.push({
                            path: assetPath,
                            name: basename(assetPath),
                            mediaType: img.mediaType,
                            description,
                            pdfPage: img.page
                        })
                    } catch (error) {
                        savedImages.push({
                            path: undefined,
                            name: 'pdf-page-' + (index + 1),
                            mediaType: img.mediaType,
                            error: messageOf(error)
                        })
                    }
                }))
            }
        } catch (error) {
            if (process.env.DSH_OMNIFILE_DEBUG === '1') {
                console.error('[dsh-omnifile] PDF 图片兜底失败：' + messageOf(error))
            }
        }
    }

    // 3) 提取并识别内嵌图片（单独保存到 uploads/images/，交给多模态模型）
    const limit = createLimiter(cfg.concurrency || 1)
    const budget = typeof limitImages === 'number' ? limitImages : (cfg.maxDocImages || 8)
    const candidates = assets.filter((asset) => {
        const mt = String(asset.mediaType || '').toLowerCase()
        return mt.startsWith('image/') && Buffer.isBuffer(asset.data) && asset.data.length > 0
    })
    const chosen = candidates.slice(0, budget)
    await Promise.all(chosen.map(async (asset, index) => {
        try {
            const ext = extnameOfMedia(asset.mediaType)
            const stamp = randomUUID().slice(0, 8)
            const base = sanitizeName(fileName).replace(/\.[^.]+$/, '')
            const assetPath = join(imagesDir, base + '-' + stamp + '-' + (index + 1) + ext)
            await fs.mkdir(imagesDir, {recursive: true})
            await fs.writeFile(assetPath, asset.data)
            const description = await limit(() => describeImage(ctx, cfg, assetPath, cfg.describePrompt || '请按要求描述这张图片。'))
            savedImages.push({path: assetPath, name: basename(assetPath), mediaType: asset.mediaType, description})
        } catch (error) {
            savedImages.push({
                path: undefined,
                name: 'image-' + (index + 1),
                mediaType: asset.mediaType,
                error: messageOf(error)
            })
        }
    }))

    // 4) 组装最终文本：Markdown（失败则说明原因）+ 内嵌图片识别结果
    const maxChars = cfg.docMaxChars || 120000
    let body = ''
    if (markdownRaw !== '') {
        const truncated = markdownRaw.length > maxChars
        body = truncated
            ? markdownRaw.slice(0, maxChars) + '\n\n…（内容过长，已截断，原文共 ' + markdownRaw.length + ' 字符）'
            : markdownRaw
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
    return {markdown: body, images: savedImages, truncated: markdownRaw.length > maxChars, textError}
}

function shouldWrapModel(info) {
    return Array.isArray(info?.inputModalities) && !info.inputModalities.includes('image')
}

class OmnifileVariantAdapter extends LlmAdapter {
    constructor(ctx, llm, upstream, upstreamName, getConfig) {
        super()
        this.ctx = ctx
        this.llm = llm
        this.upstream = upstream
        this.upstreamName = upstreamName
        this.getConfig = getConfig
    }

    providerInfo(provider) {
        return {id: provider, name: this.upstreamName + VARIANT_SUFFIX}
    }

    async listModels(provider, signal) {
        const models = await this.llm.listModels(this.upstream, signal)
        return models
            .filter((m) => shouldWrapModel(m))
            .map((m) => ({
                provider,
                id: m.id,
                name: m.name + VARIANT_SUFFIX,
                inputModalities: ['text', 'image'],
                ...(m.description !== undefined ? {description: m.description} : {}),
            }))
    }

    async resolveModel(provider, model, signal) {
        const info = await this.llm.resolveModelInfo(this.upstream, model, signal)
        if (!shouldWrapModel(info)) throw new Error('model "' + model + '" is not text-only; no omnifile variant needed')
        return {
            provider,
            id: model,
            name: info.name + VARIANT_SUFFIX,
            inputModalities: ['text', 'image'],
            ...(info.description !== undefined ? {description: info.description} : {}),
            ...(info.context !== undefined ? {context: info.context} : {}),
            ...(info.defaultMaxTokens !== undefined ? {defaultMaxTokens: info.defaultMaxTokens} : {}),
            ...(info.reasoning !== undefined ? {reasoning: info.reasoning} : {}),
        }
    }

    async* stream(options) {
        const cfg = this.getConfig()
        const messages = await this.rewriteMessages(cfg, options.messages, options.signal, options.sessionId)
        yield* this.llm.stream({...options, provider: this.upstream, messages})
    }

    async rewriteMessages(cfg, messages, signal, sessionId) {
        if (!messages.some((message) => contentHasImage(message.content))) return messages
        const limit = createLimiter(cfg.concurrency || 1)
        const out = []
        for (const message of messages) {
            if (!contentHasImage(message.content)) {
                out.push(message)
                continue
            }
            const content = await this.convertBlocks(cfg, message.content, limit, signal, sessionId)
            out.push({...message, content})
        }
        return out
    }

    async convertBlocks(cfg, blocks, limit, signal, sessionId) {
        const result = []
        let channelInserted = false
        for (const block of blocks) {
            if (block.type === 'tool-result' && contentHasImage(block.content)) {
                const nested = await this.convertBlocks(cfg, block.content, limit, signal, sessionId)
                result.push({...block, content: nested})
                continue
            }
            if (block.type !== 'image') {
                result.push(block)
                continue
            }
            if (!channelInserted) {
                result.push({
                    type: 'text',
                    text: '[omnifile] 这里的图片已经由多模态模型转换成文字说明，你只收到描述文本，不包含视觉 Token；图片绝对路径一并附上，需要更多视觉证据时可读该路径。',
                })
                channelInserted = true
            }
            signal?.throwIfAborted()
            const replacement = await limit(async () => {
                try {
                    const attachment = this.ctx.get('attachments')
                    const cwd = typeof sessionId === 'string' && sessionId !== ''
                        ? this.ctx.sessions.get(sessionId)?.header?.cwd
                        : undefined
                    const pathEvidence = await this.materializeAsEvidence(block, attachment, cwd)
                    const description = await describeImage(this.ctx, cfg, pathEvidence.path, cfg.describePrompt || '请按要求描述这张图片。')
                    return {
                        type: 'text',
                        text: '[图片绝对路径: ' + JSON.stringify(pathEvidence.path) + ']\n[多模态模型描述] ' + description
                    }
                } catch (error) {
                    return {type: 'text', text: '[omnifile 不可用] ' + messageOf(error).slice(0, 300)}
                }
            })
            result.push(replacement)
        }
        return result
    }

    async materializeAsEvidence(block, attachmentService, cwd) {
        if (attachmentService === undefined) throw new Error('附件服务不可用')
        const stored = await attachmentService.readImage(block.attachment)
        const data = stored?.data
        if (!(data instanceof Uint8Array) && !Buffer.isBuffer(data)) throw new Error('无法读取附件图片字节')
        const ext = extnameOfMedia(block.attachment?.mediaType || '')
        const hash = createHash('sha256').update(String(block.attachment?.attachmentId ?? '')).digest('hex').slice(0, 16)
        if (typeof cwd === 'string' && cwd !== '') {
            const imagesDir = join(resolve(cwd), 'uploads', 'images')
            await fs.mkdir(imagesDir, {recursive: true})
            const path = join(imagesDir, 'attachment-' + hash + ext)
            await fs.writeFile(path, Buffer.from(data))
            return {path}
        }
        const tmp = process.env.TEMP || process.env.TMP || '/tmp'
        const path = join(tmp, 'omnifile-' + hash + ext)
        await fs.writeFile(path, Buffer.from(data))
        return {path}
    }
}

function installVariants(ctx, getConfig) {
    const registrations = new Map()
    let disposed = false
    let sweeping = Promise.resolve()
    let sweepQueued = false
    const releaseAll = () => {
        for (const dispose of [...registrations.values()]) dispose()
        registrations.clear()
    }
    const sweep = () => {
        if (sweepQueued) return
        sweepQueued = true
        queueMicrotask(() => {
            sweepQueued = false
            sweeping = sweeping.then(sweepOnce, sweepOnce)
        })
    }
    const sweepOnce = async () => {
        if (disposed) return
        try {
            const cfg = getConfig()
            if (cfg.enableVariants !== true) {
                releaseAll()
                return
            }
            const llm = ctx.get('llm')
            if (llm === undefined) return
            let providers
            try {
                providers = llm.listProviders()
            } catch {
                return
            }
            const live = new Set(providers.map((provider) => provider.id))
            for (const upstream of [...registrations.keys()]) {
                if (!live.has(upstream)) {
                    registrations.get(upstream)?.()
                    registrations.delete(upstream)
                }
            }
            for (const provider of providers) {
                const upstream = provider.id
                if (upstream.startsWith(VARIANT_PREFIX)) continue
                if (registrations.has(upstream)) continue
                let models
                try {
                    models = await llm.listModels(upstream)
                } catch {
                    continue
                }
                if (!models.some((model) => shouldWrapModel(model))) continue
                if (disposed) return
                try {
                    const dispose = llm.registerAdapter(
                        [VARIANT_PREFIX + upstream],
                        new OmnifileVariantAdapter(ctx, llm, upstream, provider.name, getConfig),
                    )
                    registrations.set(upstream, dispose)
                } catch (error) {
                    ctx.logger?.warn?.('[dsh-omnifile] variant registration skipped for "' + upstream + '": ' + messageOf(error))
                }
            }
        } catch (error) {
            ctx.logger?.warn?.('[dsh-omnifile] variant sweep failed: ' + messageOf(error))
        }
    }
    if (typeof ctx.on === 'function') ctx.on('llm/adapters-updated', () => sweep())
    sweep()
    return () => {
        disposed = true
        releaseAll()
    }
}

function openLocally(path) {
    return new Promise((resolveOpen) => {
        let child
        try {
            if (process.platform === 'win32') {
                child = spawn('cmd', ['/c', 'start', '', path], {detached: true, stdio: 'ignore'})
            } else if (process.platform === 'darwin') {
                child = spawn('open', [path], {detached: true, stdio: 'ignore'})
            } else {
                child = spawn('xdg-open', [path], {detached: true, stdio: 'ignore'})
            }
        } catch (error) {
            resolveOpen({ok: false, error: messageOf(error)})
            return
        }
        child?.unref?.()
        resolveOpen({ok: true})
    })
}

function loadConfig(ctx) {
    let stored
    try {
        stored = ctx.settings ? ctx.settings.get(NAMESPACE) : undefined
    } catch {
        stored = undefined
    }
    return stored !== undefined && stored !== null && typeof stored === 'object' ? stored : {}
}

export function apply(ctx, config = {}) {
    const forced = {...config}
    if (typeof ctx.settings?.register === 'function') {
        ctx.settings.register(NAMESPACE, Config, {base: forced, applies: 'live'})
    }
    const getConfig = () => {
        const stored = loadConfig(ctx)
        if (Object.keys(stored).length > 0) {
            return {
                ...forced,
                ...stored,
                provider: {...(forced.provider ?? {}), ...(stored.provider ?? {})},
            }
        }
        return forced
    }

    const webServer = ctx.get('webServer')
    let disposeVariants = () => {
    }
    try {
        if (ctx.get('llm') !== undefined) disposeVariants = installVariants(ctx, getConfig)
    } catch (error) {
        ctx.logger?.warn?.('[dsh-omnifile] variants skipped: ' + messageOf(error))
    }

    if (webServer !== undefined) {
        ctx.effect(() => webServer.register({
            kind: 'exact',
            path: '/api/omnifile/save',
            handler: async (req, res) => {
                try {
                    const body = await readJsonBody(req)
                    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
                    const name = typeof body.name === 'string' ? body.name : ''
                    const base64 = typeof body.base64 === 'string' ? body.base64 : ''
                    if (sessionId === '' || name === '' || base64 === '') {
                        return writeJson(res, 400, {ok: false, error: '参数不完整（sessionId/name/base64）'})
                    }
                    if (base64.length > MAX_SAVE_BASE64) {
                        return writeJson(res, 400, {ok: false, error: '文件过大（超过 30MB）'})
                    }
                    let bytes
                    try {
                        bytes = Buffer.from(base64, 'base64')
                    } catch {
                        return writeJson(res, 400, {ok: false, error: '文件内容无效'})
                    }
                    const cfg = getConfig()
                    const cap = cfg.maxFileBytes || MAX_SAVE_BASE64
                    if (bytes.length > cap) {
                        return writeJson(res, 400, {
                            ok: false,
                            error: '文件超过大小上限 ' + Math.round(cap / 1024 / 1024) + 'MB'
                        })
                    }
                    const cwd = await sessionCwd(ctx, sessionId)
                    const fileName = Date.now() + '-' + sanitizeName(name)
                    const dir = join(cwd, 'uploads')
                    await fs.mkdir(dir, {recursive: true})
                    const path = join(dir, fileName)
                    await fs.writeFile(path, bytes)
                    return writeJson(res, 200, {
                        ok: true,
                        path,
                        name: fileName,
                        mime: mimeFor(name),
                        size: bytes.length,
                        kind: fileKind(name),
                    })
                } catch (error) {
                    console.error('[dsh-omnifile] save failed:', error)
                    return writeJson(res, 500, {ok: false, error: '保存失败：' + messageOf(error)})
                }
            },
        }), 'dsh-omnifile.save')

        ctx.effect(() => webServer.register({
            kind: 'exact',
            path: '/api/omnifile/process',
            handler: async (req, res) => {
                try {
                    const body = await readJsonBody(req)
                    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
                    const cwd = await sessionCwd(ctx, sessionId)
                    const target = assertWorkspacePath(cwd, body.path)
                    const cfg = getConfig()
                    const kind = typeof body.kind === 'string' && body.kind !== '' ? body.kind : fileKind(target)
                    if (kind === 'image') {
                        const text = await describeImage(ctx, cfg, target, undefined)
                        return writeJson(res, 200, {ok: true, kind: 'image', text, path: target})
                    }
                    if (kind === 'text') {
                        const result = await processText(ctx, cfg, cwd, target, basename(target))
                        const parsedPath = await writeParsedMarkdown(cwd, target, result.markdown)
                        return writeJson(res, 200, {ok: true, kind: 'text', parsedPath, ...result, path: target})
                    }
                    if (kind === 'doc') {
                        const result = await processDocument(ctx, cfg, cwd, target, basename(target))
                        // 修复：解析结果落盘为 <uploads>/<name>.parsed.md，前端折叠卡片懒加载用
                        const parsedPath = await writeParsedMarkdown(cwd, target, result.markdown)
                        return writeJson(res, 200, {ok: true, kind: 'doc', parsedPath, ...result, path: target})
                    }
                    // 修复3：所有不识别的格式默认按文本读取；读不了就提示用户，忽略继续
                    try {
                        const result = await processText(ctx, cfg, cwd, target, basename(target))
                        const parsedPath = await writeParsedMarkdown(cwd, target, result.markdown)
                        return writeJson(res, 200, {
                            ok: true,
                            kind: 'other',
                            parsedPath, ...result,
                            path: target,
                            note: '未知格式，已按文本读取。'
                        })
                    } catch (error) {
                        const stat = await fs.stat(target).catch(() => undefined)
                        return writeJson(res, 200, {
                            ok: true,
                            kind: kind || 'other',
                            path: target,
                            size: stat?.size,
                            note: '无法按文本读取该文件（' + messageOf(error) + '）。已忽略，绝对路径提供给模型备用。',
                        })
                    }
                } catch (error) {
                    return writeJson(res, 500, {ok: false, error: messageOf(error)})
                }
            },
        }), 'dsh-omnifile.process')

        ctx.effect(() => webServer.register({
            kind: 'exact',
            path: '/api/omnifile/open',
            handler: async (req, res) => {
                try {
                    const body = await readJsonBody(req)
                    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
                    const cwd = await sessionCwd(ctx, sessionId)
                    const target = assertWorkspacePath(cwd, body.path)
                    const result = await openLocally(target)
                    return writeJson(res, result.ok ? 200 : 500, {ok: result.ok, error: result.error})
                } catch (error) {
                    return writeJson(res, 500, {ok: false, error: messageOf(error)})
                }
            },
        }), 'dsh-omnifile.open')

        ctx.effect(() => webServer.register({
            kind: 'exact',
            path: '/api/omnifile/file',
            handler: async (req, res) => {
                try {
                    const url = new URL(req.url, 'http://localhost')
                    const sessionId = url.searchParams.get('sessionId') ?? ''
                    const rawPath = url.searchParams.get('path') ?? ''
                    const cwd = await sessionCwd(ctx, sessionId)
                    const target = assertWorkspacePath(cwd, rawPath)
                    const data = await fs.readFile(target)
                    res.writeHead(200, {
                        'content-type': mimeFor(target),
                        'content-length': data.length,
                        'cache-control': 'no-store',
                    })
                    res.end(data)
                } catch (error) {
                    writeJson(res, 500, {ok: false, error: messageOf(error)})
                }
            },
        }), 'dsh-omnifile.file')
    }

    const tools = ctx.get('tools')
    if (tools !== undefined) {
        ctx.effect(() => tools.register(defineTool({
            name: 'omnifile',
            description: '分析本地文件：图片交给配置的多模态模型识别为文字描述；文档（Word/PowerPoint/Excel/PDF/EPUB/RTF/CSV/OpenDocument）用 @firecrawl/anydoc 转换为 GitHub-Flavored Markdown 并识别内嵌图片；文本（JSON/TXT/MD/HTML/SHTML）直接解码为文字；其他文件返回路径信息。',
            parameters: {
                filePath: {type: 'string', required: true, description: '要分析的文件的绝对路径'},
                prompt: {type: 'string', description: '可选，指定识图时的关注点（仅图片与文档内嵌图片生效）'},
                kind: {type: 'string', description: '可选，显式指定类别（image/doc/text/media/other）；缺省按扩展名推断'},
            },
            output: {
                schema: {type: 'string'},
                render: (_args, value) => [{type: 'text', text: value}],
            },
            isConcurrencySafe: () => true,
            async execute(args, exec) {
                const path = String(args?.filePath ?? '').trim()
                if (path === '') throw new Error('filePath 不能为空')
                const cfg = getConfig()
                const kind = String(args?.kind ?? '').trim() || fileKind(path)
                const prompt = typeof args?.prompt === 'string' && args.prompt !== '' ? args.prompt : undefined
                if (kind === 'image') {
                    const text = await describeImage(ctx, cfg, path, prompt)
                    return '【图片 "' + basename(path) + '" 的多模态描述】\n' + text + '\n【图片绝对路径】' + path
                }
                if (kind === 'text') {
                    const stat = await fs.stat(path)
                    if (!stat.isFile()) throw new Error('不是有效文件')
                    const cwd = agentCwd(exec)
                    const result = await processText(ctx, cfg, cwd, path, basename(path))
                    return '【文本文件 "' + basename(path) + '" 已读取】\n' + result.markdown + '\n【文件绝对路径】' + path
                }
                if (kind === 'doc') {
                    const stat = await fs.stat(path)
                    if (!stat.isFile()) throw new Error('不是有效文件')
                    const cwd = agentCwd(exec)
                    const result = await processDocument(ctx, cfg, cwd, path, basename(path))
                    const imageLines = result.images.map((img) => img.error !== undefined
                        ? '- 图片 ' + img.name + '：识别失败（' + img.error + '）'
                        : '- 图片 ' + img.name + '：' + img.description).join('\n')
                    return '【文档 "' + basename(path) + '" 已解析】\n' + result.markdown
                        + (result.images.length > 0 ? '\n\n【文档内嵌图片识别结果】\n' + imageLines : '')
                        + '\n【文档绝对路径】' + path
                }
                // 修复3：未知格式默认按文本读取；读不了就提示用户并继续
                let cwdOther
                try {
                    cwdOther = agentCwd(exec)
                } catch {
                    cwdOther = undefined
                }
                try {
                    const stat = await fs.stat(path)
                    if (!stat.isFile()) throw new Error('不是有效文件')
                    const result = await processText(ctx, cfg, cwdOther, path, basename(path))
                    return '【文件 "' + basename(path) + '" 已按文本读取】\n' + result.markdown + '\n【文件绝对路径】' + path
                } catch (error) {
                    const statInfo = await fs.stat(path).catch(() => undefined)
                    return '【文件 "' + basename(path) + '"】绝对路径：' + path
                        + (statInfo ? '，大小 ' + statInfo.size + ' 字节' : '')
                        + '。按文本读取失败（' + messageOf(error) + '），已忽略该文件。'
                }
            },
        })), 'dsh-omnifile.tool')
    }

    return () => {
        disposeVariants()
    }
}
