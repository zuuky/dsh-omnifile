window.__ModuleLoader__.load({
    id: "dsh-omnifile",
    factory: (require) => {
        var module = { exports: {} };
        var exports = module.exports;
        Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
"use strict";
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const React = require("react");
function _interopNamespaceDefault(e) {
  const n = Object.create(null, { [Symbol.toStringTag]: { value: "Module" } });
  if (e) {
    for (const k in e) {
      if (k !== "default") {
        const d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: () => e[k]
        });
      }
    }
  }
  n.default = e;
  return Object.freeze(n);
}
const React__namespace = /* @__PURE__ */ _interopNamespaceDefault(React);
const NAMESPACE = "omnifile";
const SOURCE = "文件";
const KIND_IMAGE = "image";
const KIND_DOC = "doc";
const KIND_TEXT = "text";
const KIND_MEDIA = "media";
const KIND_OTHER = "other";
const MARKER_PREFIX = "解析后保存路径：";
const MARKER_STATUS_OK = "完整内容见上方文件卡片，可点击展开";
const MARKER_STATUS_UNREADABLE = "无法按文本读取";
const MARKER_STATUS_FAILED = "解析失败";
const MARKER_UNKNOWN = "未知原因";
const MARKER_SOURCE_TAG = "源文件：";
function markerText(path, options = {}) {
  const p = String(path || "");
  const isOk = options.ok === true || options.ok === MARKER_STATUS_OK;
  if (isOk) {
    const sourceTail = typeof options.source === "string" && options.source !== "" && options.source !== p ? "；" + MARKER_SOURCE_TAG + options.source : "";
    return MARKER_PREFIX + p + "（" + MARKER_STATUS_OK + sourceTail + "）";
  }
  const status = options.ok === false ? MARKER_STATUS_FAILED : typeof options.ok === "string" && options.ok !== "" ? options.ok : MARKER_STATUS_UNREADABLE;
  const noteText = typeof options.note === "string" && options.note !== "" ? "：" + options.note : "";
  return MARKER_PREFIX + p + "（" + status + noteText + "）";
}
function sourcePathOf(statusTail) {
  const at = String(statusTail || "").indexOf(MARKER_SOURCE_TAG);
  if (at < 0) return void 0;
  const value = String(statusTail).slice(at + MARKER_SOURCE_TAG.length).trim();
  return value === "" ? void 0 : value;
}
const CSS = [
  ".omnifile-dock{box-sizing:border-box;width:100%;max-width:var(--dsh-composer-card-max-width,960px);margin:0 auto;display:flex;flex-wrap:wrap;gap:6px;padding:2px 4px;}",
  ".omnifile-sendwait{box-sizing:border-box;width:100%;display:flex;align-items:center;gap:8px;padding:8px 12px;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12));border-radius:10px;background:var(--dsw-specific-tip,rgba(128,128,128,.08));font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary,#666);}",
  ".omnifile-sendwait-icon{flex:none;font-size:13px;line-height:1;}",
  ".omnifile-sendwait-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:auto;}",
  ".omnifile-chip{box-sizing:border-box;display:inline-flex;align-items:center;gap:6px;max-width:260px;height:30px;padding:0 6px 0 8px;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12));border-radius:10px;background:var(--dsw-specific-tip,rgba(128,128,128,.08));font-size:12px;line-height:1;color:var(--dsw-alias-label-primary,#222);}",
  '.omnifile-chip[data-status="error"]{border-color:var(--dsw-alias-state-error-primary,#d03050);}',
  ".omnifile-chip-icon{flex:none;font-size:14px;line-height:1;}",
  ".omnifile-chip-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:auto;}",
  ".omnifile-chip-detail{color:var(--dsw-alias-label-tertiary,#888);flex:none;font-size:11px;}",
  ".omnifile-chip-remove{border:none;background:transparent;color:var(--dsw-alias-label-tertiary,#888);cursor:pointer;font-size:14px;line-height:1;padding:2px;border-radius:4px;flex:none;}",
  ".omnifile-chip-remove:hover{color:var(--dsw-alias-label-primary,#222);background:rgba(0,0,0,.06);}",
  '.omnifile-chip[data-clickable="true"]{cursor:pointer;}',
  '.omnifile-chip[data-clickable="true"]:hover{background:rgba(0,0,0,.08);}',
  /* 输入框内文件 chip 以可见 label（文件名）呈现；
   * 不隐藏 label，避免 textarea 中 U+FFFC 原本体裸露成"隐形占位"。 */
  '[data-input-backdrop] span[data-decoration="chip"]{cursor:pointer;}',
  ".omnifile-chat-files{display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-end;width:100%;}",
  ".omnifile-chat-card{box-sizing:border-box;display:inline-flex;align-items:center;gap:6px;max-width:300px;height:34px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12));border-radius:10px;background:var(--dsw-specific-tip,rgba(128,128,128,.08));cursor:pointer;color:var(--dsw-alias-label-primary,#222);font-size:12px;text-align:left;}",
  ".omnifile-chat-card:hover{background:rgba(0,0,0,.08);}",
  ".omnifile-chat-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:auto;}",
  ".omnifile-upload-btn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;flex:none;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#666);cursor:pointer;padding:0;}",
  ".omnifile-upload-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));}",
  ".omnifile-upload-btn:disabled{opacity:.5;cursor:default;}",
  ".omnifile-overlay{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;pointer-events:none;background:rgba(20,40,120,.08);backdrop-filter:blur(1px);font-size:15px;color:var(--dsw-alias-label-primary,#222);}",
  ".omnifile-overlay-box{background:var(--dsw-alias-bg-elevation,#fff);border:1px dashed var(--dsw-alias-brand-primary,#4b6bfb);border-radius:14px;padding:18px 28px;box-shadow:0 8px 30px rgba(0,0,0,.15);}",
  ".omnifile-hint{color:var(--dsw-alias-label-tertiary,#888);font-size:12px;line-height:1.6;}",
  /* 解析卡片：一行，宽度 = 对话框宽度（跟随容器变化，展开不跳动） */
  ".omnifile-parse-block{box-sizing:border-box;display:flex;flex-direction:column;gap:4px;width:100%;min-width:0;}",
  /* 多条文件消息分组容器：每条解析块各自独立（避免嵌套 parse-block） */
  ".omnifile-chat-group{box-sizing:border-box;display:flex;flex-direction:column;gap:6px;width:100%;}",
  ".omnifile-parse-row{box-sizing:border-box;display:flex;align-items:center;gap:8px;height:30px;max-width:100%;padding:0 10px;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12));border-radius:10px;background:var(--dsw-specific-tip,rgba(128,128,128,.08));cursor:pointer;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1;user-select:none;}",
  ".omnifile-parse-row:hover{background:rgba(0,0,0,.08);}",
  ".omnifile-parse-icon{flex:none;font-size:14px;line-height:1;}",
  ".omnifile-parse-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:auto;color:var(--dsw-alias-label-primary);}",
  ".omnifile-parse-caret{flex:none;width:12px;text-align:center;font-size:11px;line-height:1;color:var(--dsw-alias-label-tertiary,#888);}",
  ".omnifile-parse-open{flex:none;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#666);cursor:pointer;font-size:13px;line-height:1;}",
  ".omnifile-parse-open:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));color:var(--dsw-alias-label-primary,#222);}",
  /* 展开的解析结果内容区：滚动查看转换后的 md 全文 */
  ".omnifile-parse-body{box-sizing:border-box;width:100%;min-width:0;max-height:360px;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;scrollbar-width:thin;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12));border-radius:10px;background:var(--dsw-specific-input-major,var(--dsw-alias-bg-base,#fff));}",
  ".omnifile-parse-pre{margin:0;padding:10px 12px;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-primary,#222);}",
  ".omnifile-parse-hint{padding:10px 12px;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-tertiary,#888);}",
  ".omnifile-parse-error{color:var(--dsw-alias-state-error-primary,#d03050);}",
  /* 用户消息气泡里的 marker 段（保留在 content 供模型 read/read_image 用），
   * 由 installMarkerHiding 包成隐藏 span，视觉上不出现任何解析信息。 */
  ".omnifile-hidden-marker{display:none!important;}",
  /* ── 会话内用户消息快速定位导航（nav.ts）：贴消息流右缘，低层级；事件默认穿透，hover 命中带才可交互 ── */
  ".omnifile-nav{position:fixed;top:50%;transform:translateY(-50%);z-index:40;display:none;flex-direction:column;align-items:center;gap:12px;padding:8px 3px;border-radius:12px;font-family:system-ui;max-height:calc(100vh - 32px);overflow-y:auto;scrollbar-width:none;pointer-events:none;background:transparent;border:1px solid transparent;}",
  ".omnifile-nav::-webkit-scrollbar{display:none;}",
  ".omnifile-nav.active{pointer-events:auto;}",
  ".omnifile-nav-strip{position:fixed;top:0;bottom:0;width:48px;z-index:39;background:transparent;}",
  ".omnifile-nav-dot{width:10px;height:10px;padding:0;border:none;border-radius:999px;background:rgba(128,128,140,.45);cursor:pointer;flex:none;transition:width .18s ease,height .18s ease,background .18s ease,transform .18s ease;}",
  ".omnifile-nav-dot:hover{width:24px;height:10px;background:rgba(128,128,140,.8);}",
  ".omnifile-nav-dot.active{width:24px;height:10px;background:var(--dsw-alias-text-accent,#4c9aff);}",
  ".omnifile-nav-dot.active:hover{background:var(--dsw-alias-text-accent,#4c9aff);}",
  ".omnifile-nav-more{width:22px;height:22px;padding:0;border:none;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;flex:none;cursor:pointer;color:var(--dsw-alias-label-secondary,#666);background:rgba(128,128,140,.12);box-shadow:inset 0 0 0 1px rgba(128,128,140,.18);font-size:12px;line-height:1;transition:color .18s ease,background .18s ease;}",
  ".omnifile-nav-more:hover{color:var(--dsw-alias-brand-primary,#4c9aff);background:rgba(128,128,140,.2);}",
  /* hover 圆点 → 用户消息内容预览（文本由 nav.ts 截断到 100 字） */
  ".omnifile-nav-tip{position:fixed;z-index:45;max-width:320px;box-sizing:border-box;padding:8px 10px;border-radius:8px;font-size:12px;line-height:1.55;color:var(--dsw-alias-text-1,#eee);background:var(--dsw-hovercard-bg,#2C2C2E);box-shadow:var(--dsw-shadow-lv3);pointer-events:none;white-space:pre-wrap;word-break:break-word;overflow:hidden;display:-webkit-box;-webkit-line-clamp:6;-webkit-box-orient:vertical;}",
  "@media (prefers-reduced-motion:reduce){.omnifile-nav,.omnifile-nav-dot{transition:none;animation:none;}}",
  /* ── 设置页「多模态模型配置」面板（跟随 DSH theme 明暗/主题色） ── */
  ".omnifile-cfg{box-sizing:border-box;display:flex;flex-direction:column;gap:14px;max-width:720px;padding:16px;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12));border-radius:12px;background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base,#fff));color:var(--dsw-alias-label-primary,#222);}",
  ".omnifile-cfg-head{display:flex;flex-direction:column;gap:4px;}",
  '.omnifile-cfg-title{margin:0;font:var(--dsw-font-l-strong-16,600 16px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif);color:var(--dsw-alias-label-primary,#222);}',
  ".omnifile-cfg-desc{margin:0;font-size:12px;line-height:1.7;color:var(--dsw-alias-label-tertiary,#888);}",
  ".omnifile-cfg-group{display:flex;flex-direction:column;gap:6px;}",
  ".omnifile-cfg-label{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary,#666);}",
  ".omnifile-cfg-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;}",
  ".omnifile-cfg-input,.omnifile-cfg-select{box-sizing:border-box;width:100%;height:32px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.15));border-radius:8px;background:var(--dsw-specific-input-major,var(--dsw-alias-bg-base,#fff));color:var(--dsw-alias-label-primary,#222);font-size:13px;color-scheme:light dark;}",
  ".omnifile-cfg-input::placeholder{color:var(--dsw-alias-label-dimmed,#888);}",
  ".omnifile-cfg-input:focus,.omnifile-cfg-select:focus{outline:none;border-color:var(--dsw-alias-brand-primary,#4b6bfb);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary,#4b6bfb) 22%,transparent);}",
  ".omnifile-cfg-select{appearance:none;padding-right:28px;background-image:linear-gradient(45deg,transparent 50%,var(--dsw-alias-label-secondary,#666) 50%),linear-gradient(135deg,var(--dsw-alias-label-secondary,#666) 50%,transparent 50%);background-position:calc(100% - 16px) 50%,calc(100% - 11px) 50%;background-size:5px 5px,5px 5px;background-repeat:no-repeat;cursor:pointer;}",
  ".omnifile-cfg-check{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--dsw-alias-label-primary,#222);cursor:pointer;user-select:none;}",
  ".omnifile-cfg-check input[type=checkbox]{width:15px;height:15px;margin:0;accent-color:var(--dsw-alias-brand-primary,#4b6bfb);cursor:pointer;}",
  ".omnifile-cfg-hint{font-size:12px;line-height:1.6;color:var(--dsw-alias-label-tertiary,#888);}",
  ".omnifile-cfg-error{display:flex;align-items:center;gap:6px;font-size:12px;line-height:1.6;color:var(--dsw-alias-state-error-primary,#d03050);}",
  ".omnifile-cfg-tag{box-sizing:border-box;display:inline-flex;align-items:center;gap:6px;max-width:100%;padding:4px 10px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));border-radius:999px;background:var(--dsw-specific-tip,rgba(128,128,128,.08));font-size:12px;line-height:1;color:var(--dsw-alias-label-primary,#222);}",
  ".omnifile-cfg-tag b{font-weight:600;}",
  ".omnifile-cfg-divider{height:1px;border:none;background:var(--dsw-alias-border-l1,rgba(0,0,0,.1));margin:2px 0;}",
  ".omnifile-cfg-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}",
  ".omnifile-cfg-btn{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;padding:0 14px;border:none;border-radius:8px;background:var(--dsw-alias-button-primary-fill,#4b6bfb);color:var(--dsw-alias-label-primary-foreground,#fff);cursor:pointer;font-size:13px;font-weight:500;line-height:1;color-scheme:light dark;transition:background .15s ease;}",
  ".omnifile-cfg-btn:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-button-primary-fill,#4b6bfb));}",
  ".omnifile-cfg-btn:disabled{opacity:.55;cursor:default;}",
  ".omnifile-cfg-btn-ghost{background:transparent;color:var(--dsw-alias-label-primary,#222);border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.14));}",
  ".omnifile-cfg-btn-ghost:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));border-color:var(--dsw-alias-border-l3,rgba(0,0,0,.2));}",
  ".omnifile-cfg-btn-link{height:auto;padding:0;border:none;background:none;color:var(--dsw-alias-brand-primary,#4b6bfb);cursor:pointer;font-size:13px;line-height:1;text-decoration:none;}",
  ".omnifile-cfg-btn-link:hover{text-decoration:underline;background:none;}",
  ".omnifile-cfg-saved{font-size:12px;color:var(--dsw-alias-state-success-primary,#16a34a);display:inline-flex;align-items:center;gap:4px;}",
  ".omnifile-cfg-empty{display:flex;flex-direction:column;gap:8px;padding:12px 14px;border:1px dashed var(--dsw-alias-border-l2,rgba(0,0,0,.16));border-radius:10px;background:var(--dsw-alias-bg-base,rgba(255,255,255,.4));}",
  ".omnifile-cfg-empty p{margin:0;font-size:12px;line-height:1.7;color:var(--dsw-alias-label-tertiary,#888);}"
].join("");
function installStyles() {
  if (typeof document === "undefined") return function() {
  };
  const id2 = "@dsh-omnifile/styles";
  if (document.querySelector('style[data-plugin-css="' + id2 + '"]') !== null) return function() {
  };
  const tag = document.createElement("style");
  tag.dataset.plugin = "dsh-omnifile";
  tag.dataset.pluginCss = id2;
  tag.textContent = CSS;
  document.head.appendChild(tag);
  return function() {
    tag.remove();
  };
}
const LBL_OPEN_SOURCE = "用本地默认程序打开源文件";
const LBL_CHIP_OPEN = "（点击预览）";
const LBL_ADD_FILES = "添加本地文件（可多选，支持拖拽/粘贴）";
const LBL_EXPAND = "展开解析结果";
const LBL_COLLAPSE = "收起解析结果";
const DEFAULT_LIMITS = {
  maxFileBytes: 50 * 1024 * 1024,
  maxBatchImages: 20,
  progressPollMs: 400
};
const CANDIDATE_LIMIT = 200;
const FILES_ANCHOR_OFFSET = -0.5;
function id() {
  if (typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.randomUUID === "function") return globalThis.crypto.randomUUID();
  return "omnifile-" + Date.now() + "-" + Math.floor(Math.random() * 1e6);
}
function humanBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
function useStore(store) {
  const read = typeof store.getSnapshot === "function" ? function() {
    return store.getSnapshot();
  } : function() {
    return store.snapshot();
  };
  return React__namespace.useSyncExternalStore(
    function(onStoreChange) {
      return store.subscribe(onStoreChange);
    },
    read,
    read
  );
}
function iconFor(kind, name) {
  const ext = String(name || "").split(".").pop().toLowerCase();
  if (kind === KIND_IMAGE) return "🖼";
  if (kind === KIND_DOC) {
    if (ext === "pdf") return "📕";
    if (["doc", "docx", "docm", "rtf", "odt"].indexOf(ext) >= 0) return "📘";
    if (["xls", "xlsx", "xlsm", "xlsb", "ods", "csv"].indexOf(ext) >= 0) return "📗";
    if (["ppt", "pptx", "pptm", "pps", "ppsx", "pot", "ppsm", "odp"].indexOf(ext) >= 0) return "📙";
    if (ext === "epub") return "📚";
    return "📄";
  }
  if (kind === KIND_MEDIA) return "🎞";
  return "📝";
}
function isImageFile(file) {
  return typeof file.type === "string" && file.type.toLowerCase().startsWith("image/");
}
function collectFiles(data) {
  if (data === null || data === void 0) return [];
  const itemFiles = Array.from(data.items || []).filter(function(item) {
    return item.kind === "file";
  }).map(function(item) {
    return item.getAsFile();
  }).filter(function(file) {
    return file !== null;
  });
  return itemFiles.length > 0 ? itemFiles : Array.from(data.files || []);
}
function textOf(content) {
  if (!Array.isArray(content)) return "";
  return content.filter(function(block) {
    return block && block.type === "text";
  }).map(function(block) {
    return String(block.text || "");
  }).join("\n");
}
function basenameOf(path) {
  return String(path || "").split(/[\\/]/).pop() || "";
}
function escapeRegExp(text) {
  const special = "\\^$.*+?()[]{}|";
  const s = String(text || "");
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i);
    if (special.indexOf(c) >= 0) out += "\\";
    out += c;
  }
  return out;
}
function setPath(obj, segs, val) {
  let target = obj;
  for (let i = 0; i < segs.length - 1; i++) {
    if (typeof target[segs[i]] !== "object" || target[segs[i]] === null) target[segs[i]] = {};
    target = target[segs[i]];
  }
  target[segs[segs.length - 1]] = val;
  return obj;
}
const common = {
  SOURCE,
  KIND_IMAGE,
  KIND_DOC,
  KIND_TEXT,
  KIND_MEDIA,
  KIND_OTHER,
  MARKER_STATUS_OK,
  MARKER_STATUS_UNREADABLE,
  MARKER_STATUS_FAILED,
  markerText,
  sourcePathOf
};
class OmnifileController {
  ctx;
  records = /* @__PURE__ */ new Map();
  listeners = /* @__PURE__ */ new Set();
  revision = 0;
  _fileCache = /* @__PURE__ */ new Map();
  _parsedCache = /* @__PURE__ */ new Map();
  /* 发送锁：sessionId -> 当前“等待解析完成后发送”周期的 signal；用于防重复发送。 */
  _sendSignal = /* @__PURE__ */ new Map();
  /* 客户端限额从宿主 /api/omnifile/config 读取，避免与 settings 不同步。 */
  limits = Object.assign({}, DEFAULT_LIMITS);
  constructor(ctx) {
    this.ctx = ctx;
    this.loadLimits();
  }
  /** 从宿主读取当前生效的客户端限额（文件大小/图片批量/轮询间隔），失败静默保留缺省值。 */
  loadLimits() {
    const controller = this;
    fetch("/api/omnifile/config").then(function(res) {
      return res.json();
    }).catch(function() {
      return {};
    }).then(function(json) {
      const limits = json && json.ok === true ? json.limits : null;
      if (limits === null) return;
      const next = {};
      const map = { maxFileBytes: "maxFileBytes", maxBatchImages: "maxBatchImages", progressPollMs: "progressPollMs" };
      Object.keys(map).forEach(function(key) {
        const value = Number(limits[map[key]]);
        if (Number.isFinite(value) && value > 0) next[key] = key === "progressPollMs" ? Math.max(50, value) : value;
      });
      if (Object.keys(next).length > 0) controller.limits = Object.assign({}, controller.limits, next);
    });
  }
  subscribe(fn) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  snapshot() {
    return this.revision;
  }
  getSnapshot() {
    return this.revision;
  }
  changed() {
    this.revision += 1;
    for (const fn of this.listeners) {
      try {
        fn();
      } catch (e) {
      }
    }
  }
  currentSessionId() {
    const list = this.ctx.get("sessions");
    const current = list && list.list && list.list.getSnapshot ? list.list.getSnapshot().current : void 0;
    return current === void 0 ? void 0 : String(current);
  }
  inputFor(sessionId) {
    const sessions = this.ctx.get("sessions");
    const conversation = this.ctx.get("conversation");
    if (sessions === void 0 || conversation === void 0) return void 0;
    const actx = sessions.scope(sessionId);
    if (actx === void 0) return void 0;
    try {
      return conversation.input.for(actx);
    } catch (e) {
      return void 0;
    }
  }
  async saveOne(sessionId, file) {
    const cap = this.limits.maxFileBytes || DEFAULT_LIMITS.maxFileBytes;
    if (file.size > cap) return { ok: false, error: "「" + file.name + "」超过 " + Math.round(cap / 1024 / 1024) + "MB，已跳过" };
    const dataUrl = await new Promise(function(resolveRead, rejectRead) {
      const reader = new FileReader();
      reader.onerror = function() {
        rejectRead(new Error("读取失败"));
      };
      reader.onload = function() {
        resolveRead(String(reader.result || ""));
      };
      reader.readAsDataURL(file);
    });
    const comma = dataUrl.indexOf(",");
    const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : "";
    const response = await fetch("/api/omnifile/save", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, name: file.name, base64 })
    });
    const json = await response.json().catch(function() {
      return {};
    });
    if (json && json.ok === true) return {
      ok: true,
      path: json.path,
      kind: json.kind,
      size: json.size
    };
    return { ok: false, error: json && json.error || "上传失败（HTTP " + response.status + "）" };
  }
  addNativeImages(sessionId, input, files) {
    const conversation = this.ctx.get("conversation");
    if (conversation === void 0 || typeof conversation.createDraftImages !== "function") return false;
    try {
      const attachments = conversation.createDraftImages(files.slice(0, this.limits.maxBatchImages || DEFAULT_LIMITS.maxBatchImages));
      if (attachments.length > 0) input.addImages(attachments.map(function(a) {
        return a.id;
      }));
      return true;
    } catch (error) {
      try {
        input.notify("error", "图片添加失败：" + messageOf(error));
      } catch (e) {
      }
      return false;
    }
  }
  /** 计算新 chip 的插入位置：始终放在输入区最前（正文之前）。
   *  已有本插件 chip 时紧跟最后一个 chip 之后（保持 chips 成组且顺序稳定），
   *  没有则放在 draft 开头。返回 {start, draftRev}。 */
  frontInsertSpan(input) {
    const snapshot = input.state.getSnapshot();
    const occurrences = Array.isArray(snapshot.occurrences) ? snapshot.occurrences : [];
    const mine = occurrences.filter(function(o) {
      return o && o.source === common.SOURCE && typeof o.offset === "number";
    });
    const draft = String(snapshot.draft || "");
    let start = 0;
    if (mine.length > 0) {
      let last = -1;
      for (const o of mine) if (o.offset > last) last = o.offset;
      start = last + 1;
      if (draft.charAt(start) === " ") start += 1;
    }
    return { start, draftRev: snapshot.draftRev };
  }
  async addNonImage(sessionId, input, file) {
    const saved = await this.saveOne(sessionId, file);
    if (!saved.ok) {
      try {
        input.notify("error", saved.error || "");
      } catch (e) {
      }
      return false;
    }
    const ref = id();
    const record = {
      ref,
      sessionId,
      name: file.name,
      path: saved.path,
      kind: saved.kind || "other",
      size: saved.size || file.size,
      status: "ready",
      error: void 0
    };
    this.records.set(ref, record);
    const span = this.frontInsertSpan(input);
    const accepted = input.insertReference({
      source: common.SOURCE,
      ref,
      label: file.name,
      clipboardText: "[文件: " + file.name + "]"
    }, { start: span.start, end: span.start, draftRev: span.draftRev });
    if (!accepted) {
      this.records.delete(ref);
      return false;
    }
    this.changed();
    this.startProcess(ref).catch(function() {
    });
    return true;
  }
  async addFiles(sessionId, files) {
    if (!Array.isArray(files) || files.length === 0) return;
    const input = this.inputFor(sessionId);
    if (input === void 0) return;
    const state = input.state.getSnapshot();
    const images = files.filter(isImageFile);
    const docs = files.filter(function(file) {
      return !isImageFile(file);
    });
    if (images.length > 0 && state.phase === "plain") this.addNativeImages(sessionId, input, images);
    const failures = [];
    for (const file of docs) {
      try {
        const ok = await this.addNonImage(sessionId, input, file);
        if (!ok) failures.push("「" + file.name + "」未添加");
      } catch (error) {
        failures.push("「" + file.name + "」添加失败：" + messageOf(error));
      }
    }
    if (failures.length > 0) {
      try {
        input.notify("error", failures.join("；"));
      } catch (e) {
      }
    }
  }
  /** 轮询宿主端处理进度，把实时阶段写入 chip 详情（多模态识别时用户能看到“识别图片 x/n”）。 */
  pollProgress(token, signal, record) {
    let stopped = false;
    const poll = () => {
      if (stopped) return;
      fetch("/api/omnifile/status?token=" + encodeURIComponent(token), { signal: signal || void 0 }).then((res) => res.json()).catch(() => ({})).then((json) => {
        if (stopped) return;
        const p = json && json.progress;
        if (p && typeof p.detail === "string" && p.detail !== "") {
          record.progressDetail = p.detail;
        } else if (p && typeof p.stage === "string" && p.stage !== "") {
          record.progressDetail = p.stage;
        }
        this.changed();
      });
    };
    const timer = setInterval(poll, this.limits.progressPollMs || DEFAULT_LIMITS.progressPollMs);
    poll();
    return function() {
      stopped = true;
      clearInterval(timer);
    };
  }
  /**
   * 选中即解析（幂等）：同一 ref 只发起一次 /process，后续调用复用进行中的 promise。
   * 解析进度写入 chip；成功时把 md 落盘路径记到 record.parsedPath。发送时 serialize
   * await 此方法，从而保证“点击发送时所有文件都已解析完成”。
   * @returns 解析结果 json；失败时置 record.error 并 reject（调用方捕获）。
   */
  async startProcess(ref, signal) {
    const record = this.records.get(ref);
    if (record === void 0) throw new Error("文件已从草稿移除");
    if (record.path === void 0 || record.path === "") throw new Error("文件尚未保存完成");
    if (record.status === "done" && record._result !== void 0) return record._result;
    if (record._processPromise !== void 0) return record._processPromise;
    record.status = "processing";
    record._result = void 0;
    record.error = void 0;
    record.progressDetail = "";
    this.changed();
    const token = id();
    const stopPoll = this.pollProgress(token, signal, record);
    const promise = async function() {
      try {
        const response = await fetch("/api/omnifile/process", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId: record.sessionId, path: record.path, name: record.name, kind: record.kind, token }),
          signal: signal || void 0
        });
        const json = await response.json().catch(function() {
          return {};
        });
        if (!json || json.ok !== true) throw new Error(json && json.error || "处理失败（HTTP " + response.status + "）");
        record.status = "done";
        record._result = json;
        if (typeof json.parsedPath === "string" && json.parsedPath !== "") record.parsedPath = json.parsedPath;
        this.changed();
        return json;
      } catch (error) {
        record.status = "error";
        record.error = messageOf(error);
        this.changed();
        throw error;
      } finally {
        stopPoll();
      }
    }.bind(this)();
    record._processPromise = promise;
    promise.catch(function() {
    });
    return promise;
  }
  /** 清除输入区 composer 提示（如“请勿重复点击”），发送提交/周期结束后调用。 */
  clearNotice(sid) {
    try {
      const input = typeof this.inputFor === "function" ? this.inputFor(sid) : void 0;
      if (input && input.notices && typeof input.notices.set === "function") input.notices.set(null);
    } catch (e) {
    }
  }
  /** 把 ref 的解析结果序列化为一行可读消息标记；发送时由运行时 await，等待该文件解析完成。
   * 统一格式：解析后保存路径：<md 或源路径>（完整内容见上方文件卡片，可点击展开；源文件：<源路径> | 无法按文本读取：… | 解析失败：…）
   */
  async serialize(ref, signal) {
    const self = this;
    const record = this.records.get(ref);
    if (record === void 0) return "";
    if (record.path === void 0 || record.path === "") throw new Error("文件尚未保存完成");
    const sid = record.sessionId;
    const activeSignal = this._sendSignal.get(sid);
    if (activeSignal !== void 0 && activeSignal !== signal) {
      return Promise.reject(new Error("已有点发送正在等待文件解析完成，请勿重复点击"));
    }
    if (activeSignal === void 0) {
      this._sendSignal.set(sid, signal);
      if (typeof signal?.addEventListener === "function") {
        signal.addEventListener("abort", function() {
          if (self._sendSignal.get(sid) === signal) self._sendSignal.delete(sid);
          self.clearNotice(sid);
        });
      }
    }
    if (record.status !== "done" && !record._waitNotified) {
      record._waitNotified = true;
      record.awaitingSend = true;
      this.changed();
    }
    let json = null;
    try {
      json = await this.startProcess(ref, signal);
    } catch (error) {
      json = null;
    }
    setTimeout(function() {
      if (self._sendSignal.get(sid) !== signal) return;
      const occs2 = typeof self.inputFor === "function" ? self.inputFor(sid)?.state?.getSnapshot?.()?.occurrences : void 0;
      const mine = Array.isArray(occs2) && occs2.some(function(o) {
        return o.source === common.SOURCE && o.ref === ref;
      });
      if (!mine) {
        self.clearNotice(sid);
        self._sendSignal.delete(sid);
      }
    }, 0);
    const occs = typeof this.inputFor === "function" ? this.inputFor(sid)?.state?.getSnapshot?.()?.occurrences : void 0;
    if (Array.isArray(occs) && !occs.some(function(o) {
      return o.source === common.SOURCE && o.ref === ref;
    })) {
      if (record.awaitingSend) {
        record.awaitingSend = false;
        this.changed();
      }
      return "";
    }
    if (record.awaitingSend) {
      record.awaitingSend = false;
      this.changed();
    }
    if (json !== null && json.ok === true) {
      const p = typeof json.parsedPath === "string" && json.parsedPath !== "" ? json.parsedPath : record.path;
      if (json.kind === "other") {
        return markerText(p, { ok: common.MARKER_STATUS_UNREADABLE, note: json.note || "" }) + "\n";
      }
      return markerText(p, { ok: common.MARKER_STATUS_OK, source: record.path }) + "\n";
    }
    return markerText(record.path, { ok: common.MARKER_STATUS_FAILED, note: record.error || "" }) + "\n";
  }
  remove(sessionId, occurrence) {
    const input = this.inputFor(sessionId);
    if (input === void 0) return;
    if (input.state.getSnapshot().phase !== "plain") return;
    const snapshot = input.state.getSnapshot();
    const current = snapshot.occurrences.find(function(o) {
      return o.source === common.SOURCE && o.occurrenceId === occurrence.occurrenceId && o.ref === occurrence.ref;
    });
    if (current === void 0) return;
    const accepted = input.insertText("", {
      start: current.offset,
      end: current.offset + 1,
      draftRev: snapshot.draftRev
    });
    if (!accepted) return;
    this.records.delete(occurrence.ref);
    this.changed();
  }
  source() {
    const controller = this;
    return {
      trigger: "@",
      name: common.SOURCE,
      order: 1e3,
      candidates: function(projection, opts) {
        const sessionId = projection && projection.sessionId;
        if (sessionId === void 0 || sessionId === "") return Promise.resolve([]);
        return controller.listWorkspaceFiles(sessionId, opts && opts.query, opts && opts.signal);
      },
      onPick: function(pick) {
        const candidate = pick && pick.candidate;
        if (candidate === void 0 || candidate === null || typeof candidate.path !== "string" || candidate.path === "") return void 0;
        const sessionId = pick.session && pick.session.sessionId;
        const ref = id();
        const record = {
          ref,
          sessionId,
          name: String(candidate.name || "文件"),
          path: candidate.path,
          kind: String(candidate.kind || "other"),
          size: Number(candidate.size) || 0,
          status: "ready",
          error: void 0
        };
        controller.records.set(ref, record);
        controller.changed();
        controller.startProcess(ref).catch(function() {
        });
        return {
          insert: {
            source: common.SOURCE,
            ref,
            label: record.name,
            clipboardText: "[文件: " + record.name + "]"
          }
        };
      },
      codec: {
        clipboardText: (ref) => {
          const record = controller.records.get(ref);
          return "[文件: " + (record ? record.name : "附件") + "]";
        },
        serialize: (ref, signal) => controller.serialize(ref, signal)
      }
    };
  }
  async openPath(sessionId, path) {
    const connection = this.ctx.get("connection");
    if (connection && connection.api && connection.api.host && typeof connection.api.host.openPath === "function") {
      try {
        await connection.api.host.openPath({ path });
        return;
      } catch (e) {
      }
    }
    try {
      await fetch("/api/omnifile/open", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, path })
      });
    } catch (e) {
    }
  }
  /** 懒加载解析结果（<uploads>/<源文件名>.md）：按 会话|路径 缓存成功结果、去重在途请求。 */
  loadParsed(sessionId, file) {
    const path = file && file.path;
    if (typeof path !== "string" || path === "") return Promise.reject(new Error("没有可加载的解析文件"));
    const key = String(sessionId || "") + "|" + path;
    if (this._parsedCache.has(key)) return Promise.resolve(this._parsedCache.get(key));
    const promise = fetch("/api/omnifile/parsed?sessionId=" + encodeURIComponent(String(sessionId || "")) + "&path=" + encodeURIComponent(path)).then(function(response) {
      if (!response.ok) throw new Error("加载解析内容失败（HTTP " + response.status + "）");
      return response.text();
    }).then(function(text) {
      if (text === "") throw new Error("解析内容为空");
      return text;
    });
    this._parsedCache.set(key, promise);
    promise.catch(function() {
      this._parsedCache.delete(key);
    }.bind(this));
    return promise;
  }
  /** 工作区文件列表缓存：sessionId -> {at, files, inflight}，避免 @ 每次击键都请求宿主。 */
  fileListing(sessionId, signal) {
    const key = String(sessionId || "");
    if (key === "") return Promise.resolve([]);
    const now = Date.now();
    const cached = this._fileCache.get(key);
    if (cached !== void 0 && cached.inflight === void 0 && now - cached.at < 15e3) {
      return Promise.resolve(cached.files);
    }
    const req = fetch("/api/omnifile/list?sessionId=" + encodeURIComponent(key), { signal: signal || void 0 }).then(function(r) {
      return r.json();
    }).then(function(j) {
      return j && j.ok === true && Array.isArray(j.files) ? j.files : [];
    }).catch(function() {
      return cached !== void 0 && cached.inflight === void 0 ? cached.files : [];
    });
    const settled = req.then(function(files) {
      this._fileCache.set(key, { at: Date.now(), files, inflight: void 0 });
      return files;
    }.bind(this));
    this._fileCache.set(key, { at: now, files: cached !== void 0 ? cached.files : [], inflight: settled });
    return settled;
  }
  /** @ 文件候选：按 query 子串（不区分大小写）过滤工作区文件列表，映射为菜单项。 */
  listWorkspaceFiles(sessionId, query, signal) {
    const q = String(query || "").trim().toLowerCase();
    return this.fileListing(sessionId, signal).then(function(files) {
      const matched = q === "" ? files : files.filter(function(f) {
        return String(f.rel || f.name || "").toLowerCase().indexOf(q) >= 0;
      });
      return matched.slice(0, CANDIDATE_LIMIT).map(function(f) {
        return {
          icon: iconFor(f.kind, f.name),
          name: f.name,
          description: String(f.rel || ""),
          path: f.path,
          kind: f.kind,
          size: f.size
        };
      });
    });
  }
}
function installPasteAndDrag(ctx, controller) {
  const hasFiles = function(e) {
    return e.dataTransfer && Array.from(e.dataTransfer.types || []).indexOf("Files") >= 0;
  };
  let overlay = null;
  let overlayDepth = 0;
  const showOverlay = function() {
    overlayDepth += 1;
    if (overlay === null && typeof document !== "undefined") {
      overlay = document.createElement("div");
      overlay.className = "omnifile-overlay";
      const box = document.createElement("div");
      box.className = "omnifile-overlay-box";
      box.textContent = "松开鼠标把文件添加进对话";
      overlay.appendChild(box)(document.body || document.documentElement).appendChild(overlay);
    }
  };
  const hideOverlay = function() {
    overlayDepth = Math.max(0, overlayDepth - 1);
    if (overlayDepth === 0 && overlay !== null) {
      overlay.remove();
      overlay = null;
    }
  };
  const onDragEnter = function(e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    showOverlay();
  };
  const onDragOver = function(e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
  };
  const onDragLeave = function(e) {
    if (!hasFiles(e)) return;
    hideOverlay();
  };
  const onDrop = function(e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    hideOverlay();
    const files = collectFiles(e.dataTransfer);
    if (files.length === 0) return;
    const sessionId = controller.currentSessionId();
    if (sessionId === void 0) return;
    controller.addFiles(sessionId, files);
  };
  const onPaste = function(e) {
    const files = collectFiles(e.clipboardData);
    if (files.length === 0) return;
    const target = e.target;
    if (!(target && target.tagName === "TEXTAREA") || !(target.closest && target.closest("[data-composer-card]"))) return;
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
    const sessionId = controller.currentSessionId();
    if (sessionId === void 0) return;
    controller.addFiles(sessionId, files);
  };
  ctx.effect(function() {
    document.addEventListener("dragenter", onDragEnter, true);
    document.addEventListener("dragover", onDragOver, true);
    document.addEventListener("dragleave", onDragLeave, true);
    document.addEventListener("drop", onDrop, true);
    document.addEventListener("paste", onPaste, true);
    return function() {
      document.removeEventListener("dragenter", onDragEnter, true);
      document.removeEventListener("dragover", onDragOver, true);
      document.removeEventListener("dragleave", onDragLeave, true);
      document.removeEventListener("drop", onDrop, true);
      document.removeEventListener("paste", onPaste, true);
      if (overlay !== null) {
        overlay.remove();
        overlay = null;
      }
    };
  }, "dsh-omnifile: paste & drop capture");
}
function installMarkerHiding(ctx) {
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") return;
  const insideHidden = function(node) {
    let cur = node;
    while (cur !== null && cur !== document) {
      if (cur.nodeType === 1 && cur.getAttribute && cur.getAttribute("data-omnifile-hidden")) return true;
      cur = cur.parentNode;
    }
    return false;
  };
  const scanNode = function(root) {
    if (root === null || root === void 0 || root.nodeType !== 1) return;
    if (insideHidden(root)) return;
    if (root.textContent === void 0 || root.textContent.indexOf(MARKER_PREFIX) < 0) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    const hits = [];
    while (true) {
      const node = walker.nextNode();
      if (node === null) break;
      if (node.nodeValue && node.nodeValue.indexOf(MARKER_PREFIX) >= 0) hits.push(node);
    }
    for (const textNode of hits) hideMarkerInText(textNode);
  };
  const hideMarkerInText = function(textNode) {
    if (textNode.parentNode === null || insideHidden(textNode)) return;
    const text = String(textNode.nodeValue || "");
    const statusGroup = "(?:" + escapeRegExp(MARKER_STATUS_OK) + "|" + escapeRegExp(MARKER_STATUS_UNREADABLE) + "|" + escapeRegExp(MARKER_STATUS_FAILED) + "|" + escapeRegExp(MARKER_UNKNOWN) + ")";
    const markerRe = new RegExp("(\\r?\\n)?" + escapeRegExp(MARKER_PREFIX) + "(.+?)（(" + statusGroup + "[^）]*)）(\\r?\\n)?", "g");
    const ranges = [];
    let m;
    while ((m = markerRe.exec(text)) !== null) {
      ranges.push({ start: m.index, end: m.index + m[0].length });
    }
    if (ranges.length === 0) return;
    const parent = textNode.parentNode;
    if (parent === null) return;
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const range of ranges) {
      if (range.start > cursor) fragment.appendChild(document.createTextNode(text.slice(cursor, range.start)));
      const hidden = document.createElement("span");
      hidden.className = "omnifile-hidden-marker";
      hidden.setAttribute("data-omnifile-hidden", "1");
      hidden.textContent = text.slice(range.start, range.end);
      fragment.appendChild(hidden);
      cursor = range.end;
    }
    if (cursor < text.length) fragment.appendChild(document.createTextNode(text.slice(cursor)));
    parent.replaceChild(fragment, textNode);
  };
  const observer = new MutationObserver(function(mutations) {
    for (const mutation of mutations) {
      for (const added of mutation.addedNodes) {
        if (added.nodeType === 3) {
          if (added.nodeValue && added.nodeValue.indexOf(MARKER_PREFIX) >= 0) hideMarkerInText(added);
        } else if (added.nodeType === 1) {
          scanNode(added);
        }
      }
    }
  });
  if (document.body !== null) scanNode(document.body);
  observer.observe(document.documentElement, { subtree: true, childList: true });
  ctx.effect(function() {
    return function() {
      observer.disconnect();
    };
  });
}
const NAV_ATTR = "data-omnifile-nav";
const STRIP_ATTR = "data-omnifile-nav-strip";
const DOT_ATTR = "data-omnifile-nav-dot";
const MORE_ATTR = "data-omnifile-nav-more";
const TIP_ATTR = "data-omnifile-nav-tip";
const NAV_OFFSET = 20;
const WINDOW = 10;
const TIP_MAX_LEN = 100;
function installConversationNav(ctx) {
  if (typeof document === "undefined" || document.body === null) return;
  const body = document.body;
  const strip = document.createElement("div");
  strip.className = "omnifile-nav-strip";
  strip.setAttribute(STRIP_ATTR, "");
  const bar = document.createElement("nav");
  bar.className = "omnifile-nav";
  bar.setAttribute(NAV_ATTR, "");
  bar.setAttribute("aria-label", "用户消息导航");
  body.appendChild(strip);
  body.appendChild(bar);
  const tip = document.createElement("div");
  tip.className = "omnifile-nav-tip";
  tip.setAttribute(TIP_ATTR, "");
  tip.style.display = "none";
  body.appendChild(tip);
  const flowOf = () => document.querySelector("[data-chat-flow]") ?? document.querySelector("[data-focus-flow]");
  const scrollerOf = () => {
    const flow = flowOf();
    if (flow === null) return null;
    let n = flow.parentElement;
    while (n !== null) {
      const s = getComputedStyle(n);
      if (s.overflowY === "auto" || s.overflowY === "scroll") return n;
      n = n.parentElement;
    }
    return null;
  };
  const allRows = () => [...document.querySelectorAll("[data-time-hover-root]")].filter((row) => !row.hasAttribute("data-pending-steering"));
  const userRows = () => allRows().filter((row) => !row.hasAttribute("data-turn-tail") && row.querySelector('[class*="bubble"]') !== null);
  const position = () => {
    const flow = flowOf();
    if (flow === null) return;
    const right = flow.getBoundingClientRect().right;
    const next = Math.max(8, Math.min(right + NAV_OFFSET, window.innerWidth - bar.offsetWidth - 8));
    if (bar.style.left !== next + "px") bar.style.left = next + "px";
    const stripLeft = Math.max(4, next - 20);
    if (strip.style.left !== stripLeft + "px") strip.style.left = stripLeft + "px";
  };
  let posScheduled = false;
  const requestPosition = () => {
    if (posScheduled) return;
    posScheduled = true;
    requestAnimationFrame(() => {
      posScheduled = false;
      position();
    });
  };
  const computeActive = (rows) => {
    if (rows.length === 0) return -1;
    let best = 0;
    let found = false;
    let bestTop = Number.POSITIVE_INFINITY;
    for (let i = 0; i < rows.length; i++) {
      const top = rows[i].getBoundingClientRect().top;
      if (top >= 0 && top < bestTop) {
        bestTop = top;
        best = i;
        found = true;
      }
    }
    return found ? best : rows.length - 1;
  };
  const updateActive = (rows, lo, active) => {
    const dots = [...bar.querySelectorAll("[" + DOT_ATTR + "]")];
    for (let i = 0; i < dots.length; i++) {
      if (lo + i === active) dots[i].classList.add("active");
      else dots[i].classList.remove("active");
    }
  };
  const jumpToRow = (row) => {
    const scroller = scrollerOf();
    if (scroller === null || !(scroller instanceof HTMLElement)) return;
    scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -1, bubbles: true, cancelable: true }));
    scroller.scrollTop = scroller.scrollTop + row.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  };
  const contentOf = (row) => {
    const bubble = row.querySelector('[class*="bubble"]');
    const text = ((bubble ?? row).textContent ?? "").trim().replace(/\s+/g, " ");
    return text.length > TIP_MAX_LEN ? text.slice(0, TIP_MAX_LEN) + "…" : text;
  };
  const hideTip = () => {
    tip.style.display = "none";
  };
  const showTip = (row, anchor) => {
    const text = contentOf(row);
    if (text === "") return;
    tip.textContent = text;
    const r = anchor.getBoundingClientRect();
    tip.style.display = "block";
    const right = Math.max(8, window.innerWidth - r.left + 14);
    const top = Math.max(8, r.top - 8);
    tip.style.right = right + "px";
    tip.style.top = top + "px";
    if (tip.offsetHeight > 0 && top + tip.offsetHeight > window.innerHeight - 8) {
      tip.style.top = window.innerHeight - tip.offsetHeight - 8 + "px";
    }
  };
  let builtRows = [];
  let builtLo = 0;
  let builtHi = -1;
  const render = () => {
    position();
    if (flowOf() === null) {
      bar.style.display = "none";
      return;
    }
    const rows = userRows();
    if (rows.length === 0) {
      bar.style.display = "none";
      return;
    }
    bar.style.display = "flex";
    const active = computeActive(rows);
    let lo = 0;
    let hi = rows.length - 1;
    if (rows.length > WINDOW) {
      lo = Math.min(Math.max(0, active - (WINDOW >> 1)), rows.length - WINDOW);
      hi = lo + WINDOW - 1;
    }
    if (rows.length === builtRows.length && lo === builtLo && hi === builtHi && rows.every((row, i) => row === builtRows[i])) {
      updateActive(rows, lo, active);
      return;
    }
    bar.textContent = "";
    hideTip();
    const makeMore = (dir, label, target) => {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "omnifile-nav-more";
      more.setAttribute(MORE_ATTR, "");
      more.setAttribute("data-dir", dir);
      more.setAttribute("aria-label", label);
      more.textContent = dir === "up" ? "▲" : "▼";
      more.addEventListener("click", () => {
        if (target === void 0) return;
        jumpToRow(target);
        schedule();
      });
      bar.appendChild(more);
    };
    if (lo > 0) makeMore("up", "展开更早的用户消息", rows[Math.max(0, lo - 1)]);
    for (let i = lo; i <= hi; i++) {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "omnifile-nav-dot";
      dot.setAttribute(DOT_ATTR, "");
      dot.setAttribute("aria-label", "user #" + (i + 1) + "（点击跳转）");
      dot.setAttribute("title", "user #" + (i + 1));
      dot.addEventListener("click", () => jumpToRow(rows[i]));
      dot.addEventListener("mouseenter", () => showTip(rows[i], dot));
      dot.addEventListener("mousemove", () => showTip(rows[i], dot));
      dot.addEventListener("mouseleave", hideTip);
      bar.appendChild(dot);
    }
    if (hi < rows.length - 1) makeMore("down", "展开更新的用户消息", rows[Math.min(rows.length - 1, hi + 1)]);
    builtRows = rows;
    builtLo = lo;
    builtHi = hi;
    updateActive(rows, lo, active);
  };
  let renderScheduled = false;
  const schedule = () => {
    if (renderScheduled) return;
    renderScheduled = true;
    requestAnimationFrame(() => {
      renderScheduled = false;
      render();
    });
  };
  const setActive = (value) => {
    if (value) bar.classList.add("active");
    else bar.classList.remove("active");
  };
  strip.addEventListener("mouseenter", () => setActive(true));
  strip.addEventListener("mouseleave", () => setActive(false));
  bar.addEventListener("mouseenter", () => setActive(true));
  bar.addEventListener("mouseleave", () => setActive(false));
  let currentScroller = null;
  const bindScroller = () => {
    const next = scrollerOf();
    if (next === currentScroller) return;
    if (currentScroller !== null) currentScroller.removeEventListener("scroll", onScroll);
    currentScroller = next;
    if (currentScroller !== null) currentScroller.addEventListener("scroll", onScroll);
  };
  const onScroll = () => schedule();
  const observer = new MutationObserver(() => {
    bindScroller();
    schedule();
  });
  ctx.effect(() => {
    observer.observe(document.body, { childList: true, subtree: true });
    const sizeObserver = new ResizeObserver(() => requestPosition());
    sizeObserver.observe(document.body);
    window.addEventListener("resize", requestPosition);
    bindScroller();
    render();
    return () => {
      observer.disconnect();
      sizeObserver.disconnect();
      window.removeEventListener("resize", requestPosition);
      if (currentScroller !== null) currentScroller.removeEventListener("scroll", onScroll);
      strip.remove();
      bar.remove();
      tip.remove();
    };
  }, "dsh-omnifile: conversation nav");
}
function registerCodec(ctx, controller) {
  ctx.inject(["inputTriggers"], function(scope) {
    const triggers = scope && scope.get ? scope.get("inputTriggers") : void 0;
    if (triggers === void 0 || typeof triggers.registerSource !== "function") return;
    scope.effect(function() {
      return triggers.registerSource(controller.source());
    }, "dsh-omnifile: file reference source");
  });
}
let PARSE_STATUS_RE = null;
let PARSE_RE = null;
let PARSE_MARKER_RE = null;
function rebuildParsers() {
  PARSE_STATUS_RE = "(?:" + MARKER_STATUS_OK + "|" + MARKER_STATUS_UNREADABLE + "|" + MARKER_STATUS_FAILED + "|" + MARKER_UNKNOWN + ")";
  PARSE_RE = new RegExp(MARKER_PREFIX + "(.+?)（(" + PARSE_STATUS_RE + "[^）]*)）", "g");
  PARSE_MARKER_RE = new RegExp(MARKER_PREFIX + ".+?（(" + PARSE_STATUS_RE + "[^）]*)）");
}
rebuildParsers();
const startedCards = /* @__PURE__ */ new Set();
function extractFiles(content) {
  const files = [];
  let m;
  if (PARSE_RE === null) return files;
  PARSE_RE.lastIndex = 0;
  const text = textOf(content);
  const seenPaths = {};
  while ((m = PARSE_RE.exec(text)) !== null) {
    const path = String(m[1] || "").trim();
    if (path === "" || seenPaths[path]) continue;
    const statusTail = String(m[2] || "");
    const parsed = statusTail.indexOf(MARKER_STATUS_OK) === 0;
    const sourcePath = sourcePathOf(statusTail);
    const name = parsed ? basenameOf(path).replace(/\.md$/i, "") : basenameOf(path);
    seenPaths[path] = true;
    files.push({ name: name || "文件", kind: parsed ? KIND_DOC : KIND_OTHER, path, sourcePath });
  }
  return files;
}
function hasParseMarker(content) {
  return PARSE_MARKER_RE !== null && PARSE_MARKER_RE.test(textOf(content));
}
function chatNode(context, kind, anchorSeq, data) {
  return {
    key: context.key,
    kind,
    id: context.id,
    target: "chat",
    anchorSeq,
    location: context.start && context.start.location || context.matches && context.matches[0] && context.matches[0].location || { kind: "unresolved" },
    visibility: "visible",
    data
  };
}
function markStartedCard(messageId) {
  if (messageId !== "" && startedCards.has(messageId)) return true;
  if (messageId !== "") startedCards.add(messageId);
  return false;
}
function omnifileChatDefinition() {
  return {
    kind: "omnifile-files",
    target: "chat",
    match: function(event) {
      if (event.type !== "user/message") return null;
      let append = true;
      try {
        const runtime = require("@deepseek-ai/dsh-client-runtime");
        if (runtime && typeof runtime.isAppendSurfaceEvent === "function") append = runtime.isAppendSurfaceEvent(event);
      } catch (e) {
      }
      if (!append) return null;
      if (!hasParseMarker(event.data.content)) return null;
      return { id: String(event.data.id), role: "start" };
    },
    start: function(context, match, reader) {
      const messageId = String(match.event.data && match.event.data.id || "");
      if (messageId !== "" && markStartedCard(messageId)) return void 0;
      const files = extractFiles(match.event.data.content);
      if (files.length === 0) return void 0;
      return {
        kind: "omnifile-files",
        files,
        messageId: match.event.data.id,
        seq: match.event.seq,
        time: match.event.time
      };
    },
    update: function(context) {
      return context.state;
    },
    buildViewNode: function(context) {
      if (context.state === void 0) return null;
      return chatNode(context, "omnifile-files", context.state.seq + FILES_ANCHOR_OFFSET, context.state);
    }
  };
}
function OmnifileDock(props) {
  const controller = props.controller;
  useStore(controller);
  const occurrences = (props.input && props.input.occurrences || []).filter(function(o) {
    return o.source === common.SOURCE;
  });
  if (occurrences.length === 0) return null;
  const sending = Array.from(controller.records.values()).filter(function(r) {
    return r.awaitingSend || r._waitNotified;
  });
  const waiting = sending.filter(function(r) {
    return r.status !== "done" && r.status !== "error";
  });
  const doneCount = sending.length - waiting.length;
  const currentDetail = waiting.length > 0 ? waiting[0].progressDetail || "解析中..." : sending.length > 0 ? "即将完成..." : "";
  const sendWaitRow = waiting.length > 0 ? React__namespace.createElement(
    "div",
    { className: "omnifile-sendwait" },
    React__namespace.createElement("span", { className: "omnifile-sendwait-icon", "aria-hidden": "true" }, "⏳"),
    React__namespace.createElement(
      "span",
      { className: "omnifile-sendwait-text" },
      "正在解析文件 " + doneCount + "/" + sending.length + "：" + currentDetail + "（完成后自动发送）"
    )
  ) : null;
  return React__namespace.createElement(
    "div",
    { className: "omnifile-dock", role: "status", "aria-label": "已附加文件" },
    occurrences.map(function(occurrence) {
      const record = controller.records.get(occurrence.ref);
      if (record === void 0) return null;
      const detail = record.awaitingSend ? "等待解析完成后发送..." : record.status === "processing" ? record.progressDetail || "解析中..." : record.status === "done" ? "已就绪" : record.status === "error" ? record.error || "失败" : humanBytes(record.size);
      const disabled = !!(props.input && props.input.phase !== "plain");
      return React__namespace.createElement(
        "div",
        {
          key: occurrence.occurrenceId,
          className: "omnifile-chip",
          "data-status": record.status,
          "data-clickable": disabled ? "false" : "true",
          title: (record.error || record.path || "") + LBL_CHIP_OPEN,
          onClick: function(ev) {
            if (disabled) return;
            ev.stopPropagation();
            if (typeof props.openPath === "function" && record.path) props.openPath(record.path);
          }
        },
        React__namespace.createElement("span", { className: "omnifile-chip-icon" }, iconFor(record.kind, record.name)),
        React__namespace.createElement("span", { className: "omnifile-chip-name" }, record.name),
        React__namespace.createElement("span", { className: "omnifile-chip-detail" }, detail),
        React__namespace.createElement("button", {
          type: "button",
          className: "omnifile-chip-remove",
          "aria-label": "移除 " + record.name,
          disabled,
          onClick: function(ev) {
            ev.stopPropagation();
            props.remove(occurrence);
          }
        }, "×")
      );
    }),
    sendWaitRow
  );
}
function UploadButton(props) {
  const inputRef = React__namespace.useRef(null);
  props.controller;
  return React__namespace.createElement(
    "button",
    {
      type: "button",
      className: "omnifile-upload-btn",
      "aria-label": LBL_ADD_FILES,
      title: LBL_ADD_FILES,
      onClick: function() {
        if (inputRef.current) inputRef.current.click();
      }
    },
    React__namespace.createElement("input", {
      ref: inputRef,
      type: "file",
      multiple: true,
      style: { display: "none" },
      onChange: function(e) {
        const files = Array.from(e.target.files || []);
        if (files.length > 0 && props.sessionId) props.controller.addFiles(props.sessionId, files);
        e.target.value = "";
      }
    }),
    React__namespace.createElement(
      "svg",
      {
        width: 14,
        height: 14,
        viewBox: "0 0 16 16",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 1.5,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        style: { flex: "none", display: "block" }
      },
      React__namespace.createElement("path", { d: "M8 10V3" }),
      React__namespace.createElement("path", { d: "M4.5 6L8 2.5L11.5 6" }),
      React__namespace.createElement("path", { d: "M3 11.5v1.5h10v-1.5" })
    )
  );
}
function ParseBlock(props) {
  const file = props.file;
  const sourcePath = file.sourcePath || file.path;
  const [expanded, setExpanded] = React__namespace.useState(false);
  const [body, setBody] = React__namespace.useState(null);
  const [error, setError] = React__namespace.useState(null);
  const toggle = function(ev) {
    ev.stopPropagation();
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (body !== null || error !== null) return;
    if (typeof props.loadParsed !== "function") {
      setError("加载解析内容不可用");
      return;
    }
    props.loadParsed(props.sessionId, file).then(function(text) {
      setBody(text);
    }).catch(function(e) {
      setError(messageOf(e));
    });
  };
  const onKeyDown = function(e) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle(e);
    }
  };
  const bodyView = expanded ? body !== null ? React__namespace.createElement(
    "div",
    { className: "omnifile-parse-body" },
    React__namespace.createElement("pre", { className: "omnifile-parse-pre" }, body)
  ) : error !== null ? React__namespace.createElement("div", { className: "omnifile-parse-hint omnifile-parse-error" }, "加载解析内容失败：" + error) : React__namespace.createElement("div", { className: "omnifile-parse-hint" }, "正在加载...") : null;
  return React__namespace.createElement(
    "div",
    { className: "omnifile-parse-block" },
    React__namespace.createElement(
      "div",
      {
        className: "omnifile-parse-row",
        role: "button",
        tabIndex: 0,
        "aria-expanded": expanded,
        "aria-label": (expanded ? LBL_COLLAPSE : LBL_EXPAND) + "：" + file.name,
        title: expanded ? LBL_COLLAPSE : LBL_EXPAND,
        onClick: toggle,
        onKeyDown
      },
      React__namespace.createElement("span", { className: "omnifile-parse-icon" }, iconFor(file.kind, file.name)),
      React__namespace.createElement("span", { className: "omnifile-parse-title" }, file.name),
      React__namespace.createElement("span", { className: "omnifile-parse-caret", "aria-hidden": "true" }, expanded ? "▾" : "▸"),
      React__namespace.createElement("button", {
        type: "button",
        className: "omnifile-parse-open",
        "aria-label": LBL_OPEN_SOURCE + "：" + file.name,
        title: sourcePath + "（" + LBL_OPEN_SOURCE + "）",
        onClick: function(ev) {
          ev.stopPropagation();
          if (typeof props.openPath === "function") props.openPath(sourcePath);
        },
        /* 阻止按键冒泡：聚焦按钮按 Enter/Space 只触发打开源文件，不触发行展开。 */
        onKeyDown: function(e) {
          e.stopPropagation();
        }
      }, "📂")
    ),
    bodyView
  );
}
function OmnifileFilesCard(props) {
  const node = props.node;
  const seen = {};
  const files = (node && node.data && node.data.files || []).filter(function(file) {
    if (!file || !file.path) return false;
    if (seen[file.path]) return false;
    seen[file.path] = true;
    return true;
  });
  if (files.length === 0) return null;
  return React__namespace.createElement(
    "div",
    { className: "omnifile-chat-group" },
    files.map(function(file) {
      const key = file.path;
      if (file.kind === KIND_DOC || file.kind === KIND_TEXT) {
        return React__namespace.createElement(ParseBlock, {
          key,
          file,
          sessionId: props.sessionId,
          openPath: props.openPath,
          loadParsed: props.loadParsed
        });
      }
      return React__namespace.createElement(
        "div",
        { key, className: "omnifile-chat-files" },
        React__namespace.createElement(
          "button",
          {
            type: "button",
            className: "omnifile-chat-card",
            title: (file.sourcePath || file.path) + "（" + LBL_OPEN_SOURCE + "）",
            onClick: function() {
              if (typeof props.openPath === "function") props.openPath(file.sourcePath || file.path);
            }
          },
          React__namespace.createElement("span", { className: "omnifile-chip-icon" }, iconFor(file.kind, file.name)),
          React__namespace.createElement("span", { className: "omnifile-chat-name" }, file.name)
        )
      );
    })
  );
}
function OmnifileSettings(props) {
  const scope = props.scope;
  if (scope === void 0) return React__namespace.createElement("div", { className: "omnifile-hint" }, "设置服务不可用。可在 $DSH_HOME/settings.yaml 的 omnifile: 小节配置。");
  const snap = useStore(scope);
  const [draft, setDraft] = React__namespace.useState(null);
  const [savedTick, setSavedTick] = React__namespace.useState(0);
  const [catalog, setCatalog] = React__namespace.useState(null);
  const [catalogError, setCatalogError] = React__namespace.useState(null);
  const [jumpHint, setJumpHint] = React__namespace.useState(false);
  const base = snap && snap.value ? snap.value : {};
  const value = draft || base;
  const update = function(path, val) {
    const nextDraft = JSON.parse(JSON.stringify(draft || base || {}));
    setPath(nextDraft, path, val);
    setDraft(nextDraft);
    setSavedTick(0);
  };
  const loadCatalog = function() {
    setCatalogError(null);
    fetch("/api/omnifile/models").then(function(res) {
      return res.json();
    }).catch(function() {
      return { ok: false };
    }).then(function(json) {
      if (json && json.ok === true && Array.isArray(json.providers)) {
        setCatalog(json.providers.map(function(p) {
          return {
            ref: p.ref,
            displayName: p.providerDisplay || p.displayName || p.provider || "",
            modelId: p.modelId,
            modelName: p.modelName || p.modelId,
            baseURL: p.baseURL,
            apiKeyEnv: p.apiKeyEnv || "",
            image: p.image === true,
            modalities: Array.isArray(p.modalities) ? p.modalities : [],
            settingsNs: p.settingsNs || ""
          };
        }));
      } else {
        setCatalog([]);
        setCatalogError(json && json.error || "读取已配置模型失败");
      }
    });
  };
  React__namespace.useEffect(function() {
    loadCatalog();
  }, []);
  const pickCatalog = function(ref) {
    update(["providerRef"], ref);
  };
  const goToModels = function() {
    let jumped = false;
    try {
      if (props.settings && typeof props.settings.openSection === "function") {
        props.settings.openSection("models");
        jumped = true;
      }
    } catch (e) {
    }
    if (jumped) return;
    setJumpHint(true);
  };
  const commit = function() {
    const target = draft || base;
    const fields = [
      "providerRef",
      "reasoningEffort",
      "thinking",
      "concurrency",
      "temperature",
      "topP",
      "maxTokens",
      "describeCacheMax",
      "listMaxFiles",
      "listMaxDepth",
      "maxNameChars",
      "maxBatchImages",
      "progressPollMs",
      "maxFileBytes",
      "maxDocImages",
      "docMaxChars",
      "enableVariants",
      "timeoutMs"
    ];
    const writes = fields.filter(function(key) {
      return target[key] !== void 0 && target[key] !== null;
    }).map(function(key) {
      return [key, target[key]];
    });
    writes.push(["providerRef", typeof target.providerRef === "string" ? target.providerRef : ""]);
    writes.reduce(function(chain, op) {
      return chain.then(function() {
        return scope.set(op[0], op[1]);
      });
    }, Promise.resolve()).then(function() {
      return ["provider", "provider.baseUrl", "provider.model", "provider.credential", "_auto"].reduce(function(chain, key) {
        return chain.then(function() {
          return scope.unset(key);
        }).catch(function() {
        });
      }, Promise.resolve());
    }).then(function() {
      setSavedTick(function(n) {
        return n + 1;
      });
      scope.load();
    });
  };
  const activeRef = value && value.providerRef || "";
  const activeItem = (catalog || []).find(function(item) {
    return item.ref === activeRef;
  });
  const field = function(label, control, hint) {
    const children = [React__namespace.createElement("span", { className: "omnifile-cfg-label" }, label), control];
    if (hint) children.push(React__namespace.createElement("span", { className: "omnifile-cfg-hint" }, hint));
    return React__namespace.createElement("div", { className: "omnifile-cfg-group" }, children);
  };
  const numberInput = function(key, fallback, opts) {
    const o = opts || {};
    const div = o.mb ? 1024 * 1024 : 1;
    const current = value[key] === void 0 || value[key] === null ? fallback : Number(value[key]);
    return React__namespace.createElement("input", {
      className: "omnifile-cfg-input",
      type: "number",
      min: o.min,
      max: o.max,
      step: o.step,
      value: current / div,
      onChange: function(e) {
        const n = parseFloat(e.target.value);
        const raw = !Number.isFinite(n) ? fallback : o.mb ? Math.round(n * div) : o.integer ? n >= 1 ? Math.floor(n) : fallback : n;
        update([key], raw);
      }
    });
  };
  const numField = function(label, key, fallback, min, step, hint, mb) {
    return field(
      label,
      numberInput(key, fallback, { min, step, mb }),
      hint + (mb && (value[key] === void 0 || value[key] === null) ? "（当前 " + Math.round(fallback / (1024 * 1024)) + "MB）" : "")
    );
  };
  return React__namespace.createElement(
    "div",
    { className: "omnifile-cfg" },
    /* 头部 */
    React__namespace.createElement("div", { className: "omnifile-cfg-head" }, [
      React__namespace.createElement("h3", { className: "omnifile-cfg-title" }, "多模态模型配置"),
      React__namespace.createElement("p", { className: "omnifile-cfg-desc" }, "用于识别用户添加的图片、文档内嵌图片，并为文本-only 主模型生成图像描述。只从「设置-模型」中选择一个已配置的多模态模型，不在此保存多份模型配置。")
    ]),
    /* 从「设置-模型」选择（唯一配置来源） */
    React__namespace.createElement("div", { className: "omnifile-cfg-group" }, [
      React__namespace.createElement("span", { className: "omnifile-cfg-label" }, "多模态模型（来自「设置-模型」）"),
      React__namespace.createElement("select", {
        className: "omnifile-cfg-select",
        value: activeRef,
        disabled: catalog === null,
        onChange: function(e) {
          pickCatalog(e.target.value);
        }
      }, [
        React__namespace.createElement("option", { key: "", value: "", disabled: true }, catalog === null ? "正在读取已配置模型..." : "—— 请选择多模态模型 ——"),
        (catalog || []).map(function(item) {
          const badge = item.image === true ? "🖼" : "📝";
          return React__namespace.createElement(
            "option",
            { key: item.ref, value: item.ref },
            badge + " " + String(item.displayName || item.modelId) + " · " + item.modelName + " (" + item.modelId + ")" + (item.image === true ? "" : " · 无图片输入")
          );
        })
      ]),
      activeItem ? React__namespace.createElement("div", {
        className: "omnifile-cfg-tag",
        "data-image": activeItem.image === true ? "yes" : "no",
        title: (activeItem.modalities || []).join(", ")
      }, [
        React__namespace.createElement("b", { key: "b" }, (activeItem.image === true ? "🖼 " : "📝 ") + (activeItem.displayName || activeItem.modelId)),
        React__namespace.createElement("span", { key: "c" }, activeItem.modelName + "（" + activeItem.modelId + "） · " + (activeItem.baseURL || "默认端点"))
      ]) : React__namespace.createElement("span", { className: "omnifile-cfg-hint" }, "选择后将保存为该模型的唯一引用（providerRef），实际地址/密钥都来自「设置-模型」。"),
      activeItem && activeItem.image !== true ? React__namespace.createElement("div", { className: "omnifile-cfg-hint" }, "⚠ 该模型不支持图片输入（仅文本）。若用作多模态识图，识图请求会失败；请优先选择带 🖼 标注的支持图片的模型。") : null,
      catalogError && React__namespace.createElement("div", { className: "omnifile-cfg-error" }, "⚠ " + catalogError),
      catalog !== null && catalog.length === 0 && !catalogError ? React__namespace.createElement("div", { className: "omnifile-cfg-empty" }, [
        React__namespace.createElement("p", { key: "1" }, "当前没有可用的模型列表。请先到「设置-模型」里配置至少一个提供商/模型（支持图片输入的模型会带 🖼 标注）。"),
        React__namespace.createElement(
          "div",
          { key: "2", className: "omnifile-cfg-actions" },
          React__namespace.createElement("button", { type: "button", className: "omnifile-cfg-btn", onClick: goToModels }, "前往「设置-模型」配置")
        )
      ]) : React__namespace.createElement("div", { className: "omnifile-cfg-actions" }, [
        React__namespace.createElement("button", { type: "button", className: "omnifile-cfg-btn omnifile-cfg-btn-ghost", onClick: loadCatalog }, "刷新列表"),
        React__namespace.createElement("button", { type: "button", className: "omnifile-cfg-btn-link", onClick: goToModels }, "在「设置-模型」中管理模型 →")
      ]),
      jumpHint && React__namespace.createElement("div", { className: "omnifile-cfg-hint" }, "当前 DSH 版本未开放从插件小节直接跳转的接口；请点击设置面板左侧导航中的「模型」标签页。")
    ]),
    React__namespace.createElement("hr", { className: "omnifile-cfg-divider" }),
    /* 常规模型参数 */
    React__namespace.createElement("div", { className: "omnifile-cfg-grid" }, [
      field("采样温度 temperature（0–2）", numberInput("temperature", 0.7, { min: 0, max: 2, step: 0.1 }), "数值越低越确定，默认 0.7"),
      field("top_p（0–1）", numberInput("topP", 1, { min: 0, max: 1, step: 0.05 }), "nucleus 采样，默认 1"),
      field("最大输出 token", numberInput("maxTokens", 8192, { min: 1, step: 128, integer: true }), "默认 8192"),
      field("多模态并发数", numberInput("concurrency", 1, { min: 1, max: 16, step: 1, integer: true }), "同时识别多张图的任务数")
    ]),
    React__namespace.createElement("hr", { className: "omnifile-cfg-divider" }),
    /* 限制参数（可在设置界面配置） */
    React__namespace.createElement("div", { className: "omnifile-cfg-group" }, [
      React__namespace.createElement("span", { className: "omnifile-cfg-label" }, "上限与限制参数"),
      React__namespace.createElement("div", { className: "omnifile-cfg-grid" }, [
        numField("单文件大小（MB）", "maxFileBytes", 50 * 1024 * 1024, 1, 1, "单个上传文件大小上限", true),
        numField("单文档最多识别图片数", "maxDocImages", 8, 1, 1, "文档内嵌图片/扫描页交给多模态识别的数量上限"),
        numField("文档字符保留上限", "docMaxChars", 12e4, 1e3, 1e3, "文档转 Markdown 后保留的最大字符数，超出截断"),
        numField("识图缓存条数", "describeCacheMax", 300, 16, 1, "同一图片描述结果的 LRU 缓存条数"),
        numField("@ 文件选择器最大文件数", "listMaxFiles", 2e3, 1, 100, "递归列出工作区文件的上限"),
        numField("@ 文件选择器最大深度", "listMaxDepth", 12, 1, 1, "递归遍历最大深度"),
        numField("文件名最大长度（字符）", "maxNameChars", 120, 8, 1, "文件名清洗后的最大长度"),
        numField("单次图片批量上限", "maxBatchImages", 20, 1, 1, "一次粘贴/拖拽最多放入原生附件的图片数"),
        numField("进度轮询间隔（毫秒）", "progressPollMs", 400, 50, 50, "解析进度轮询间隔")
      ]),
      React__namespace.createElement("span", { className: "omnifile-cfg-hint" }, "修改后点击「保存配置」生效；宿主侧（文件大小/文档截断/@ 列表等）需重启后完全生效，客户端侧（图片批量/轮询间隔）由设置保存后即时生效。")
    ]),
    React__namespace.createElement("div", { className: "omnifile-cfg-group" }, [
      React__namespace.createElement(
        "label",
        { className: "omnifile-cfg-check" },
        React__namespace.createElement("input", {
          type: "checkbox",
          checked: value.thinking === true,
          onChange: function(e) {
            update(["thinking"], e.target.checked);
          }
        }),
        "启用思考模式（默认禁止；开启时发送 reasoning_effort）"
      )
    ]),
    /* 底部操作 */
    React__namespace.createElement("div", { className: "omnifile-cfg-actions" }, [
      React__namespace.createElement("button", { type: "button", className: "omnifile-cfg-btn", onClick: commit }, "保存配置"),
      savedTick > 0 && React__namespace.createElement("span", { key: "saved", className: "omnifile-cfg-saved" }, "✓ 已保存")
    ])
  );
}
function apply(ctx) {
  ctx.effect(installStyles, "dsh-omnifile: styles");
  const controller = new OmnifileController(ctx);
  installPasteAndDrag(ctx, controller);
  registerCodec(ctx, controller);
  installMarkerHiding(ctx);
  installConversationNav(ctx);
  ctx.slots.inject("conversation.input.dock", function() {
    return ctx.slots.register({
      name: "conversation.input.dock",
      id: "omnifile",
      order: 5,
      inject: function(sessionId) {
        return {
          controller,
          remove: function(occurrence) {
            controller.remove(String(sessionId), occurrence);
          },
          /* 点击 dock 缩略图/文件卡片 → 用系统默认程序预览 */
          openPath: function(path) {
            controller.openPath(String(sessionId), path);
          }
        };
      }
    }, OmnifileDock);
  });
  ctx.slots.inject("conversation.input.left", function() {
    return ctx.slots.register({
      name: "conversation.input.left",
      id: "omnifile",
      order: 10,
      inject: function(sessionId) {
        return { controller, sessionId: String(sessionId) };
      }
    }, UploadButton);
  });
  ctx.slots.inject("conversation.chat.node", function() {
    return ctx.slots.register({
      name: "conversation.chat.node",
      key: "omnifile-files",
      inject: function(sessionId) {
        return {
          sessionId: String(sessionId),
          openPath: function(path) {
            controller.openPath(String(sessionId), path);
          },
          loadParsed: function(sid, file) {
            return controller.loadParsed(String(sid || sessionId), file);
          }
        };
      }
    }, OmnifileFilesCard);
  });
  ctx.inject(["conversationEvents"], function(scope) {
    const events = scope && scope.get ? scope.get("conversationEvents") : void 0;
    if (events && typeof events.register === "function") {
      events.register(omnifileChatDefinition());
    }
  });
  ctx.slots.inject("settings.section", function() {
    return ctx.slots.register({
      name: "settings.section",
      id: "omnifile",
      order: 30,
      label: function() {
        return "DshOmniFile";
      },
      inject: function() {
        let scope;
        try {
          const binder = ctx.get("settingsScope");
          if (binder && typeof binder.bind === "function") scope = binder.bind({ namespace: NAMESPACE });
        } catch (e) {
          scope = void 0;
        }
        return { scope };
      }
    }, OmnifileSettings);
  });
}
const inject = ["slots", "sessions", "conversation", "conversationEvents", "remote"];
exports.SOURCE = SOURCE;
exports.apply = apply;
exports.common = common;
exports.inject = inject;

        return module.exports;
    }
});
