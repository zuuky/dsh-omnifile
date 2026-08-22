/**
 * 功能块：文件接入（file-intake）——宿主侧 /api/omnifile/{save,list} 路由。
 *
 * - /save：接收客户端上传的 base64 文件字节并落盘到 <workspace>/uploads/；
 * - /list：递归列出会话工作区文件（供输入框 @ 文件选择器）。
 *
 * 注意：配置是 live 生效的，因此每个 handler 内部都要重新调用 getConfig()，
 * 不能把配置快照在注册期。
 */
import fs from 'node:fs/promises'
import { join } from 'node:path'
import { messageOf } from '../../../core/index.js'
import { BASE64_INFLATE, MAX_SAVE_FALLBACK_BYTES } from '../../../core/host/config.js'
import { fileKind, mimeFor } from '../../../core/host/extensions.js'
import { readJsonBody, writeJson } from '../../../core/host/http.js'
import { debugLog } from '../../../core/host/logger.js'
import { sanitizeName, sessionCwd, uploadsDir } from '../../../core/host/paths.js'
import { walkWorkspaceFiles } from './workspace.js'

/** 注册文件接入相关路由。getConfig 由组合根注入（每次请求读取当前生效配置）。 */
export function registerFileIntake(ctx: any, getConfig: () => Record<string, any>): void {
    const webServer = ctx.get('webServer')
    if (webServer === undefined) return

    /* 上传：客户端把文件以 base64 传给宿主落盘到会话 uploads/。 */
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

    /* @ 文件选择器：当前会话工作区文件清单（跳过噪声目录、限量限深）。 */
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
}
