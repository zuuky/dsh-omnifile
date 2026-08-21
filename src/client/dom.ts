/**
 * 客户端 DOM 集成：拖拽/粘贴文件捕获 + 用户消息气泡里 marker 段隐藏。
 */
import { MARKER_PREFIX, MARKER_STATUS_OK, MARKER_STATUS_UNREADABLE, MARKER_STATUS_FAILED, MARKER_UNKNOWN } from '../common/index.js'
import { OmnifileController } from './controller.js'
import { escapeRegExp, collectFiles } from './util.js'

/** 注册全局拖拽/粘贴文件捕获（冒泡阶段，仅处理含文件的 DataTransfer）。 */
function installPasteAndDrag(ctx: any, controller: OmnifileController): void {
    const hasFiles = function (e: any) {
        return e.dataTransfer && Array.from(e.dataTransfer.types || []).indexOf('Files') >= 0
    }
    let overlay: any = null
    let overlayDepth = 0
    const showOverlay = function () {
        overlayDepth += 1
        if (overlay === null && typeof document !== 'undefined') {
            overlay = document.createElement('div')
            overlay.className = 'omnifile-overlay'
            const box = document.createElement('div')
            box.className = 'omnifile-overlay-box'
            box.textContent = '松开鼠标把文件添加进对话'
            overlay.appendChild(box)
            (document.body || document.documentElement).appendChild(overlay)
        }
    }
    const hideOverlay = function () {
        overlayDepth = Math.max(0, overlayDepth - 1)
        if (overlayDepth === 0 && overlay !== null) {
            overlay.remove()
            overlay = null
        }
    }
    const onDragEnter = function (e: any) {
        if (!hasFiles(e)) return
        e.preventDefault()
        e.stopPropagation()
        showOverlay()
    }
    const onDragOver = function (e: any) {
        if (!hasFiles(e)) return
        e.preventDefault()
        e.stopPropagation()
    }
    const onDragLeave = function (e: any) {
        if (!hasFiles(e)) return
        hideOverlay()
    }
    const onDrop = function (e: any) {
        if (!hasFiles(e)) return
        e.preventDefault()
        e.stopPropagation()
        hideOverlay()
        const files = collectFiles(e.dataTransfer)
        if (files.length === 0) return
        const sessionId = controller.currentSessionId()
        if (sessionId === undefined) return
        controller.addFiles(sessionId, files)
    }
    const onPaste = function (e: any) {
        const files = collectFiles(e.clipboardData)
        if (files.length === 0) return
        const target = e.target
        if (!(target && target.tagName === 'TEXTAREA') || !(target.closest && target.closest('[data-composer-card]'))) return
        e.preventDefault()
        e.stopPropagation()
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation()
        const sessionId = controller.currentSessionId()
        if (sessionId === undefined) return
        controller.addFiles(sessionId, files)
    }
    ctx.effect(function () {
        document.addEventListener('dragenter', onDragEnter, true)
        document.addEventListener('dragover', onDragOver, true)
        document.addEventListener('dragleave', onDragLeave, true)
        document.addEventListener('drop', onDrop, true)
        document.addEventListener('paste', onPaste, true)
        return function () {
            document.removeEventListener('dragenter', onDragEnter, true)
            document.removeEventListener('dragover', onDragOver, true)
            document.removeEventListener('dragleave', onDragLeave, true)
            document.removeEventListener('drop', onDrop, true)
            document.removeEventListener('paste', onPaste, true)
            if (overlay !== null) {
                overlay.remove()
                overlay = null
            }
        }
    }, 'dsh-omnifile: paste & drop capture')
}

/* 用户消息气泡里不出现任何文件解析信息（marker 仍保留在 content 中，
 * 供模型 read/read_image 工具识别保存路径）。DSH 的用户气泡把全部 text 块拼成
 * 单个纯文本 div，没有按行过滤的渲染缝；这里用 MutationObserver 把 marker
 * （「解析后保存路径：…（状态…）」整段）包成 display:none 的 span，只影响本
 * 插件 marker，不影响其它消息/插件；历史与新增消息都由 observer 统一覆盖。 */
function installMarkerHiding(ctx: any): void {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return
    /* 守卫：某个节点及其祖先是本插件已隐藏的 span → 不再处理，
     * 避免 hideMarkerInText 的 replaceChild 触发 observer → 再次包裹的死循环。 */
    const insideHidden = function (node: any) {
        let cur = node
        while (cur !== null && cur !== document) {
            if (cur.nodeType === 1 && cur.getAttribute && cur.getAttribute('data-omnifile-hidden')) return true
            cur = cur.parentNode
        }
        return false
    }
    const scanNode = function (root: any) {
        if (root === null || root === undefined || root.nodeType !== 1) return
        if (insideHidden(root)) return
        if (root.textContent === undefined || root.textContent.indexOf(MARKER_PREFIX) < 0) return
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null)
        const hits: any[] = []
        while (true) {
            const node = walker.nextNode()
            if (node === null) break
            if (node.nodeValue && node.nodeValue.indexOf(MARKER_PREFIX) >= 0) hits.push(node)
        }
        for (const textNode of hits) hideMarkerInText(textNode)
    }
    const hideMarkerInText = function (textNode: any) {
        if (textNode.parentNode === null || insideHidden(textNode)) return
        const text = String(textNode.nodeValue || '')
        const statusGroup = '(?:' + escapeRegExp(MARKER_STATUS_OK)
            + '|' + escapeRegExp(MARKER_STATUS_UNREADABLE)
            + '|' + escapeRegExp(MARKER_STATUS_FAILED)
            + '|' + escapeRegExp(MARKER_UNKNOWN) + ')'
        const markerRe = new RegExp('(\\r?\\n)?' + escapeRegExp(MARKER_PREFIX)
            + '(.+?)（(' + statusGroup + '[^）]*)）(\\r?\\n)?', 'g')
        const ranges: Array<{ start: number; end: number }> = []
        let m: RegExpExecArray | null
        while ((m = markerRe.exec(text)) !== null) {
            ranges.push({ start: m.index, end: m.index + m[0].length })
        }
        if (ranges.length === 0) return
        const parent = textNode.parentNode
        if (parent === null) return
        const fragment = document.createDocumentFragment()
        let cursor = 0
        for (const range of ranges) {
            if (range.start > cursor) fragment.appendChild(document.createTextNode(text.slice(cursor, range.start)))
            const hidden = document.createElement('span')
            hidden.className = 'omnifile-hidden-marker'
            hidden.setAttribute('data-omnifile-hidden', '1')
            hidden.textContent = text.slice(range.start, range.end)
            fragment.appendChild(hidden)
            cursor = range.end
        }
        if (cursor < text.length) fragment.appendChild(document.createTextNode(text.slice(cursor)))
        parent.replaceChild(fragment, textNode)
    }
    const observer = new MutationObserver(function (mutations: any[]) {
        for (const mutation of mutations) {
            for (const added of mutation.addedNodes) {
                if (added.nodeType === 3) {
                    if (added.nodeValue && added.nodeValue.indexOf(MARKER_PREFIX) >= 0) hideMarkerInText(added)
                } else if (added.nodeType === 1) {
                    scanNode(added)
                }
            }
        }
    })
    if (document.body !== null) scanNode(document.body)
    observer.observe(document.documentElement, { subtree: true, childList: true })
    ctx.effect(function () {
        return function () {
            observer.disconnect()
        }
    })
}

export { installPasteAndDrag, installMarkerHiding }
