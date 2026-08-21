/**
 * 宿主全部 /api/omnifile/* 路由注册（save/process/status/parsed/models/open/list/config + common.js）。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { messageOf } from '../common/index.js'
import { processDocument } from './anydoc.js'
import { BASE64_INFLATE, MAX_SAVE_FALLBACK_BYTES } from './config.js'
import { describeImageCached } from './describe.js'
import { fileKind, mimeFor } from './extensions.js'
import { readJsonBody, writeJson } from './http.js'
import { debugLog } from './logger.js'
import { enumerateModels } from './models.js'
import { sanitizeName, sessionCwd, assertWorkspacePath, uploadsDir, parsedMarkdownPath, writeParsedMarkdown } from './paths.js'
import { clearProgress, progressStore, setProgress } from './progress.js'
import { processText } from './text.js'
import { walkWorkspaceFiles } from './workspace.js'

/** 用系统默认程序在本地打开路径。 */
function openLocally(path: string): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolveOpen) => {
        let child: any
        try {
            if (process.platform === 'win32') {
                child = spawn('cmd', ['/c', 'start', '', path], { detached: true, stdio: 'ignore' })
            } else if (process.platform === 'darwin') {
                child = spawn('open', [path], { detached: true, stdio: 'ignore' })
            } else {
                child = spawn('xdg-open', [path], { detached: true, stdio: 'ignore' })
            }
        } catch (error) {
            resolveOpen({ ok: false, error: messageOf(error) })
            return
        }
        child?.unref?.()
        resolveOpen({ ok: true })
    })
}

