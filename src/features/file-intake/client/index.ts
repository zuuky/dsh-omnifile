/**
 * 功能块：文件接入（file-intake）客户端入口。
 *
 * 装配输入区两个槽位（文件 chip dock + 上传按钮）、全局拖拽/粘贴捕获、
 * @ 文件选择器引用源，并注入本功能块的样式。
 */
import { installStyles } from '../../../core/client/styles.js'
import { OmnifileController } from './controller.js'
import { installPasteAndDrag } from './dom.js'
import { registerCodec } from './source.js'
import { OmnifileDock, UploadButton } from './components.js'
import { css } from './styles.js'

/** 本功能块样式（由组合根统一注入）。 */
export { css }

function installFileIntake(ctx: any, controller: OmnifileController): void {
    ctx.effect(() => installStyles(css, 'file-intake'), 'dsh-omnifile: file-intake styles')

    /* 全局拖拽/粘贴文件捕获。 */
    installPasteAndDrag(ctx, controller)
    /* 输入框 @ 文件引用源注册。 */
    registerCodec(ctx, controller)

    /* 输入区 dock：文件 chip + 发送等待进度行。 */
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

    /* 输入区左侧「上传」按钮。 */
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
}

export { installFileIntake }
