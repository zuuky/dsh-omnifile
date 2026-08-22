/**
 * 功能块：文件接入（file-intake）客户端 DOM——全局拖拽/粘贴文件捕获。
 * 另一部分（用户消息气泡里 marker 段隐藏）属于 chat-card 功能块（见其 client/dom.ts）。
 */
import { OmnifileController } from './controller.js'
import { collectFiles } from '../../../core/client/util.js'

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

export { installPasteAndDrag }
