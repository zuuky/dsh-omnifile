/**
 * 客户端样式：全部 CSS 常量 + <style> 注入。
 */
const CSS = [
    '.omnifile-dock{box-sizing:border-box;width:100%;max-width:var(--dsh-composer-card-max-width,960px);margin:0 auto;display:flex;flex-wrap:wrap;gap:6px;padding:2px 4px;}',
    '.omnifile-sendwait{box-sizing:border-box;width:100%;display:flex;align-items:center;gap:8px;padding:8px 12px;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12));border-radius:10px;background:var(--dsw-specific-tip,rgba(128,128,128,.08));font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary,#666);}',
    '.omnifile-sendwait-icon{flex:none;font-size:13px;line-height:1;}',
    '.omnifile-sendwait-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:auto;}',
    '.omnifile-chip{box-sizing:border-box;display:inline-flex;align-items:center;gap:6px;max-width:260px;height:30px;padding:0 6px 0 8px;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12));border-radius:10px;background:var(--dsw-specific-tip,rgba(128,128,128,.08));font-size:12px;line-height:1;color:var(--dsw-alias-label-primary,#222);}',
    '.omnifile-chip[data-status="error"]{border-color:var(--dsw-alias-state-error-primary,#d03050);}',
    '.omnifile-chip-icon{flex:none;font-size:14px;line-height:1;}',
    '.omnifile-chip-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:auto;}',
    '.omnifile-chip-detail{color:var(--dsw-alias-label-tertiary,#888);flex:none;font-size:11px;}',
    '.omnifile-chip-remove{border:none;background:transparent;color:var(--dsw-alias-label-tertiary,#888);cursor:pointer;font-size:14px;line-height:1;padding:2px;border-radius:4px;flex:none;}',
    '.omnifile-chip-remove:hover{color:var(--dsw-alias-label-primary,#222);background:rgba(0,0,0,.06);}',
    '.omnifile-chip[data-clickable="true"]{cursor:pointer;}',
    '.omnifile-chip[data-clickable="true"]:hover{background:rgba(0,0,0,.08);}',
    /* 输入框内文件 chip 以可见 label（文件名）呈现；
     * 不隐藏 label，避免 textarea 中 U+FFFC 原本体裸露成"隐形占位"。 */
    '[data-input-backdrop] span[data-decoration="chip"]{cursor:pointer;}',
    '.omnifile-chat-files{display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-end;width:100%;}',
    '.omnifile-chat-card{box-sizing:border-box;display:inline-flex;align-items:center;gap:6px;max-width:300px;height:34px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12));border-radius:10px;background:var(--dsw-specific-tip,rgba(128,128,128,.08));cursor:pointer;color:var(--dsw-alias-label-primary,#222);font-size:12px;text-align:left;}',
    '.omnifile-chat-card:hover{background:rgba(0,0,0,.08);}',
    '.omnifile-chat-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:auto;}',
    '.omnifile-upload-btn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;flex:none;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#666);cursor:pointer;padding:0;}',
    '.omnifile-upload-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));}',
    '.omnifile-upload-btn:disabled{opacity:.5;cursor:default;}',
    '.omnifile-overlay{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;pointer-events:none;background:rgba(20,40,120,.08);backdrop-filter:blur(1px);font-size:15px;color:var(--dsw-alias-label-primary,#222);}',
    '.omnifile-overlay-box{background:var(--dsw-alias-bg-elevation,#fff);border:1px dashed var(--dsw-alias-brand-primary,#4b6bfb);border-radius:14px;padding:18px 28px;box-shadow:0 8px 30px rgba(0,0,0,.15);}',
    '.omnifile-hint{color:var(--dsw-alias-label-tertiary,#888);font-size:12px;line-height:1.6;}',
    /* 解析卡片：一行，宽度 = 对话框宽度（跟随容器变化，展开不跳动） */
    '.omnifile-parse-block{box-sizing:border-box;display:flex;flex-direction:column;gap:4px;width:100%;min-width:0;}',
    /* 多条文件消息分组容器：每条解析块各自独立（避免嵌套 parse-block） */
    '.omnifile-chat-group{box-sizing:border-box;display:flex;flex-direction:column;gap:6px;width:100%;}',
    '.omnifile-parse-row{box-sizing:border-box;display:flex;align-items:center;gap:8px;height:30px;max-width:100%;padding:0 10px;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12));border-radius:10px;background:var(--dsw-specific-tip,rgba(128,128,128,.08));cursor:pointer;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1;user-select:none;}',
    '.omnifile-parse-row:hover{background:rgba(0,0,0,.08);}',
    '.omnifile-parse-icon{flex:none;font-size:14px;line-height:1;}',
    '.omnifile-parse-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:auto;color:var(--dsw-alias-label-primary);}',
    '.omnifile-parse-caret{flex:none;width:12px;text-align:center;font-size:11px;line-height:1;color:var(--dsw-alias-label-tertiary,#888);}',
    '.omnifile-parse-open{flex:none;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#666);cursor:pointer;font-size:13px;line-height:1;}',
    '.omnifile-parse-open:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));color:var(--dsw-alias-label-primary,#222);}',
    /* 展开的解析结果内容区：滚动查看转换后的 md 全文 */
    '.omnifile-parse-body{box-sizing:border-box;width:100%;min-width:0;max-height:360px;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;scrollbar-width:thin;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12));border-radius:10px;background:var(--dsw-specific-input-major,var(--dsw-alias-bg-base,#fff));}',
    '.omnifile-parse-pre{margin:0;padding:10px 12px;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-primary,#222);}',
    '.omnifile-parse-hint{padding:10px 12px;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-tertiary,#888);}',
    '.omnifile-parse-error{color:var(--dsw-alias-state-error-primary,#d03050);}',
    /* 用户消息气泡里的 marker 段（保留在 content 供模型 read/read_image 用），
     * 由 installMarkerHiding 包成隐藏 span，视觉上不出现任何解析信息。 */
    '.omnifile-hidden-marker{display:none!important;}',
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
    /* ── 设置页「多模态模型配置」面板（跟随 DSH theme 明暗/主题色） ── */
    '.omnifile-cfg{box-sizing:border-box;display:flex;flex-direction:column;gap:14px;max-width:720px;padding:16px;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12));border-radius:12px;background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base,#fff));color:var(--dsw-alias-label-primary,#222);}',
    '.omnifile-cfg-head{display:flex;flex-direction:column;gap:4px;}',
    '.omnifile-cfg-title{margin:0;font:var(--dsw-font-l-strong-16,600 16px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif);color:var(--dsw-alias-label-primary,#222);}',
    '.omnifile-cfg-desc{margin:0;font-size:12px;line-height:1.7;color:var(--dsw-alias-label-tertiary,#888);}',
    '.omnifile-cfg-group{display:flex;flex-direction:column;gap:6px;}',
    '.omnifile-cfg-label{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary,#666);}',
    '.omnifile-cfg-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;}',
    '.omnifile-cfg-input,.omnifile-cfg-select{box-sizing:border-box;width:100%;height:32px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.15));border-radius:8px;background:var(--dsw-specific-input-major,var(--dsw-alias-bg-base,#fff));color:var(--dsw-alias-label-primary,#222);font-size:13px;color-scheme:light dark;}',
    '.omnifile-cfg-input::placeholder{color:var(--dsw-alias-label-dimmed,#888);}',
    '.omnifile-cfg-input:focus,.omnifile-cfg-select:focus{outline:none;border-color:var(--dsw-alias-brand-primary,#4b6bfb);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary,#4b6bfb) 22%,transparent);}',
    '.omnifile-cfg-select{appearance:none;padding-right:28px;background-image:linear-gradient(45deg,transparent 50%,var(--dsw-alias-label-secondary,#666) 50%),linear-gradient(135deg,var(--dsw-alias-label-secondary,#666) 50%,transparent 50%);background-position:calc(100% - 16px) 50%,calc(100% - 11px) 50%;background-size:5px 5px,5px 5px;background-repeat:no-repeat;cursor:pointer;}',
    '.omnifile-cfg-check{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--dsw-alias-label-primary,#222);cursor:pointer;user-select:none;}',
    '.omnifile-cfg-check input[type=checkbox]{width:15px;height:15px;margin:0;accent-color:var(--dsw-alias-brand-primary,#4b6bfb);cursor:pointer;}',
    '.omnifile-cfg-hint{font-size:12px;line-height:1.6;color:var(--dsw-alias-label-tertiary,#888);}',
    '.omnifile-cfg-error{display:flex;align-items:center;gap:6px;font-size:12px;line-height:1.6;color:var(--dsw-alias-state-error-primary,#d03050);}',
    '.omnifile-cfg-tag{box-sizing:border-box;display:inline-flex;align-items:center;gap:6px;max-width:100%;padding:4px 10px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));border-radius:999px;background:var(--dsw-specific-tip,rgba(128,128,128,.08));font-size:12px;line-height:1;color:var(--dsw-alias-label-primary,#222);}',
    '.omnifile-cfg-tag b{font-weight:600;}',
    '.omnifile-cfg-divider{height:1px;border:none;background:var(--dsw-alias-border-l1,rgba(0,0,0,.1));margin:2px 0;}',
    '.omnifile-cfg-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}',
    '.omnifile-cfg-btn{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;padding:0 14px;border:none;border-radius:8px;background:var(--dsw-alias-button-primary-fill,#4b6bfb);color:var(--dsw-alias-label-primary-foreground,#fff);cursor:pointer;font-size:13px;font-weight:500;line-height:1;color-scheme:light dark;transition:background .15s ease;}',
    '.omnifile-cfg-btn:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-button-primary-fill,#4b6bfb));}',
    '.omnifile-cfg-btn:disabled{opacity:.55;cursor:default;}',
    '.omnifile-cfg-btn-ghost{background:transparent;color:var(--dsw-alias-label-primary,#222);border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.14));}',
    '.omnifile-cfg-btn-ghost:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));border-color:var(--dsw-alias-border-l3,rgba(0,0,0,.2));}',
    '.omnifile-cfg-btn-link{height:auto;padding:0;border:none;background:none;color:var(--dsw-alias-brand-primary,#4b6bfb);cursor:pointer;font-size:13px;line-height:1;text-decoration:none;}',
    '.omnifile-cfg-btn-link:hover{text-decoration:underline;background:none;}',
    '.omnifile-cfg-saved{font-size:12px;color:var(--dsw-alias-state-success-primary,#16a34a);display:inline-flex;align-items:center;gap:4px;}',
    '.omnifile-cfg-empty{display:flex;flex-direction:column;gap:8px;padding:12px 14px;border:1px dashed var(--dsw-alias-border-l2,rgba(0,0,0,.16));border-radius:10px;background:var(--dsw-alias-bg-base,rgba(255,255,255,.4));}',
    '.omnifile-cfg-empty p{margin:0;font-size:12px;line-height:1.7;color:var(--dsw-alias-label-tertiary,#888);}',
].join('')

function installStyles(): () => void {
    if (typeof document === 'undefined') return function () {
    }
    const id = '@dsh-omnifile/styles'
    if (document.querySelector('style[data-plugin-css="' + id + '"]') !== null) return function () {
    }
    const tag = document.createElement('style')
    tag.dataset.plugin = 'dsh-omnifile'
    tag.dataset.pluginCss = id
    tag.textContent = CSS
    document.head.appendChild(tag)
    return function () {
        tag.remove()
    }
}

export { CSS, installStyles }
