/**
 * 功能块：设置（settings）客户端样式——设置页「多模态模型配置」面板。
 * 由 core/client/styles.ts 注入为独立 <style> 标签。
 */
const css = [
    '.omnifile-hint{color:var(--dsw-alias-label-tertiary,#888);font-size:12px;line-height:1.6;}',
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

export { css }
