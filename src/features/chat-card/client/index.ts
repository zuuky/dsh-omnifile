/**
 * 功能块：聊天文件卡片（chat-card）客户端入口。
 *
 * 装配聊天区文件卡片槽位（conversation.chat.node）、聊天事件定义（chat 卡片锚定
 * 到用户消息上方）、用户气泡里 marker 段隐藏，并注入本功能块的样式。
 */
import { installStyles } from '../../../core/client/styles.js'
import { installMarkerHiding } from './dom.js'
import { omnifileChatDefinition } from './chat.js'
import { OmnifileFilesCard } from './components.js'
import { css } from './styles.js'

/** 本功能块样式（由组合根统一注入）。 */
export { css }

function installChatCard(ctx: any, controller: any): void {
    ctx.effect(() => installStyles(css, 'chat-card'), 'dsh-omnifile: chat-card styles')

    /* 隐藏用户消息气泡里的 marker（保留在 content 供模型工具识别）。 */
    installMarkerHiding(ctx)

    /* 聊天文件卡片：每条用户消息上方展示已解析文件。 */
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
}

export { installChatCard }
