/**
 * 在输入框触发器（@ 提及）注册文件引用源。
 */
import { OmnifileController } from './controller.js'

/** 作用域 dispose 时自动注销（HMR 重载时旧源被清理，不会重复注册）。 */
function registerCodec(ctx: any, controller: OmnifileController): void {
    ctx.inject(['inputTriggers'], function (scope: any) {
        const triggers = scope && scope.get ? scope.get('inputTriggers') : undefined
        if (triggers === undefined || typeof triggers.registerSource !== 'function') return
        scope.effect(function () {
            return triggers.registerSource(controller.source())
        }, 'dsh-omnifile: file reference source')
    })
}

export { registerCodec }
