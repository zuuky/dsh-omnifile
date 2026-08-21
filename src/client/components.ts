/**
 * 客户端 React 组件：输入区 dock（chip）/ 上传按钮 / 聊天文件卡片 / 解析卡 / 设置面板。
 */
import * as React from 'react'
import { SOURCE, KIND_DOC, KIND_TEXT } from '../common/index.js'
import { LBL_OPEN_SOURCE, LBL_CHIP_OPEN, LBL_ADD_FILES, LBL_EXPAND, LBL_COLLAPSE } from './constants.js'
import { useStore, messageOf, humanBytes, iconFor, setPath } from './util.js'
import { common, OmnifileController } from './controller.js'

function OmnifileDock(props: any): any {
    const controller = props.controller
    useStore(controller)
    const occurrences = ((props.input && props.input.occurrences) || []).filter(function (o: any) {
        return o.source === common.SOURCE
    })
    if (occurrences.length === 0) return null
    /* 点发送后仍有文件未解析完：在对话区底部显示实时解析进度（全部完成才随消息一起收起）。 */
    const sending: any[] = Array.from(controller.records.values()).filter(function (r: any) {
        return r.awaitingSend || r._waitNotified
    })
    const waiting = sending.filter(function (r: any) {
        return r.status !== 'done' && r.status !== 'error'
    })
    const doneCount = sending.length - waiting.length
    const currentDetail = waiting.length > 0
        ? (waiting[0].progressDetail || '解析中...')
        : (sending.length > 0 ? '即将完成...' : '')
    const sendWaitRow = waiting.length > 0
        ? React.createElement('div', { className: 'omnifile-sendwait' },
            React.createElement('span', { className: 'omnifile-sendwait-icon', 'aria-hidden': 'true' }, '⏳'),
            React.createElement('span', { className: 'omnifile-sendwait-text' },
                '正在解析文件 ' + doneCount + '/' + sending.length + '：' + currentDetail + '（完成后自动发送）'),
        )
        : null
    return React.createElement('div', { className: 'omnifile-dock', role: 'status', 'aria-label': '已附加文件' },
        occurrences.map(function (occurrence: any) {
            const record = controller.records.get(occurrence.ref)
            if (record === undefined) return null
            const detail = record.awaitingSend ? '等待解析完成后发送...'
                : record.status === 'processing' ? (record.progressDetail || '解析中...')
                    : record.status === 'done' ? '已就绪'
                        : record.status === 'error' ? (record.error || '失败')
                            : humanBytes(record.size)
            /* 移除仅受输入 phase 限制（发送等待期 phase 仍为 plain，可随时移除单个文件，不影响发送）。 */
            const disabled = !!(props.input && props.input.phase !== 'plain')
            return React.createElement('div', {
                    key: occurrence.occurrenceId,
                    className: 'omnifile-chip',
                    'data-status': record.status,
                    'data-clickable': disabled ? 'false' : 'true',
                    title: (record.error || record.path || '') + LBL_CHIP_OPEN,
                    onClick: function (ev: any) {
                        if (disabled) return
                        ev.stopPropagation()
                        if (typeof props.openPath === 'function' && record.path) props.openPath(record.path)
                    },
                },
                React.createElement('span', { className: 'omnifile-chip-icon' }, iconFor(record.kind, record.name)),
                React.createElement('span', { className: 'omnifile-chip-name' }, record.name),
                React.createElement('span', { className: 'omnifile-chip-detail' }, detail),
                React.createElement('button', {
                    type: 'button',
                    className: 'omnifile-chip-remove',
                    'aria-label': '移除 ' + record.name,
                    disabled: disabled,
                    onClick: function (ev: any) {
                        ev.stopPropagation()
                        props.remove(occurrence)
                    },
                }, '×'),
            )
        }),
        sendWaitRow,
    )
}

function UploadButton(props: any): any {
    const inputRef = React.useRef<any>(null)
    const controller = props.controller
    return React.createElement('button', {
            type: 'button',
            className: 'omnifile-upload-btn',
            'aria-label': LBL_ADD_FILES,
            title: LBL_ADD_FILES,
            onClick: function () {
                if (inputRef.current) inputRef.current.click()
            },
        },
        React.createElement('input', {
            ref: inputRef,
            type: 'file',
            multiple: true,
            style: { display: 'none' },
            onChange: function (e: any) {
                const files = Array.from(e.target.files || [])
                if (files.length > 0 && props.sessionId) props.controller.addFiles(props.sessionId, files)
                e.target.value = ''
            },
        }),
        React.createElement('svg', {
                width: 14,
                height: 14,
                viewBox: '0 0 16 16',
                fill: 'none',
                stroke: 'currentColor',
                strokeWidth: 1.5,
                strokeLinecap: 'round',
                strokeLinejoin: 'round',
                style: { flex: 'none', display: 'block' },
            },
            React.createElement('path', { d: 'M8 10V3' }),
            React.createElement('path', { d: 'M4.5 6L8 2.5L11.5 6' }),
            React.createElement('path', { d: 'M3 11.5v1.5h10v-1.5' }),
        ),
    )
}

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

export { OmnifileDock, UploadButton, OmnifileFilesCard, ParseBlock }
