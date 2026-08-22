/**
 * 功能块：设置（settings）——宿主侧 /api/omnifile/config 路由。
 *
 * 返回当前生效配置与客户端限额（文件大小/图片批量/轮询间隔/@ 列表等），
 * 客户端控制器据此初始化本地限额（配置是 live 生效的，请求时实时读取）。
 */
import { messageOf } from '../../../core/index.js'
import { MAX_SAVE_FALLBACK_BYTES } from '../../../core/host/config.js'
import { writeJson } from '../../../core/host/http.js'

/** 注册配置查询路由。getConfig 由组合根注入。 */
export function registerSettings(ctx: any, getConfig: () => Record<string, any>): void {
    const webServer = ctx.get('webServer')
    if (webServer === undefined) return

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
