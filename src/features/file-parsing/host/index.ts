/**
 * 功能块：文件解析（file-parsing）——宿主侧 /api/omnifile/{process,status} 路由。
 *
 * - /process：按文件类别（image/doc/text/其它）把文件解析为 Markdown 并落盘
 *   <uploads>/<源文件名>.md，图片/文档内嵌图片走 vision 功能块的多模态识图；
 * - /status：客户端轮询的解析进度（写入 core/host/progress 的进度存储）。
 */
import fs from 'node:fs/promises'
import { basename } from 'node:path'
import { messageOf } from '../../../core/index.js'
import { fileKind } from '../../../core/host/extensions.js'
import { readJsonBody, writeJson } from '../../../core/host/http.js'
import { debugLog } from '../../../core/host/logger.js'
import { assertWorkspacePath, sessionCwd, writeParsedMarkdown } from '../../../core/host/paths.js'
import { clearProgress, progressStore, setProgress } from '../../../core/host/progress.js'
import { describeImageCached } from '../../vision/host/describe.js'
import { processDocument } from './anydoc.js'
import { processText } from './text.js'

/** 注册文件解析相关路由。getConfig 由组合根注入（每次请求读取当前生效配置）。 */
export function registerFileParsing(ctx: any, getConfig: () => Record<string, any>): void {
    const webServer = ctx.get('webServer')
    if (webServer === undefined) return

    /* 解析：选中即后台执行（含多模态等耗时步骤），客户端发送时 await 同一结果。 */
    ctx.effect(() => webServer.register({
        kind: 'exact',
        path: '/api/omnifile/process',
        handler: async (req: any, res: any) => {
            let token = ''
            try {
                const body = await readJsonBody(req)
                token = typeof body.token === 'string' ? body.token : ''
                const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
                const cwd = await sessionCwd(ctx, sessionId)
                const target = assertWorkspacePath(cwd, body.path)
                const cfg = getConfig()
                const kind = typeof body.kind === 'string' && body.kind !== '' ? body.kind : fileKind(target)
                /* 原始文件名（上传时用用户原名；@ 选中时用源文件 basename），决定解析 md 的落盘名 {源文件名}.md */
                const srcName = typeof body.name === 'string' && body.name !== '' ? body.name : basename(target)
                if (kind === 'image') {
                    setProgress(token, { stage: 'image', detail: '正在调用多模态模型识别图片...', done: 0, total: 1 })
                    const text = await describeImageCached(ctx, cfg, target, undefined)
                    /* 图片描述同样落盘为 <uploads>/<源文件名>.md，消息里只放一行可读引用 */
                    const parsedPath = await writeParsedMarkdown(cwd, target, text, srcName)
                    setProgress(token, { stage: 'image', detail: '识别完成', done: 1, total: 1 })
                    return writeJson(res, 200, { ok: true, kind: 'image', text, parsedPath, path: target })
                }
                if (kind === 'text') {
                    setProgress(token, { stage: 'text', detail: '正在读取文本文件...', done: 0, total: 1 })
                    const result = await processText(ctx, cfg, cwd, target, basename(target))
                    const parsedPath = await writeParsedMarkdown(cwd, target, result.markdown, srcName)
                    setProgress(token, { stage: 'text', detail: '读取完成', done: 1, total: 1 })
                    return writeJson(res, 200, { ok: true, kind: 'text', parsedPath, ...result, path: target })
                }
                if (kind === 'doc') {
                    setProgress(token, { stage: 'doc', detail: '正在解析文件...', done: 0, total: 1 })
                    const result = await processDocument(ctx, cfg, cwd, target, basename(target), undefined, (patch) => setProgress(token, patch))
                    // 解析结果落盘为 <uploads>/<源文件名>.md，折叠卡片懒加载与大模型 read 用同一路径
                    const parsedPath = await writeParsedMarkdown(cwd, target, result.markdown, srcName)
                    setProgress(token, { stage: 'doc', detail: '解析完成', done: 1, total: 1 })
                    return writeJson(res, 200, { ok: true, kind: 'doc', parsedPath, ...result, path: target })
                }
                // 未识别的格式（如 .js/.ts/...）若可按文本读取则按文本处理，读不了就提示并保留路径
                try {
                    setProgress(token, { stage: 'text', detail: '正在解析文件...', done: 0, total: 1 })
                    const result = await processText(ctx, cfg, cwd, target, basename(target))
                    const parsedPath = await writeParsedMarkdown(cwd, target, result.markdown, srcName)
                    setProgress(token, { stage: 'text', detail: '解析完成', done: 1, total: 1 })
                    return writeJson(res, 200, { ok: true, kind: 'text', parsedPath, ...result, path: target, note: '未知格式，已按文本读取。' })
                } catch (error) {
                    const stat = await fs.stat(target).catch(() => undefined)
                    return writeJson(res, 200, {
                        ok: true,
                        kind: 'other',
                        path: target,
                        size: stat?.size,
                        note: messageOf(error) || '无法解析该文件',
                    })
                }
            } catch (error) {
                return writeJson(res, 500, { ok: false, error: messageOf(error) || '解析失败' })
            } finally {
                clearProgress(token)
            }
        },
    }), 'dsh-omnifile.process')

    /* 解析进度查询：客户端在处理期间轮询，实时展示阶段/页码。 */
    ctx.effect(() => webServer.register({
        kind: 'exact',
        path: '/api/omnifile/status',
        handler: async (req: any, res: any) => {
            try {
                const url = new URL(req.url, 'http://localhost')
                const token = url.searchParams.get('token') ?? ''
                const entry = typeof token === 'string' && token !== '' ? progressStore.get(token) : undefined
                return writeJson(res, 200, { ok: true, progress: entry ?? null })
            } catch (error) {
                return writeJson(res, 500, { ok: false, error: messageOf(error) })
            }
        },
    }), 'dsh-omnifile.status')
}
