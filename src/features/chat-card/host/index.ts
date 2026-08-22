/**
 * 功能块：聊天文件卡片（chat-card）——宿主侧 /api/omnifile/{parsed,open} 路由。
 *
 * - /parsed：懒加载 <uploads>/<源文件名>.md 的解析全文（折叠卡片展开时读取）；
 * - /open：用系统默认程序在本地打开源文件（📂 按钮）。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import { messageOf } from '../../../core/index.js'
import { readJsonBody, writeJson } from '../../../core/host/http.js'
import { assertWorkspacePath, parsedMarkdownPath, sessionCwd } from '../../../core/host/paths.js'

/** 用系统默认程序在本地打开路径。 */
export function openLocally(path: string): Promise<{ ok: boolean; error?: string }> {
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

/** 注册聊天卡片相关路由。 */
export function registerChatCard(ctx: any, _getConfig: () => Record<string, any>): void {
    const webServer = ctx.get('webServer')
    if (webServer === undefined) return

    /* 解析全文懒加载（折叠卡片展开时读取 {源文件名}.md）。 */
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

    /* 用系统默认程序打开源文件（📂）。 */
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
}
