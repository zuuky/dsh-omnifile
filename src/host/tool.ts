/**
 * dshomnifile 工具：主模型可随时自行解析本地文件（图片/文档/文本/其它）。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import fs from 'node:fs/promises'
import { basename } from 'node:path'
import { MARKER_UNKNOWN, markerText, messageOf } from '../common/index.js'
import { processDocument } from './anydoc.js'
import { describeImageCached } from './describe.js'
import { fileKind } from './extensions.js'
import { agentCwd, writeParsedMarkdown } from './paths.js'
import { processText } from './text.js'

/** 注册 dshomnifile 工具。getConfig 由入口注入。 */
function registerTool(ctx: any, getConfig: () => Record<string, any>): void {
    const tools = ctx.get('tools')
    if (tools === undefined) return

    ctx.effect(() => tools.register(defineTool({
        name: 'dshomnifile',
        description: "分析本地文件并把解析结果落盘为 {源文件名}.md，返回一行可读路径引用（解析后保存路径：<md绝对路径>（完整内容见上方文件卡片，可点击展开；源文件：<源文件绝对路径>））；如解析失败/无法读取则返回「解析后保存路径：<源路径>（解析失败/无法按文本读取：原因）」。拿到 md 路径后用内置 read 工具即可读取完整内容。支持的类型与行为：\n" +
            "1）图片（.png/.jpg/.jpeg/.webp/.gif/.bmp/.svg/.avif）：交给配置的多模态模型识别为文字描述并写入 md；同一张图片的结果按内容哈希缓存，不会重复调用多模态服务。若当前模型本身支持 image 输入，直接用 read_image 查看原图更合适（避免重复处理），dshomnifile 的图片模式适合文本-only 模型或需逐字转写的场景。\n" +
            "2）文档（.doc/.docx/.docm/.odt/.pdf/.ppt/.pptx/.rtf/.epub/.xlsx/.ods/.odp/.csv 及 .pps/.pot/.pptm/.ppsx/.ppsm/.xls/.xlsm/.xlsb 等变体）：用 @firecrawl/anydoc 转为 GitHub-Flavored Markdown 并识别内嵌图片，写入 md；纯扫描/图像型 PDF 会用 PyMuPDF 逐页渲染识别并按页序拼装。\n" +
            "3）文本（.json/.txt/.md/.html/.shtml）：直接以 UTF-8/GB18030 解码为文字（JSON 美化、HTML 剥标签），写入 md。\n" +
            "4）其它（音视频等二进制）：无法按文本读取时返回路径与原因（保留大小等元信息）。\n" +
            "5）说明：需先通过「设置-模型」配置一个支持 image 输入的多模态模型并在此插件设置里选择它，否则图片/文档内嵌图片识别会报错。",
        parameters: {
            filePath: { type: 'string', required: true, description: '要分析的文件的绝对路径' },
            prompt: { type: 'string', description: '可选，指定识图时的关注点（仅图片与文档内嵌图片生效）' },
            kind: { type: 'string', description: '可选，显式指定类别（image/doc/text/media/other）；缺省按扩展名推断' },
        },
        output: {
            schema: { type: 'string' },
            render: (_args: any, value: string) => [{ type: 'text', text: value }],
        },
        isConcurrencySafe: () => true,
        /* 工具与聊天卡片同一套「解析→落盘 {源文件名}.md→给一行可读路径引用」：不把解析全文塞进模型上下文，
         * 模型拿到 md 绝对路径后用内置 read 工具即可读到内容。返回统一为：
         *   解析后保存路径：<md 或源路径>（完整内容见上方文件卡片，可点击展开；源文件：<源路径> | 无法按文本读取：… | 解析失败：…）
         */
        async execute(args: any, exec: any) {
            const path = String(args?.filePath ?? '').trim()
            if (path === '') throw new Error('filePath 不能为空')
            const cfg = getConfig()
            const kind = String(args?.kind ?? '').trim() || fileKind(path)
            const prompt = typeof args?.prompt === 'string' && args.prompt !== '' ? args.prompt : undefined
            let cwd = ''
            try { cwd = agentCwd(exec) } catch (error) { cwd = '' }
            const saveMarkdown = async (markdown: string) => {
                if (cwd === '') return undefined
                try { return await writeParsedMarkdown(cwd, path, markdown) } catch (error) { return undefined }
            }
            const ok = async (markdown: string) => {
                const mdPath = await saveMarkdown(markdown)
                /* 成功标记携带源文件绝对路径，客户端卡片据此打开源文件。 */
                return markerText(mdPath || path, { ok: true, source: path })
            }
            const unreadable = (note: string) => markerText(path, { note })
            try {
                const stat = await fs.stat(path)
                if (!stat.isFile()) throw new Error('不是有效文件')
                if (kind === 'image') {
                    const text = await describeImageCached(ctx, cfg, path, prompt)
                    return await ok(text)
                }
                if (kind === 'text') {
                    const result = await processText(ctx, cfg, cwd, path, basename(path))
                    return await ok(result.markdown)
                }
                if (kind === 'doc') {
                    const result = await processDocument(ctx, cfg, cwd, path, basename(path))
                    const full = result.markdown + (result.images.length > 0
                        ? '\n\n【文档内嵌图片识别结果】\n' + result.images.map((img) => img.error !== undefined
                            ? '- 图片 ' + img.name + '：识别失败（' + img.error + '）'
                            : '- 图片 ' + img.name + '：' + img.description).join('\n')
                        : '')
                    return await ok(full)
                }
                // 未识别的格式：默认按文本读取；读不了返回路径与原因（保留大小等元信息）
                try {
                    const result = await processText(ctx, cfg, cwd, path, basename(path))
                    return await ok(result.markdown)
                } catch (error) {
                    const statInfo = await fs.stat(path).catch(() => undefined)
                    return unreadable(messageOf(error) + (statInfo ? '（' + statInfo.size + ' 字节）' : ''))
                }
            } catch (error) {
                return markerText(path, { ok: false, note: messageOf(error) || MARKER_UNKNOWN })
            }
        },
    })), 'dsh-omnifile.tool')
}

export { registerTool }
