/**
 * 客户端通用工具函数。
 */
import * as React from 'react'
import { KIND_IMAGE, KIND_DOC, KIND_MEDIA } from '../common/index.js'

/** 生成唯一 id（优先 crypto.randomUUID）。 */
function id(): string {
    if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID()
    return 'omnifile-' + Date.now() + '-' + Math.floor(Math.random() * 1e6)
}

/** 人类可读字节数。 */
function humanBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return ''
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}

/** 提取错误的可读消息（Promise reject / try-catch 通用）。 */
function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

/** 订阅 store：封装 useSyncExternalStore；兼容只暴露 snapshot() 的对象（如本插件 controller）。 */
function useStore(store: any): any {
    const read = typeof store.getSnapshot === 'function'
        ? function () { return store.getSnapshot() }
        : function () { return store.snapshot() }
    return React.useSyncExternalStore(
        function (onStoreChange: () => void) { return store.subscribe(onStoreChange) },
        read,
        read,
    )
}

/** 文件类别 → 图标。 */
function iconFor(kind: string, name: string): string {
    const ext = String(name || '').split('.').pop().toLowerCase()
    if (kind === KIND_IMAGE) return '🖼'
    if (kind === KIND_DOC) {
        if (ext === 'pdf') return '📕'
        if (['doc', 'docx', 'docm', 'rtf', 'odt'].indexOf(ext) >= 0) return '📘'
        if (['xls', 'xlsx', 'xlsm', 'xlsb', 'ods', 'csv'].indexOf(ext) >= 0) return '📗'
        if (['ppt', 'pptx', 'pptm', 'pps', 'ppsx', 'pot', 'ppsm', 'odp'].indexOf(ext) >= 0) return '📙'
        if (ext === 'epub') return '📚'
        return '📄'
    }
    if (kind === KIND_MEDIA) return '🎞'
    return '📝'
}

/** 是否图片文件（按 MIME type 判断）。 */
function isImageFile(file: File): boolean {
    return typeof file.type === 'string' && file.type.toLowerCase().startsWith('image/')
}

/** 从拖拽/粘贴事件数据收集文件。 */
function collectFiles(data: any): File[] {
    if (data === null || data === undefined) return []
    const itemFiles = Array.from(data.items || [])
        .filter(function (item: any) {
            return item.kind === 'file'
        })
        .map(function (item: any) {
            return item.getAsFile()
        })
        .filter(function (file: File | null) {
            return file !== null
        })
    return itemFiles.length > 0 ? itemFiles : Array.from(data.files || [])
}

/** 取消息内容块中的纯文本。 */
function textOf(content: any): string {
    if (!Array.isArray(content)) return ''
    return content
        .filter(function (block: any) {
            return block && block.type === 'text'
        })
        .map(function (block: any) {
            return String(block.text || '')
        })
        .join('\n')
}

/** 取路径 basename（兼容 / 与 \）。 */
function basenameOf(path: string): string {
    return String(path || '').split(/[\\/]/).pop() || ''
}

/** RegExp 转义（用于把 common 常量安全拼进正则；避免 $& / 隐患，逐字符处理）。 */
function escapeRegExp(text: string): string {
    const special = '\\^$.*+?()[]{}|'
    const s = String(text || '')
    let out = ''
    for (let i = 0; i < s.length; i++) {
        const c = s.charAt(i)
        if (special.indexOf(c) >= 0) out += '\\'
        out += c
    }
    return out
}

/** 按路径段设置嵌套对象的值（设置页表单用）。 */
function setPath(obj: any, segs: string[], val: any): any {
    let target = obj
    for (let i = 0; i < segs.length - 1; i++) {
        if (typeof target[segs[i]] !== 'object' || target[segs[i]] === null) target[segs[i]] = {}
        target = target[segs[i]]
    }
    target[segs[segs.length - 1]] = val
    return obj
}

export { id, humanBytes, messageOf, useStore, iconFor, isImageFile, collectFiles, textOf, basenameOf, escapeRegExp, setPath }
