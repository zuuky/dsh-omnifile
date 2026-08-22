/**
 * 会话内「用户消息」快速定位导航（精简版，替代独立插件 @vlln/dsh-navbar）。
 *
 * 目标与取舍：
 * - 无用户消息时完全不显示；≥1 条即显示，每条一个锚点圆点，点击即滚动定位，
 *   长 AI 回复中可快速回到各用户提问；
 * - 超过 10 条用户消息时窗口化：只渲染当前视口附近 10 条，窗口上下两端出现
 *   「展开更多」（▲/▼）按钮，点击定位到更早/更晚的一批（窗口随视口锚点移动）；
 * - 不挡弹窗/页面：指针事件默认穿透（pointer-events:none）+ 低 z-index，
 *   平时不拦截任何鼠标；鼠标移入聊天区右缘的命中带才切换为可交互。
 *
 * DOM 约定来自官方 dsh-client-ui-conversation（v0.1.1-rc.2 已核对）：
 *   流容器 `[data-chat-flow]`；消息行 `[data-time-hover-root]`；
 *   用户行 = 无 `data-turn-tail` 且含 `.bubble`；`data-pending-steering` 为待发送行。
 */

/** <nav>、命中带（strip）、锚点圆点、「更多」按钮与内容预览的元素标识（样式见 styles.ts）。 */
const NAV_ATTR = 'data-omnifile-nav'
const STRIP_ATTR = 'data-omnifile-nav-strip'
const DOT_ATTR = 'data-omnifile-nav-dot'
const MORE_ATTR = 'data-omnifile-nav-more'
const TIP_ATTR = 'data-omnifile-nav-tip'
/** 导航条与消息流右缘的水平间距（右移一点，避免贴对话框太紧）。 */
const NAV_OFFSET = 20
/** 窗口化阈值：超过该条数时只渲染视口附近的一批锚点。 */
const WINDOW = 10
/** hover 预览的用户消息文本最大字符数（超出截断 + 省略号）。 */
const TIP_MAX_LEN = 100

