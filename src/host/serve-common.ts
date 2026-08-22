/**
 * 宿主组合根的通用基础设施：/api/omnifile/common.js 路由。
 *
 * 把构建产物 lib/common.js（双端共用元素，见 src/core/index.ts）原样返回给
 * 旧客户端 bundle（向后兼容）；新客户端 bundle 的 common 由构建期内联。
 */
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { messageOf } from '../core/index.js'
import { writeJson } from '../core/host/http.js'

export function registerCommonJsRoute(ctx: any): void {
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
}
