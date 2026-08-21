/**
 * 聊天卡片（conversation chat.node）事件定义：用户消息上方展示已解析文件卡片。
 */
import { FILES_ANCHOR_OFFSET } from './constants.js'
import { chatNode, extractFiles, hasParseMarker, markStartedCard } from './parse.js'

declare function require(id: string): any

function omnifileChatDefinition(): any {
    return {
        kind: 'omnifile-files',
        target: 'chat',
        match: function (event: any) {
            if (event.type !== 'user/message') return null
            let append = true
            try {
                const runtime = require('@deepseek-ai/dsh-client-runtime')
                if (runtime && typeof runtime.isAppendSurfaceEvent === 'function') append = runtime.isAppendSurfaceEvent(event)
            } catch (e) { /* ignore */ }
            if (!append) return null
            if (!hasParseMarker(event.data.content)) return null
            return { id: String(event.data.id), role: 'start' }
        },
        start: function (context: any, match: any, reader: any) {
            const messageId = String(match.event.data && match.event.data.id || '')
            if (messageId !== '' && markStartedCard(messageId)) return undefined
            const files = extractFiles(match.event.data.content)
            if (files.length === 0) return undefined
            return {
                kind: 'omnifile-files',
                files: files,
                messageId: match.event.data.id,
                seq: match.event.seq,
                time: match.event.time,
            }
        },
        update: function (context: any) {
            return context.state
        },
        buildViewNode: function (context: any) {
            if (context.state === undefined) return null
            /* 锚点取(用户消息 seq - 0.5)：折叠卡片稳定排在用户消息上方，不再混入 AI 回复。 */
            return chatNode(context, 'omnifile-files', context.state.seq + FILES_ANCHOR_OFFSET, context.state)
        },
    }
}

export { omnifileChatDefinition }
