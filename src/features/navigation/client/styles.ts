/**
 * 功能块：会话内消息导航（navigation）客户端样式。
 * 由 core/client/styles.ts 注入为独立 <style> 标签。
 */
const css = [
    /* ── 会话内用户消息快速定位导航（nav.ts）：贴消息流右缘，低层级；事件默认穿透，hover 命中带才可交互 ── */
    '.omnifile-nav{position:fixed;top:50%;transform:translateY(-50%);z-index:40;display:none;flex-direction:column;align-items:center;gap:12px;padding:8px 3px;border-radius:12px;font-family:system-ui;max-height:calc(100vh - 32px);overflow-y:auto;scrollbar-width:none;pointer-events:none;background:transparent;border:1px solid transparent;}',
    '.omnifile-nav::-webkit-scrollbar{display:none;}',
    '.omnifile-nav.active{pointer-events:auto;}',
    '.omnifile-nav-strip{position:fixed;top:0;bottom:0;width:48px;z-index:39;background:transparent;}',
    '.omnifile-nav-dot{width:10px;height:10px;padding:0;border:none;border-radius:999px;background:rgba(128,128,140,.45);cursor:pointer;flex:none;transition:width .18s ease,height .18s ease,background .18s ease,transform .18s ease;}',
    '.omnifile-nav-dot:hover{width:24px;height:10px;background:rgba(128,128,140,.8);}',
    '.omnifile-nav-dot.active{width:24px;height:10px;background:var(--dsw-alias-text-accent,#4c9aff);}',
    '.omnifile-nav-dot.active:hover{background:var(--dsw-alias-text-accent,#4c9aff);}',
    '.omnifile-nav-more{width:22px;height:22px;padding:0;border:none;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;flex:none;cursor:pointer;color:var(--dsw-alias-label-secondary,#666);background:rgba(128,128,140,.12);box-shadow:inset 0 0 0 1px rgba(128,128,140,.18);font-size:12px;line-height:1;transition:color .18s ease,background .18s ease;}',
    '.omnifile-nav-more:hover{color:var(--dsw-alias-brand-primary,#4c9aff);background:rgba(128,128,140,.2);}',
    /* hover 圆点 → 用户消息内容预览（文本由 nav.ts 截断到 100 字） */
    '.omnifile-nav-tip{position:fixed;z-index:45;max-width:320px;box-sizing:border-box;padding:8px 10px;border-radius:8px;font-size:12px;line-height:1.55;color:var(--dsw-alias-text-1,#eee);background:var(--dsw-hovercard-bg,#2C2C2E);box-shadow:var(--dsw-shadow-lv3);pointer-events:none;white-space:pre-wrap;word-break:break-word;overflow:hidden;display:-webkit-box;-webkit-line-clamp:6;-webkit-box-orient:vertical;}',
    '@media (prefers-reduced-motion:reduce){.omnifile-nav,.omnifile-nav-dot{transition:none;animation:none;}}',
].join('')

export { css }
