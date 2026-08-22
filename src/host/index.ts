/**
 * dsh-omnifile — 文件适配插件（Host 端组合根）
 *
 * 组合根职责：装配共享层（core）与各功能块（features/），按 DSH 插件协议
 * 注册设置、路由、工具与模型变体。各功能块自行注册自己的 /api 路由。
 *
 * 构建：本文件由 Vite 编译为 lib/index.js（Node ESM，core 内联；lib/common.js
 * 仍单独构建供 /api/omnifile/common.js 向后兼容旧客户端 bundle）。
 */
import { NAMESPACE, messageOf } from '../core/index.js'
import { Config, syncRunLimits } from '../core/host/config.js'
import { LOG_PREFIX } from '../core/host/logger.js'
import { registerFileIntake } from '../features/file-intake/host/index.js'
import { registerFileParsing } from '../features/file-parsing/host/index.js'
import { registerVision } from '../features/vision/host/index.js'
import { installVariants } from '../features/variants/host/index.js'
import { registerTool } from '../features/omnifile-tool/host/index.js'
import { registerChatCard } from '../features/chat-card/host/index.js'
import { registerSettings } from '../features/settings/host/index.js'
import { registerCommonJsRoute } from './serve-common.js'

export const name = 'dsh-omnifile'
export const inject = ['webServer', 'sessions', 'tools', 'settings', 'credentials', 'llm']
export { Config }

function loadConfig(ctx: any): Record<string, any> {
    let stored: any
    try {
        stored = ctx.settings ? ctx.settings.get(NAMESPACE) : undefined
    } catch {
        stored = undefined
    }
    return stored !== undefined && stored !== null && typeof stored === 'object' ? stored : {}
}

export function apply(ctx: any, config: Record<string, any> = {}): () => void {
    const forced = { ...config }
    if (typeof ctx.settings?.register === 'function') {
        ctx.settings.register(NAMESPACE, Config, { base: forced, applies: 'live' })
    }
    const getConfig = (): Record<string, any> => {
        const stored = loadConfig(ctx)
        if (Object.keys(stored).length > 0) {
            return { ...forced, ...stored }
        }
        return forced
    }
    /* 把可配置上限同步到模块级可变常量（sanitizeName 与识图缓存宽度在配置变更后即时生效）。 */
    syncRunLimits(getConfig())

    let disposeVariants = () => {
    }
    try {
        if (ctx.get('llm') !== undefined) disposeVariants = installVariants(ctx, getConfig)
    } catch (error) {
        ctx.logger?.warn?.(LOG_PREFIX + ' variants skipped: ' + messageOf(error))
    }

    /* 通用基础设施 + 各功能块的路由/工具注册。 */
    registerCommonJsRoute(ctx)
    registerFileIntake(ctx, getConfig)
    registerFileParsing(ctx, getConfig)
    registerVision(ctx, getConfig)
    registerTool(ctx, getConfig)
    registerChatCard(ctx, getConfig)
    registerSettings(ctx, getConfig)

    return () => {
        disposeVariants()
    }
}
