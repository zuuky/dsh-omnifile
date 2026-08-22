/**
 * 功能块：多模态识图（vision）——宿主侧 /api/omnifile/models 路由 + 识图服务。
 *
 * - /models：全面枚举当前 DSH 已注册的多模态候选模型（含内置 DeepSeek 与自定义
 *   提供商），带 image 能力标注，供设置页点选（唯一配置来源 providerRef）；
 * - describe.ts / models.ts：provider 解析、OpenAI 兼容调用、内容哈希缓存。
 */
import { messageOf } from '../../../core/index.js'
import { writeJson } from '../../../core/host/http.js'
import { enumerateModels } from './models.js'

/** 注册多模态模型相关路由。 */
export function registerVision(ctx: any, _getConfig: () => Record<string, any>): void {
    const webServer = ctx.get('webServer')
    if (webServer === undefined) return

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
}
