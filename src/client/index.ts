/**
 * dsh-omnifile — 文件适配插件（客户端入口）
 *
 * 由 Vite 构建为 lib/client.js（DSH ModuleLoader 单文件 bundle）：
 *   window.__ModuleLoader__.load({ id: 'dsh-omnifile', factory: (require) => { ...CJS bundle... } })
 * external（require 解析）：react、@deepseek-ai/dsh-client-runtime；
 * common 双端共用元素由构建期内联进本 bundle（与宿主同一份 TS 源码，单源）。
 */
import { NAMESPACE, SOURCE } from '../common/index.js'
import { installStyles } from './styles.js'
import { OmnifileController, common } from './controller.js'
import { installPasteAndDrag, installMarkerHiding } from './dom.js'
import { installConversationNav } from './nav.js'
import { registerCodec } from './source.js'
import { omnifileChatDefinition } from './chat.js'
import { OmnifileDock, UploadButton, OmnifileFilesCard } from './components.js'
import { OmnifileSettings } from './settings.js'

export function apply(ctx: any): void {
    ctx.effect(installStyles, 'dsh-omnifile: styles')
    const controller = new OmnifileController(ctx)
    installPasteAndDrag(ctx, controller)
    registerCodec(ctx, controller)
    /* 隐藏用户消息气泡里的 marker（保留在 content 供模型工具识别）。 */
    installMarkerHiding(ctx)
    /* 会话内「用户消息」快速定位导航：≥2 条用户消息才显示，点击锚点圆点定位。 */
    installConversationNav(ctx)

    ctx.slots.inject('conversation.input.dock', function () {
        return ctx.slots.register({
            name: 'conversation.input.dock',
            id: 'omnifile',
            order: 5,
            inject: function (sessionId: string) {
                return {
                    controller: controller,
                    remove: function (occurrence: any) {
                        controller.remove(String(sessionId), occurrence)
                    },
                    /* 点击 dock 缩略图/文件卡片 → 用系统默认程序预览 */
                    openPath: function (path: string) {
                        controller.openPath(String(sessionId), path)
                    },
                }
            },
        }, OmnifileDock)
    })

    ctx.slots.inject('conversation.input.left', function () {
        return ctx.slots.register({
            name: 'conversation.input.left',
            id: 'omnifile',
            order: 10,
            inject: function (sessionId: string) {
                return { controller: controller, sessionId: String(sessionId) }
            },
        }, UploadButton)
    })

    ctx.slots.inject('conversation.chat.node', function () {
        return ctx.slots.register({
            name: 'conversation.chat.node',
            key: 'omnifile-files',
            inject: function (sessionId: string) {
                return {
                    sessionId: String(sessionId),
                    openPath: function (path: string) {
                        controller.openPath(String(sessionId), path)
                    },
                    loadParsed: function (sid: string, file: any) {
                        return controller.loadParsed(String(sid || sessionId), file)
                    },
                }
            },
        }, OmnifileFilesCard)
    })

    ctx.inject(['conversationEvents'], function (scope: any) {
        const events = scope && scope.get ? scope.get('conversationEvents') : undefined
        if (events && typeof events.register === 'function') {
            events.register(omnifileChatDefinition())
        }
    })

    ctx.slots.inject('settings.section', function () {
        return ctx.slots.register({
            name: 'settings.section',
            id: 'omnifile',
            order: 30,
            label: function () {
                return 'DshOmniFile'
            },
            inject: function () {
                let scope: any
                try {
                    const binder = ctx.get('settingsScope')
                    if (binder && typeof binder.bind === 'function') scope = binder.bind({ namespace: NAMESPACE })
                } catch (e) {
                    scope = undefined
                }
                return { scope: scope }
            },
        }, OmnifileSettings)
    })
}

export const inject = ['slots', 'sessions', 'conversation', 'conversationEvents', 'remote']

/* 兼容既有调用点：markerText/sourcePathOf 等双端共用能力（构建期内联后无需再拉取）。 */
export { common, SOURCE }
