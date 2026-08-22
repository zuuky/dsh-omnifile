/**
 * 功能块：会话内消息导航（navigation）客户端入口。
 * 装配「用户消息」快速定位导航条并注入本功能块的样式。
 */
import { installStyles } from '../../../core/client/styles.js'
import { installConversationNav } from './nav.js'
import { css } from './styles.js'

/** 本功能块样式（由组合根统一注入）。 */
export { css }

function installNavigation(ctx: any): void {
    ctx.effect(() => installStyles(css, 'navigation'), 'dsh-omnifile: navigation styles')
    /* 会话内「用户消息」快速定位导航：≥2 条用户消息才显示，点击锚点圆点定位。 */
    installConversationNav(ctx)
}

export { installNavigation }
