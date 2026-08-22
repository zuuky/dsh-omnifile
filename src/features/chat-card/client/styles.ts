/**
 * 功能块：聊天文件卡片（chat-card）客户端样式——解析卡片/分组/文件卡片、
 * 用户气泡里的 marker 隐藏。由 core/client/styles.ts 注入为独立 <style> 标签。
 */
const css = [
    '.omnifile-chat-files{display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-end;width:100%;}',
    '.omnifile-chat-card{box-sizing:border-box;display:inline-flex;align-items:center;gap:6px;max-width:300px;height:34px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12));border-radius:10px;background:var(--dsw-specific-tip,rgba(128,128,128,.08));cursor:pointer;color:var(--dsw-alias-label-primary,#222);font-size:12px;text-align:left;}',
    '.omnifile-chat-card:hover{background:rgba(0,0,0,.08);}',
    '.omnifile-chat-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:auto;}',
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
].join('')

export { css }
