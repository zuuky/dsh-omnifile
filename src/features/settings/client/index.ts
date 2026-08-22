/**
 * 功能块：设置（settings）客户端入口。
 * 装配设置页「DshOmniFile」小节（settings.section 槽位）并注入本功能块的样式。
 */
import { NAMESPACE } from '../../../core/index.js'
import { installStyles } from '../../../core/client/styles.js'
import { OmnifileSettings } from './components.js'
import { css } from './styles.js'

/** 本功能块样式（由组合根统一注入）。 */
export { css }

function installSettings(ctx: any): void {
    ctx.effect(() => installStyles(css, 'settings'), 'dsh-omnifile: settings styles')

    /* 设置页小节：多模态模型配置（从「设置-模型」全量枚举 + 参数调整）。 */
    ctx.slots.inject('settings.section', function () {
        return ctx.slots.register({
            name: 'settings.section',
            id: 'omnifile',
            order: 30,
            label: function () {
                return 'DshOmniFile'
            },
            inject: function () {
                let scope: any
                try {
                    const binder = ctx.get('settingsScope')
                    if (binder && typeof binder.bind === 'function') scope = binder.bind({ namespace: NAMESPACE })
                } catch (e) {
                    scope = undefined
                }
                return { scope: scope }
            },
        }, OmnifileSettings)
    })
}

export { installSettings }
