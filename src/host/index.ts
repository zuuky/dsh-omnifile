/**
 * dsh-omnifile — 文件适配插件（Host 端入口）
 *
 * 路由：/api/omnifile/{save,process,status,open,parsed,models,list,config} + common.js
 * 能力：文件接入/解析（anydoc＋纯文本）、多模态识图（内容哈希缓存）、
 *      文本-only 主模型的 omnifile-* 图像变体、omnifile 工具、@ 文件列表。
 *
 * 解析结果统一落盘为 <uploads>/<源文件名>.md，消息里只放一行「解析后保存路径」引用，
 * 大模型按该绝对路径用内置 read 工具读取内容。
 *
 * 构建：本文件由 Vite 编译为 lib/index.js（Node ESM，common 内联；lib/common.js 仍单独
 * 构建供 /api/omnifile/common.js 向后兼容旧客户端 bundle）。
 */
import { NAMESPACE } from '../common/index.js'
import { Config, syncRunLimits } from './config.js'
import { messageOf } from '../common/index.js'
import { LOG_PREFIX } from './logger.js'
import { registerRoutes } from './routes.js'
import { registerTool } from './tool.js'
import { installVariants } from './variants.js'

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

    registerRoutes(ctx, getConfig)
    registerTool(ctx, getConfig)

    return () => {
        disposeVariants()
    }
}