/** 定位导航：一次 llm 云输出可能拉高 flow，需跟随流宽度重新贴右缘。 */
function installConversationNav(ctx: any): void {
    if (typeof document === 'undefined' || document.body === null) return
    const body = document.body
    const strip = document.createElement('div')
    strip.className = 'omnifile-nav-strip'
    strip.setAttribute(STRIP_ATTR, '')
    const bar = document.createElement('nav')
    bar.className = 'omnifile-nav'
    bar.setAttribute(NAV_ATTR, '')
    bar.setAttribute('aria-label', '用户消息导航')
    body.appendChild(strip)
    body.appendChild(bar)
    const tip = document.createElement('div')
    tip.className = 'omnifile-nav-tip'
    tip.setAttribute(TIP_ATTR, '')
    tip.style.display = 'none'
    body.appendChild(tip)

    /* ── DOM 约定：流 / 滚动容器 / 用户消息行 ── */
    const flowOf = () => document.querySelector('[data-chat-flow]') ?? document.querySelector('[data-focus-flow]')
    const scrollerOf = () => {
        const flow = flowOf()
        if (flow === null) return null
        let n = flow.parentElement
        while (n !== null) {
            const s = getComputedStyle(n)
            if (s.overflowY === 'auto' || s.overflowY === 'scroll') return n
            n = n.parentElement
        }
        return null
    }
    const allRows = () => [...document.querySelectorAll('[data-time-hover-root]')]
        .filter((row) => !row.hasAttribute('data-pending-steering'))
    const userRows = () => allRows().filter((row) =>
        !row.hasAttribute('data-turn-tail') && row.querySelector('[class*="bubble"]') !== null)

    /* ── 定位：贴消息流右缘，固定视口（稳定可见），低层级 + 事件穿透 ── */
    const position = () => {
        const flow = flowOf()
        if (flow === null) return
        const right = flow.getBoundingClientRect().right
        const next = Math.max(8, Math.min(right + NAV_OFFSET, window.innerWidth - bar.offsetWidth - 8))
        if (bar.style.left !== next + 'px') bar.style.left = next + 'px'
        const stripLeft = Math.max(4, next - 20)
        if (strip.style.left !== stripLeft + 'px') strip.style.left = stripLeft + 'px'
    }
    let posScheduled = false
    const requestPosition = () => {
        if (posScheduled) return
        posScheduled = true
        requestAnimationFrame(() => {
            posScheduled = false
            position()
        })
    }

    /* ── 视口内当前用户消息 → 激活圆点 ── */
    const computeActive = (rows: Element[]): number => {
        if (rows.length === 0) return -1
        let best = 0
        let found = false
        let bestTop = Number.POSITIVE_INFINITY
        for (let i = 0; i < rows.length; i++) {
            const top = rows[i].getBoundingClientRect().top
            if (top >= 0 && top < bestTop) {
                bestTop = top
                best = i
                found = true
            }
        }
        return found ? best : rows.length - 1
    }
    /** 圆点列按「窗口起点 lo + 序号」对齐激活位（头部/尾部可能有「更多」按钮）。 */
    const updateActive = (rows: Element[], lo: number, active: number) => {
        const dots = [...bar.querySelectorAll('[' + DOT_ATTR + ']')]
        for (let i = 0; i < dots.length; i++) {
            if (lo + i === active) dots[i].classList.add('active')
            else dots[i].classList.remove('active')
        }
    }

    /* ── 点击圆点/更多按钮 → 滚动定位到该用户消息 ── */
    const jumpToRow = (row: Element) => {
        const scroller = scrollerOf()
        if (scroller === null || !(scroller instanceof HTMLElement)) return
        /* DSH 会话流可能带增量渲染：wheel(-1) 唤醒后再做位移计算。 */
        scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, bubbles: true, cancelable: true }))
        scroller.scrollTop = scroller.scrollTop + row.getBoundingClientRect().top - scroller.getBoundingClientRect().top
    }

    /* ── hover 圆点 → 用户消息内容预览（100 字截断），定位在圆点左侧 ── */
    const contentOf = (row: Element): string => {
        const bubble = row.querySelector('[class*="bubble"]')
        const text = ((bubble ?? row).textContent ?? '').trim().replace(/\s+/g, ' ')
        return text.length > TIP_MAX_LEN ? text.slice(0, TIP_MAX_LEN) + '…' : text
    }
    const hideTip = () => {
        tip.style.display = 'none'
    }
    const showTip = (row: Element, anchor: Element) => {
        const text = contentOf(row)
        if (text === '') return
        tip.textContent = text
        const r = anchor.getBoundingClientRect()
        tip.style.display = 'block'
        const right = Math.max(8, window.innerWidth - r.left + 14)
        const top = Math.max(8, r.top - 8)
        tip.style.right = right + 'px'
        tip.style.top = top + 'px'
        if (tip.offsetHeight > 0 && top + tip.offsetHeight > window.innerHeight - 8) {
            tip.style.top = (window.innerHeight - tip.offsetHeight - 8) + 'px'
        }
    }

    /* ── 渲染：无用户消息 → 隐藏；否则按窗口重建圆点（+上下「更多」）并高亮当前 ── */
    let builtRows: Element[] = []
    let builtLo = 0
    let builtHi = -1
    const render = () => {
        position()
        if (flowOf() === null) {
            bar.style.display = 'none'
            return
        }
        const rows = userRows()
        if (rows.length === 0) {
            bar.style.display = 'none'
            return
        }
        bar.style.display = 'flex'
        const active = computeActive(rows)
        /* 窗口：默认全量；超过窗口时收窄到「active 居中」的 10 条。 */
        let lo = 0
        let hi = rows.length - 1
        if (rows.length > WINDOW) {
            lo = Math.min(Math.max(0, active - (WINDOW >> 1)), rows.length - WINDOW)
            hi = lo + WINDOW - 1
        }
        if (rows.length === builtRows.length && lo === builtLo && hi === builtHi
            && rows.every((row, i) => row === builtRows[i])) {
            updateActive(rows, lo, active)
            return
        }
        bar.textContent = ''
        hideTip()
        const makeMore = (dir: string, label: string, target: Element | undefined) => {
            const more = document.createElement('button')
            more.type = 'button'
            more.className = 'omnifile-nav-more'
            more.setAttribute(MORE_ATTR, '')
            more.setAttribute('data-dir', dir)
            more.setAttribute('aria-label', label)
            more.textContent = dir === 'up' ? '▲' : '▼'
            more.addEventListener('click', () => {
                if (target === undefined) return
                jumpToRow(target)
                schedule()
            })
            bar.appendChild(more)
        }
        if (lo > 0) makeMore('up', '展开更早的用户消息', rows[Math.max(0, lo - 1)])
        for (let i = lo; i <= hi; i++) {
            const dot = document.createElement('button')
            dot.type = 'button'
            dot.className = 'omnifile-nav-dot'
            dot.setAttribute(DOT_ATTR, '')
            dot.setAttribute('aria-label', 'user #' + (i + 1) + '（点击跳转）')
            dot.setAttribute('title', 'user #' + (i + 1))
            dot.addEventListener('click', () => jumpToRow(rows[i]))
            dot.addEventListener('mouseenter', () => showTip(rows[i], dot))
            dot.addEventListener('mousemove', () => showTip(rows[i], dot))
            dot.addEventListener('mouseleave', hideTip)
            bar.appendChild(dot)
        }
        if (hi < rows.length - 1) makeMore('down', '展开更新的用户消息', rows[Math.min(rows.length - 1, hi + 1)])
        builtRows = rows
        builtLo = lo
        builtHi = hi
        updateActive(rows, lo, active)
    }
    let renderScheduled = false
    const schedule = () => {
        if (renderScheduled) return
        renderScheduled = true
        requestAnimationFrame(() => {
            renderScheduled = false
            render()
        })
    }

    /* ── 交互门控：常态 pointer-events:none，命中带/导航 hover 才点亮 ── */
    const setActive = (value: boolean) => {
        if (value) bar.classList.add('active')
        else bar.classList.remove('active')
    }
    strip.addEventListener('mouseenter', () => setActive(true))
    strip.addEventListener('mouseleave', () => setActive(false))
    bar.addEventListener('mouseenter', () => setActive(true))
    bar.addEventListener('mouseleave', () => setActive(false))

    /* ── 生命周期：内容/尺寸/滚动变化统一收敛到 render/updateActive ── */
    let currentScroller: Element | null = null
    const bindScroller = () => {
        const next = scrollerOf()
        if (next === currentScroller) return
        if (currentScroller !== null) currentScroller.removeEventListener('scroll', onScroll)
        currentScroller = next
        if (currentScroller !== null) currentScroller.addEventListener('scroll', onScroll)
    }
    const onScroll = () => schedule()

    /* flow 容器可能随会话/布局切换而替换；body 尺寸在侧栏折叠/面板开合时常不变，
     * 因此把 ResizeObserver 动态绑到当前 flow 上，聊天区宽度一变（窗口缩放/侧栏折叠/
     * 面板开合/分栏拖动）导航就自动贴回新右缘。 */
    let currentFlow: Element | null = null
    let flowObserver: ResizeObserver | null = null
    const bindFlow = () => {
        const next = flowOf()
        if (next === currentFlow) return
        if (flowObserver !== null) {
            flowObserver.disconnect()
            flowObserver = null
        }
        currentFlow = next
        if (currentFlow !== null) {
            flowObserver = new ResizeObserver(() => requestPosition())
            flowObserver.observe(currentFlow)
        }
    }
    const observer = new MutationObserver(() => {
        bindScroller()
        bindFlow()
        schedule()
    })

    ctx.effect(() => {
        observer.observe(document.body, { childList: true, subtree: true })
        /* body 尺寸兜底 + flow 尺寸（聊天区宽度/布局变化）双路监听。 */
        const sizeObserver = new ResizeObserver(() => requestPosition())
        sizeObserver.observe(document.body)
        window.addEventListener('resize', requestPosition)
        bindScroller()
        bindFlow()
        render()
        return () => {
            observer.disconnect()
            sizeObserver.disconnect()
            if (flowObserver !== null) {
                flowObserver.disconnect()
                flowObserver = null
            }
            window.removeEventListener('resize', requestPosition)
            if (currentScroller !== null) currentScroller.removeEventListener('scroll', onScroll)
            strip.remove()
            bar.remove()
            tip.remove()
        }
    }, 'dsh-omnifile: conversation nav')
}

export { installConversationNav }