/** 注册全部 /api/omnifile/* 路由。getConfig 由入口注入（读取当前生效配置）。 */
function registerRoutes(ctx: any, getConfig: () => Record<string, any>): void {
    const webServer = ctx.get('webServer')
    if (webServer === undefined) return

    ctx.effect(() => webServer.register({
        kind: 'exact',
        path: '/api/omnifile/common.js',
        handler: async (req: any, res: any) => {
            try {
                const commonPath = fileURLToPath(new URL(/* @vite-ignore */ './common.js', import.meta.url))
                const data = await fs.readFile(commonPath)
                res.writeHead(200, {
                    'content-type': 'application/javascript; charset=utf-8',
                    'content-length': data.length,
                    'cache-control': 'no-store',
                })
                res.end(data)
            } catch (error) {
                writeJson(res, 500, { ok: false, error: messageOf(error) })
            }
        },
    }), 'dsh-omnifile.common-js')

    ctx.effect(() => webServer.register({
        kind: 'exact',
        path: '/api/omnifile/save',
        handler: async (req: any, res: any) => {
            try {
                const cfg = getConfig()
                /* 上限统一由 cfg.maxFileBytes 派生：base64 字符数 ≈ 字节数×4/3，JSON 外壳再加余量。 */
                const maxFileBytes = Math.max(1, Number(cfg.maxFileBytes) || MAX_SAVE_FALLBACK_BYTES)
                const maxBase64Chars = Math.ceil(maxFileBytes * BASE64_INFLATE) + 1024
                const maxBodyBytes = Math.ceil(maxBase64Chars) + 1024 * 1024
                const body = await readJsonBody(req, maxBodyBytes)
                const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
                const name = typeof body.name === 'string' ? body.name : ''
                const base64 = typeof body.base64 === 'string' ? body.base64 : ''
                if (sessionId === '' || name === '' || base64 === '') {
                    return writeJson(res, 400, { ok: false, error: '参数不完整（sessionId/name/base64）' })
                }
                if (base64.length > maxBase64Chars) {
                    return writeJson(res, 400, { ok: false, error: '文件过大（超过上传上限）' })
                }
                let bytes: Buffer
                try {
                    bytes = Buffer.from(base64, 'base64')
                } catch {
                    return writeJson(res, 400, { ok: false, error: '文件内容无效' })
                }
                if (bytes.length > maxFileBytes) {
                    return writeJson(res, 400, {
                        ok: false,
                        error: '文件超过大小上限 ' + Math.round(maxFileBytes / 1024 / 1024) + 'MB',
                    })
                }
                const cwd = await sessionCwd(ctx, sessionId)
                const fileName = Date.now() + '-' + sanitizeName(name)
                const dir = uploadsDir(cwd)
                await fs.mkdir(dir, { recursive: true })
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
                debugLog('save failed:', error)
                return writeJson(res, 500, { ok: false, error: '保存失败：' + messageOf(error) })
            }
        },
    }), 'dsh-omnifile.save')

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

    ctx.effect(() => webServer.register({
        kind: 'exact',
        path: '/api/omnifile/parsed',
        handler: async (req: any, res: any) => {
            try {
                const url = new URL(req.url, 'http://localhost')
                const sessionId = url.searchParams.get('sessionId') ?? ''
                const cwd = await sessionCwd(ctx, sessionId)
                const rawPath = url.searchParams.get('path') ?? ''
                const target = assertWorkspacePath(cwd, rawPath)
                /* 新标记的保存路径即 {源文件名}.md → 直接读；旧标记（源文件路径）则按规则推导同名 .md。 */
                const parsedPath = target.toLowerCase().endsWith('.md') ? target : parsedMarkdownPath(cwd, target)
                const data = await fs.readFile(parsedPath)
                res.writeHead(200, {
                    'content-type': 'text/markdown; charset=utf-8',
                    'content-length': data.length,
                    'cache-control': 'no-store',
                })
                res.end(data)
            } catch (error) {
                writeJson(res, 404, { ok: false, error: messageOf(error) })
            }
        },
    }), 'dsh-omnifile.parsed')

    ctx.effect(() => webServer.register({
        kind: 'exact',
        path: '/api/omnifile/models',
        handler: async (req: any, res: any) => {
            try {
                /* 全面枚举当前生效的多模态候选模型（见 enumerateModels）：
                 * adapter 实时目录（含 DSH 内置 DeepSeek 等）+ 可配置提供商设置回退，
                 * 每项带 image 能力标注，客户端据此提示用户选择。 */
                const providers = await enumerateModels(ctx)
                return writeJson(res, 200, { ok: true, providers })
            } catch (error) {
                return writeJson(res, 500, { ok: false, error: messageOf(error) })
            }
        },
    }), 'dsh-omnifile.models')

    ctx.effect(() => webServer.register({
        kind: 'exact',
        path: '/api/omnifile/open',
        handler: async (req: any, res: any) => {
            try {
                const body = await readJsonBody(req)
                const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
                const cwd = await sessionCwd(ctx, sessionId)
                const target = assertWorkspacePath(cwd, body.path)
                const result = await openLocally(target)
                return writeJson(res, result.ok ? 200 : 500, { ok: result.ok, error: result.error })
            } catch (error) {
                return writeJson(res, 500, { ok: false, error: messageOf(error) })
            }
        },
    }), 'dsh-omnifile.open')

    ctx.effect(() => webServer.register({
        kind: 'exact',
        path: '/api/omnifile/list',
        handler: async (req: any, res: any) => {
            try {
                const url = new URL(req.url, 'http://localhost')
                const sessionId = url.searchParams.get('sessionId') ?? ''
                const cwd = await sessionCwd(ctx, sessionId)
                const cfg = getConfig()
                const files = await walkWorkspaceFiles(cwd, {
                    maxFiles: cfg.listMaxFiles,
                    maxDepth: cfg.listMaxDepth,
                })
                return writeJson(res, 200, { ok: true, files })
            } catch (error) {
                return writeJson(res, 500, { ok: false, error: messageOf(error) })
            }
        },
    }), 'dsh-omnifile.list')

    /* 返回当前生效配置与客户端限额。 */
    ctx.effect(() => webServer.register({
        kind: 'exact',
        path: '/api/omnifile/config',
        handler: async (req: any, res: any) => {
            try {
                const cfg = getConfig()
                return writeJson(res, 200, {
                    ok: true,
                    config: cfg,
                    limits: {
                        maxFileBytes: Math.max(1, Number(cfg.maxFileBytes) || MAX_SAVE_FALLBACK_BYTES),
                        maxBatchImages: Math.max(1, Number(cfg.maxBatchImages) || 20),
                        progressPollMs: Math.max(50, Number(cfg.progressPollMs) || 400),
                        listMaxFiles: Math.max(1, Number(cfg.listMaxFiles) || 2000),
                        listMaxDepth: Math.max(1, Number(cfg.listMaxDepth) || 12),
                    },
                })
            } catch (error) {
                return writeJson(res, 500, { ok: false, error: messageOf(error) })
            }
        },
    }), 'dsh-omnifile.config')
}

export { openLocally, registerRoutes }
