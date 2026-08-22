/**
 * 功能块：文件接入（file-intake）客户端样式——输入区 dock/chip、发送等待进度行、
 * 上传按钮、拖拽遮罩。由 core/client/styles.ts 注入为独立 <style> 标签。
 */
const css = [
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
    '.omnifile-upload-btn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;flex:none;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#666);cursor:pointer;padding:0;}',
    '.omnifile-upload-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));}',
    '.omnifile-upload-btn:disabled{opacity:.5;cursor:default;}',
    '.omnifile-overlay{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;pointer-events:none;background:rgba(20,40,120,.08);backdrop-filter:blur(1px);font-size:15px;color:var(--dsw-alias-label-primary,#222);}',
    '.omnifile-overlay-box{background:var(--dsw-alias-bg-elevation,#fff);border:1px dashed var(--dsw-alias-brand-primary,#4b6bfb);border-radius:14px;padding:18px 28px;box-shadow:0 8px 30px rgba(0,0,0,.15);}',
].join('')

export { css }
