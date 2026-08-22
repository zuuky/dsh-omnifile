/**
 * 功能块：文件接入（file-intake）客户端 React 组件——输入区 dock（文件 chip +
 * 发送等待进度行）与「上传」按钮。
 */
import * as React from 'react'
import { humanBytes, iconFor, useStore } from '../../../core/client/util.js'
import { common, OmnifileController } from './controller.js'
import { LBL_ADD_FILES, LBL_CHIP_OPEN } from './constants.js'

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

export { OmnifileDock, UploadButton }
