/**
 * 功能块：聊天文件卡片（chat-card）客户端 React 组件——单文件解析卡片
 * （展开/收缩 + 📂 打开源文件）与聊天文件分组。
 */
import * as React from 'react'
import { KIND_DOC, KIND_TEXT } from '../../../core/index.js'
import { iconFor, messageOf } from '../../../core/client/util.js'
import { LBL_COLLAPSE, LBL_EXPAND, LBL_OPEN_SOURCE } from './constants.js'

/** 单个文件的解析卡片：一行（图标+文件名+箭头+📂），位于用户消息上方；
 *  点击行展开/收缩，展开区懒加载显示转换后的 md 全文；📂 用本地默认程序打开源文件。 */
function ParseBlock(props: any): any {
    const file = props.file
    const sourcePath = file.sourcePath || file.path
    const [expanded, setExpanded] = React.useState(false)
    const [body, setBody] = React.useState<string | null>(null)
    const [error, setError] = React.useState<string | null>(null)
    const toggle = function (ev: any) {
        ev.stopPropagation()
        if (expanded) {
            setExpanded(false)
            return
        }
        setExpanded(true)
        if (body !== null || error !== null) return
        if (typeof props.loadParsed !== 'function') {
            setError('加载解析内容不可用')
            return
        }
        props.loadParsed(props.sessionId, file)
            .then(function (text: string) {
                setBody(text)
            })
            .catch(function (e: any) {
                setError(messageOf(e))
            })
    }
    const onKeyDown = function (e: any) {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            toggle(e)
        }
    }
    /* 展开时才构造内容区（限高+滚动容器）；收缩为 null，不生成多余节点。 */
    const bodyView = expanded
        ? body !== null
            ? React.createElement('div', { className: 'omnifile-parse-body' },
                React.createElement('pre', { className: 'omnifile-parse-pre' }, body))
            : error !== null
                ? React.createElement('div', { className: 'omnifile-parse-hint omnifile-parse-error' }, '加载解析内容失败：' + error)
                : React.createElement('div', { className: 'omnifile-parse-hint' }, '正在加载...')
        : null
    return React.createElement('div', { className: 'omnifile-parse-block' },
        React.createElement('div', {
            className: 'omnifile-parse-row',
            role: 'button',
            tabIndex: 0,
            'aria-expanded': expanded,
            'aria-label': (expanded ? LBL_COLLAPSE : LBL_EXPAND) + '：' + file.name,
            title: expanded ? LBL_COLLAPSE : LBL_EXPAND,
            onClick: toggle,
            onKeyDown: onKeyDown,
        },
            React.createElement('span', { className: 'omnifile-parse-icon' }, iconFor(file.kind, file.name)),
            React.createElement('span', { className: 'omnifile-parse-title' }, file.name),
            React.createElement('span', { className: 'omnifile-parse-caret', 'aria-hidden': 'true' }, expanded ? '▾' : '▸'),
            React.createElement('button', {
                type: 'button',
                className: 'omnifile-parse-open',
                'aria-label': LBL_OPEN_SOURCE + '：' + file.name,
                title: sourcePath + '（' + LBL_OPEN_SOURCE + '）',
                onClick: function (ev: any) {
                    ev.stopPropagation()
                    if (typeof props.openPath === 'function') props.openPath(sourcePath)
                },
                /* 阻止按键冒泡：聚焦按钮按 Enter/Space 只触发打开源文件，不触发行展开。 */
                onKeyDown: function (e: any) {
                    e.stopPropagation()
                },
            }, '📂'),
        ),
        bodyView,
    )
}

function OmnifileFilesCard(props: any): any {
    const node = props.node
    /* 兜底去重：同一路径只渲染一张卡片，避免重复 📝/文本卡片 */
    const seen: Record<string, boolean> = {}
    const files = ((node && node.data && node.data.files) || []).filter(function (file: any) {
        if (!file || !file.path) return false
        if (seen[file.path]) return false
        seen[file.path] = true
        return true
    })
    if (files.length === 0) return null
    /* 外层只做分组容器（右对齐），每张卡片由 ParseBlock 自持独立块，避免嵌套 parse-block */
    return React.createElement('div', { className: 'omnifile-chat-group' },
        files.map(function (file: any) {
            const key = file.path
            /* 文档/文本有解析结果 → 可展开的解析卡片；其余（未知格式）仅展示可点击的文件卡片。 */
            if (file.kind === KIND_DOC || file.kind === KIND_TEXT) {
                return React.createElement(ParseBlock, {
                    key: key,
                    file: file,
                    sessionId: props.sessionId,
                    openPath: props.openPath,
                    loadParsed: props.loadParsed,
                })
            }
            return React.createElement('div', { key: key, className: 'omnifile-chat-files' },
                React.createElement('button', {
                        type: 'button',
                        className: 'omnifile-chat-card',
                        title: (file.sourcePath || file.path) + '（' + LBL_OPEN_SOURCE + '）',
                        onClick: function () {
                            if (typeof props.openPath === 'function') props.openPath(file.sourcePath || file.path)
                        },
                    },
                    React.createElement('span', { className: 'omnifile-chip-icon' }, iconFor(file.kind, file.name)),
                    React.createElement('span', { className: 'omnifile-chat-name' }, file.name),
                ),
            )
        }),
    )
}

export { ParseBlock, OmnifileFilesCard }
