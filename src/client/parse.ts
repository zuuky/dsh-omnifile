/**
 * 客户端消息标记解析：从消息正文提取「已解析文件」清单 / 判断是否存在解析标记。
 * 正则的状态分支用 common 常量动态生成（唯一来源 common）。
 */
import * as React from 'react'
import { MARKER_STATUS_OK, MARKER_STATUS_UNREADABLE, MARKER_STATUS_FAILED, MARKER_UNKNOWN, MARKER_PREFIX, KIND_DOC, KIND_OTHER, sourcePathOf } from '../common/index.js'
import { basenameOf, textOf } from './util.js'

/* 聊天卡片定位标记（纯可读文本，无 token）。统一形态为一行：
 *   解析后保存路径：<绝对路径>（<状态说明>[；源文件：<源绝对路径>]）
 * 状态说明：完整内容见上方文件卡片，可点击展开（成功，路径为 {源文件名}.md，可带源文件回指）/
 *   无法按文本读取：… / 解析失败：…（失败，路径为源文件）。
 * 正则要求 （ 后紧跟本插件的状态词，避免把内容里形似的字符串误抽。 */
let PARSE_STATUS_RE: string | null = null
let PARSE_RE: RegExp | null = null
let PARSE_MARKER_RE: RegExp | null = null

function rebuildParsers(): void {
    PARSE_STATUS_RE = '(?:' + MARKER_STATUS_OK + '|' + MARKER_STATUS_UNREADABLE
        + '|' + MARKER_STATUS_FAILED + '|' + MARKER_UNKNOWN + ')'
    /* 组1=保存路径，组2=状态词+尾巴（含「；源文件：…」），供 sourcePathOf 提取源文件。 */
    PARSE_RE = new RegExp(MARKER_PREFIX + '(.+?)（(' + PARSE_STATUS_RE + '[^）]*)）', 'g')
    PARSE_MARKER_RE = new RegExp(MARKER_PREFIX + '.+?（(' + PARSE_STATUS_RE + '[^）]*)）')
}
rebuildParsers()

/* 已生成卡片的消息防重：同一消息只建一次卡片节点（防御运行时对同一逻辑消息产生不同 id 的重复事件）。 */
const startedCards = new Set<string>()

/** 从消息正文提取「已解析文件」清单（保存路径/源文件/显示名/类别），按保存路径去重。 */
function extractFiles(content: any): Array<{ name: string; kind: string; path: string; sourcePath?: string }> {
    const files: Array<{ name: string; kind: string; path: string; sourcePath?: string }> = []
    let m: RegExpExecArray | null
    if (PARSE_RE === null) return files
    PARSE_RE.lastIndex = 0
    const text = textOf(content)
    const seenPaths: Record<string, boolean> = {}
    while ((m = PARSE_RE.exec(text)) !== null) {
        const path = String(m[1] || '').trim()
        if (path === '' || seenPaths[path]) continue
        const statusTail = String(m[2] || '')
        const parsed = statusTail.indexOf(MARKER_STATUS_OK) === 0
        const sourcePath = sourcePathOf(statusTail)
        /* 成功时保存路径即 <uploads>/<源文件名>.md，显示名还原自 md 文件名；失败路径为源文件。 */
        const name = parsed ? basenameOf(path).replace(/\.md$/i, '') : basenameOf(path)
        seenPaths[path] = true
        files.push({ name: name || '文件', kind: parsed ? KIND_DOC : KIND_OTHER, path, sourcePath })
    }
    return files
}

/** 判断消息是否存在「已解析文件」标记（纯可读文本，无 token）。 */
function hasParseMarker(content: any): boolean {
    return PARSE_MARKER_RE !== null && PARSE_MARKER_RE.test(textOf(content))
}

/** 构建聊天卡片视图节点。 */
function chatNode(context: any, kind: string, anchorSeq: number, data: any): any {
    return {
        key: context.key,
        kind: kind,
        id: context.id,
        target: 'chat',
        anchorSeq: anchorSeq,
        location: (context.start && context.start.location) || (context.matches && context.matches[0] && context.matches[0].location) || { kind: 'unresolved' },
        visibility: 'visible',
        data: data,
    }
}

/** 已生成卡片的消息防重集合（供 chat 定义使用）。 */
function markStartedCard(messageId: string): boolean {
    if (messageId !== '' && startedCards.has(messageId)) return true
    if (messageId !== '') startedCards.add(messageId)
    return false
}

export { PARSE_STATUS_RE, PARSE_RE, PARSE_MARKER_RE, rebuildParsers, extractFiles, hasParseMarker, chatNode, markStartedCard, React }
