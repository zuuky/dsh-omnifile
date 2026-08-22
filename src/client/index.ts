/**
 * dsh-omnifile — 文件适配插件（客户端组合根）
 *
 * 组合根职责：创建共享控制器并按功能块装配客户端能力（file-intake / chat-card /
 * navigation / settings）。各功能块自持 React 组件、样式与槽位注册。
 *
 * 由 Vite 构建为 lib/client.js（DSH ModuleLoader 单文件 bundle）：
 *   window.__ModuleLoader__.load({ id: 'dsh-omnifile', factory: (require) => { ...CJS bundle... } })
 * external（require 解析）：react、@deepseek-ai/dsh-client-runtime；
 * core 双端共用元素由构建期内联进本 bundle（与宿主同一份 TS 源码，单源）。
 */
import { SOURCE } from '../core/index.js'
import { installFileIntake } from '../features/file-intake/client/index.js'
import { installChatCard } from '../features/chat-card/client/index.js'
import { installNavigation } from '../features/navigation/client/index.js'
import { installSettings } from '../features/settings/client/index.js'
import { OmnifileController, common } from '../features/file-intake/client/controller.js'

export function apply(ctx: any): void {
    const controller = new OmnifileController(ctx)
    /* 各功能块自持样式：install 内部调用 core/client 的 installStyles 注入独立 <style>。 */
    installFileIntake(ctx, controller)
    installChatCard(ctx, controller)
    installNavigation(ctx)
    installSettings(ctx)
}

export const inject = ['slots', 'sessions', 'conversation', 'conversationEvents', 'remote']

/* 兼容既有调用点：markerText/sourcePathOf 等双端共用能力（构建期内联后无需再拉取）。 */
export { common, SOURCE }
