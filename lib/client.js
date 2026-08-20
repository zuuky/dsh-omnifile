window.__ModuleLoader__.load({
    id: 'dsh-omnifile',
    factory: (require) => {
        var module = {exports: {}};
        var exports = module.exports;
        Object.defineProperty(exports, Symbol.toStringTag, {value: 'Module'});
        let react = require('react');

        /* ════════════════════════════════════════════════════════════════════
         * 双端共用元素：唯一来源 lib/common.js（宿主静态 import；浏览器端由于 DSH
         * 只加载一个客户端 bundle、require 无法解析兄弟文件，由宿主在 /api/omnifile/common.js
         * 提供该文件 ESM 源码，这里 ensureCommon() 动态 import 拿到同一份导出）。
         * 下方 common 对象为「启动镜像」：保证同步代码在任何时序下都有值（与 common.js
         * 同步），ensureCommon() 拉取成功后立即以权威值覆盖并重建解析正则。
         * ════════════════════════════════════════════════════════════════════ */
        /* 消息标记（与宿主 serialize/工具 execute 同形；PARSE_RE 据此提取文件清单）。 */
        const common = {
            SOURCE: '文件',
            MARKER_PREFIX: '解析后保存路径：',
            MARKER_STATUS_OK: '完整内容见上方文件卡片，可点击展开',
            MARKER_STATUS_UNREADABLE: '无法按文本读取',
            MARKER_STATUS_FAILED: '解析失败',
            MARKER_UNKNOWN: '未知原因',
            MARKER_SOURCE_TAG: '源文件：',
            KIND_IMAGE: 'image',
            KIND_DOC: 'doc',
            KIND_TEXT: 'text',
            KIND_MEDIA: 'media',
            KIND_OTHER: 'other',
        };
        let commonReady = false;
        let commonLoading = null;

        /** 拉取 lib/common.js 的权威共用元素（幂等；失败静默保留启动镜像，允许重试）。 */
        function ensureCommon() {
            if (commonReady) return Promise.resolve(true);
            if (commonLoading === null) {
                commonLoading = import('/api/omnifile/common.js').then(function (m) {
                    common.SOURCE = m.SOURCE;
                    common.MARKER_PREFIX = m.MARKER_PREFIX;
                    common.MARKER_STATUS_OK = m.MARKER_STATUS_OK;
                    common.MARKER_STATUS_UNREADABLE = m.MARKER_STATUS_UNREADABLE;
                    common.MARKER_STATUS_FAILED = m.MARKER_STATUS_FAILED;
                    common.MARKER_UNKNOWN = m.MARKER_UNKNOWN;
                    common.MARKER_SOURCE_TAG = m.MARKER_SOURCE_TAG;
                    common.KIND_IMAGE = m.KIND_IMAGE;
                    common.KIND_DOC = m.KIND_DOC;
                    common.KIND_TEXT = m.KIND_TEXT;
                    common.KIND_MEDIA = m.KIND_MEDIA;
                    common.KIND_OTHER = m.KIND_OTHER;
                    common.markerText = m.markerText;
                    common.sourcePathOf = m.sourcePathOf;
                    commonReady = true;
                    rebuildParsers();
                    return true;
                }).catch(function (err) {
                    commonLoading = null; /* 失败允许下次重试 */
                    console.warn('[dsh-omnifile] 拉取 common.js 失败，使用启动镜像：' + messageOf(err));
                    return false;
                });
            }
            return commonLoading;
        }

        /* 组装「解析后保存路径」标记（统一签名 markerText(path, {ok, note, source})；
         * 未加载 common.js 前按启动镜像组装，逻辑与 lib/common.js 完全一致）。 */
        function markerText(path, options) {
            if (typeof common.markerText === 'function') return common.markerText(path, options);
            const opts = options || {};
            const isOk = opts.ok === true || opts.ok === common.MARKER_STATUS_OK;
            if (isOk) {
                const sourceTail = (typeof opts.source === 'string' && opts.source !== '' && opts.source !== path)
                    ? '；' + common.MARKER_SOURCE_TAG + opts.source
                    : '';
                return common.MARKER_PREFIX + path + '（' + common.MARKER_STATUS_OK + sourceTail + '）';
            }
            const status = opts.ok === false ? common.MARKER_STATUS_FAILED
                : (typeof opts.ok === 'string' && opts.ok !== '' ? opts.ok : common.MARKER_STATUS_UNREADABLE);
            return common.MARKER_PREFIX + path + '（' + status + (opts.note ? '：' + opts.note : '') + '）';
        }

        /** 从状态尾巴提取「源文件」绝对路径（优先 common.js 权威实现）。 */
        function sourcePathOf(statusTail) {
            if (typeof common.sourcePathOf === 'function') return common.sourcePathOf(statusTail);
            const at = String(statusTail || '').indexOf(common.MARKER_SOURCE_TAG);
            if (at < 0) return undefined;
            const value = String(statusTail).slice(at + common.MARKER_SOURCE_TAG.length).trim();
            return value === '' ? undefined : value;
        }
        /* UI 文案（集中收拢，避免改不全）。 */
        const LBL_OPEN_SOURCE = '用本地默认程序打开源文件';
        const LBL_CHIP_OPEN = '（点击预览）';
        const LBL_ADD_FILES = '添加本地文件（可多选，支持拖拽/粘贴）';
        const LBL_EXPAND = '展开解析结果';
        const LBL_COLLAPSE = '收起解析结果';
        /* 客户端限额缺省值（启动时由 /api/omnifile/config 覆盖）。 */
        const DEFAULT_LIMITS = {
            maxFileBytes: 50 * 1024 * 1024,
            maxBatchImages: 20,
            progressPollMs: 400,
        };
        /* @ 候选菜单最多返回条数 */
        const CANDIDATE_LIMIT = 200;
        /* 卡片锚点偏移：排到用户消息上方 */
        const FILES_ANCHOR_OFFSET = -0.5;

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
            /* 聊天文件解析卡片（每条一行，右对齐） */
            /* 卡片区域宽度 = 对话框宽度（跟随容器变化）；展开不改变宽度，避免 UI 跳动 */
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
        ].join('');

        function installStyles() {
            if (typeof document === 'undefined') return function () {
            };
            const id = '@dsh-omnifile/styles';
            if (document.querySelector('style[data-plugin-css="' + id + '"]') !== null) return function () {
            };
            const tag = document.createElement('style');
            tag.dataset.plugin = 'dsh-omnifile';
            tag.dataset.pluginCss = id;
            tag.textContent = CSS;
            document.head.appendChild(tag);
            return function () {
                tag.remove();
            };
        }

        function id() {
            if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID();
            return 'omnifile-' + Date.now() + '-' + Math.floor(Math.random() * 1e6);
        }

        function humanBytes(bytes) {
            if (!Number.isFinite(bytes) || bytes <= 0) return '';
            if (bytes < 1024) return bytes + ' B';
            if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
            return (bytes / 1024 / 1024).toFixed(1) + ' MB';
        }

        function messageOf(error) {
            return error instanceof Error ? error.message : String(error);
        }

        /** 订阅 store：封装 useSyncExternalStore；兼容只暴露 snapshot() 的对象（如本插件 controller）。 */
        function useStore(store) {
            const read = typeof store.getSnapshot === 'function'
                ? function () { return store.getSnapshot(); }
                : function () { return store.snapshot(); };
            return react.useSyncExternalStore(
                function (onStoreChange) { return store.subscribe(onStoreChange); },
                read,
                read,
            );
        }

        /* 聊天卡片定位标记（纯可读文本，无 token）。统一形态为一行：
         *   解析后保存路径：<绝对路径>（<状态说明>[；源文件：<源绝对路径>]）
         * 状态说明：完整内容见上方文件卡片，可点击展开（成功，路径为 {源文件名}.md，可带源文件回指）/
         *   无法按文本读取：… / 解析失败：…（失败，路径为源文件）。
         * 正则的状态分支用 common 常量动态生成（唯一来源 common.js），ensureCommon()
         * 拉到权威值后 rebuildParsers() 重建；正则要求 （ 后紧跟本插件的状态词，
         * 避免把内容里形似的字符串误抽。 */
        let PARSE_STATUS_RE = null;
        let PARSE_RE = null;
        let PARSE_MARKER_RE = null;

        function rebuildParsers() {
            PARSE_STATUS_RE = '(?:' + common.MARKER_STATUS_OK + '|' + common.MARKER_STATUS_UNREADABLE
                + '|' + common.MARKER_STATUS_FAILED + '|' + common.MARKER_UNKNOWN + ')';
            /* 组1=保存路径，组2=状态词+尾巴（含「；源文件：…」），供 sourcePathOf 提取源文件。 */
            PARSE_RE = new RegExp(common.MARKER_PREFIX + '(.+?)（(' + PARSE_STATUS_RE + '[^）]*)）', 'g');
            PARSE_MARKER_RE = new RegExp(common.MARKER_PREFIX + '.+?（(' + PARSE_STATUS_RE + '[^）]*)）');
        }
        rebuildParsers();

        /* 已生成卡片的消息防重：同一消息只建一次卡片节点（防御运行时对同一逻辑消息产生不同 id 的重复事件）。 */
        const startedCards = new Set();

        function iconFor(kind, name) {
            const ext = String(name || '').split('.').pop().toLowerCase();
            if (kind === common.KIND_IMAGE) return '🖼';
            if (kind === common.KIND_DOC) {
                if (ext === 'pdf') return '📕';
                if (['doc', 'docx', 'docm', 'rtf', 'odt'].indexOf(ext) >= 0) return '📘';
                if (['xls', 'xlsx', 'xlsm', 'xlsb', 'ods', 'csv'].indexOf(ext) >= 0) return '📗';
                if (['ppt', 'pptx', 'pptm', 'pps', 'ppsx', 'pot', 'ppsm', 'odp'].indexOf(ext) >= 0) return '📙';
                if (ext === 'epub') return '📚';
                return '📄';
            }
            if (kind === common.KIND_MEDIA) return '🎞';
            return '📝';
        }

        function isImageFile(file) {
            return typeof file.type === 'string' && file.type.toLowerCase().startsWith('image/');
        }

        function collectFiles(data) {
            if (data === null || data === undefined) return [];
            const itemFiles = Array.from(data.items || [])
                .filter(function (item) {
                    return item.kind === 'file';
                })
                .map(function (item) {
                    return item.getAsFile();
                })
                .filter(function (file) {
                    return file !== null;
                });
            return itemFiles.length > 0 ? itemFiles : Array.from(data.files || []);
        }

        function textOf(content) {
            if (!Array.isArray(content)) return '';
            return content
                .filter(function (block) {
                    return block && block.type === 'text';
                })
                .map(function (block) {
                    return String(block.text || '');
                })
                .join('\n');
        }

        /** 取路径 basename（兼容 / 与 \）。 */
        function basenameOf(path) {
            return String(path || '').split(/[\\/]/).pop() || '';
        }

        /** 从消息正文提取「已解析文件」清单（保存路径/源文件/显示名/类别），按保存路径去重。 */
        function extractFiles(content) {
            const files = [];
            let m;
            PARSE_RE.lastIndex = 0;
            const text = textOf(content);
            const seenPaths = {};
            while ((m = PARSE_RE.exec(text)) !== null) {
                const path = String(m[1] || '').trim();
                if (path === '' || seenPaths[path]) continue;
                const statusTail = String(m[2] || '');
                const parsed = statusTail.indexOf(common.MARKER_STATUS_OK) === 0;
                const sourcePath = sourcePathOf(statusTail);
                /* 成功时保存路径即 <uploads>/<源文件名>.md，显示名还原自 md 文件名；失败路径为源文件。 */
                const name = parsed ? basenameOf(path).replace(/\.md$/i, '') : basenameOf(path);
                seenPaths[path] = true;
                files.push({name: name || '文件', kind: parsed ? common.KIND_DOC : common.KIND_OTHER, path, sourcePath});
            }
            return files;
        }

        /** 判断消息是否存在「已解析文件」标记（纯可读文本，无 token）。 */
        function hasParseMarker(content) {
            return PARSE_MARKER_RE.test(textOf(content));
        }

        function chatNode(context, kind, anchorSeq, data) {
            return {
                key: context.key,
                kind: kind,
                id: context.id,
                target: 'chat',
                anchorSeq: anchorSeq,
                location: (context.start && context.start.location) || (context.matches && context.matches[0] && context.matches[0].location) || {kind: 'unresolved'},
                visibility: 'visible',
                data: data,
            };
        }

        class OmnifileController {
            constructor(ctx) {
                this.ctx = ctx;
                this.records = new Map();
                this.listeners = new Set();
                this.revision = 0;
                this._fileCache = new Map();
                this._parsedCache = new Map();
                /* 发送锁：sessionId -> 当前“等待解析完成后发送”周期的 signal；用于防重复发送。 */
                this._sendSignal = new Map();
                /* 客户端限额从宿主 /api/omnifile/config 读取，避免与 settings 不同步。 */
                this.limits = Object.assign({}, DEFAULT_LIMITS);
                this.loadLimits();
            }

            /** 从宿主读取当前生效的客户端限额（文件大小/图片批量/轮询间隔），失败静默保留缺省值。 */
            loadLimits() {
                const controller = this;
                fetch('/api/omnifile/config')
                    .then(function (res) {
                        return res.json();
                    })
                    .catch(function () {
                        return {};
                    })
                    .then(function (json) {
                        const limits = json && json.ok === true ? json.limits : null;
                        if (limits === null) return;
                        const next = {};
                        const map = {maxFileBytes: 'maxFileBytes', maxBatchImages: 'maxBatchImages', progressPollMs: 'progressPollMs'};
                        Object.keys(map).forEach(function (key) {
                            const value = Number(limits[map[key]]);
                            if (Number.isFinite(value) && value > 0) next[key] = key === 'progressPollMs' ? Math.max(50, value) : value;
                        });
                        if (Object.keys(next).length > 0) controller.limits = Object.assign({}, controller.limits, next);
                    });
            }

            subscribe(fn) {
                this.listeners.add(fn);
                return function () {
                    const self = this;
                    self.listeners.delete(fn);
                }.bind(this);
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
                    } catch (e) { /* ignore */
                    }
                }
            }

            currentSessionId() {
                const list = this.ctx.get('sessions');
                const current = list && list.list && list.list.getSnapshot ? list.list.getSnapshot().current : undefined;
                return current === undefined ? undefined : String(current);
            }

            inputFor(sessionId) {
                const sessions = this.ctx.get('sessions');
                const conversation = this.ctx.get('conversation');
                if (sessions === undefined || conversation === undefined) return undefined;
                const actx = sessions.scope(sessionId);
                if (actx === undefined) return undefined;
                try {
                    return conversation.input.for(actx);
                } catch (e) {
                    return undefined;
                }
            }

            async saveOne(sessionId, file) {
                const cap = this.limits.maxFileBytes || DEFAULT_LIMITS.maxFileBytes;
                if (file.size > cap) return {ok: false, error: '「' + file.name + '」超过 ' + Math.round(cap / 1024 / 1024) + 'MB，已跳过'};
                const dataUrl = await new Promise(function (resolveRead, rejectRead) {
                    const reader = new FileReader();
                    reader.onerror = function () {
                        rejectRead(new Error('读取失败'));
                    };
                    reader.onload = function () {
                        resolveRead(String(reader.result || ''));
                    };
                    reader.readAsDataURL(file);
                });
                const comma = dataUrl.indexOf(',');
                const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : '';
                const response = await fetch('/api/omnifile/save', {
                    method: 'POST',
                    headers: {'content-type': 'application/json'},
                    body: JSON.stringify({sessionId: sessionId, name: file.name, base64: base64}),
                });
                const json = await response.json().catch(function () {
                    return {};
                });
                if (json && json.ok === true) return {
                    ok: true,
                    path: json.path,
                    kind: json.kind,
                    size: json.size
                };
                return {ok: false, error: (json && json.error) || ('上传失败（HTTP ' + response.status + '）')};
            }

            addNativeImages(sessionId, input, files) {
                const conversation = this.ctx.get('conversation');
                if (conversation === undefined || typeof conversation.createDraftImages !== 'function') return false;
                try {
                    const attachments = conversation.createDraftImages(files.slice(0, this.limits.maxBatchImages || DEFAULT_LIMITS.maxBatchImages));
                    if (attachments.length > 0) input.addImages(attachments.map(function (a) {
                        return a.id;
                    }));
                    return true;
                } catch (error) {
                    try {
                        input.notify('error', '图片添加失败：' + messageOf(error));
                    } catch (e) { /* ignore */
                    }
                    return false;
                }
            }

            async addNonImage(sessionId, input, file) {
                const saved = await this.saveOne(sessionId, file);
                if (!saved.ok) {
                    try {
                        input.notify('error', saved.error);
                    } catch (e) { /* ignore */
                    }
                    return false;
                }
                const ref = id();
                const record = {
                    ref: ref,
                    sessionId: sessionId,
                    name: file.name,
                    path: saved.path,
                    kind: saved.kind || 'other',
                    size: saved.size || file.size,
                    status: 'ready',
                    error: undefined,
                };
                this.records.set(ref, record);
                const snapshot = input.state.getSnapshot();
                const draftStr = String(snapshot.draft || '');
                if (draftStr !== '' && !/\s$/.test(draftStr)) input.setDraft(draftStr + ' ');
                const next = input.state.getSnapshot();
                const start = next.draft.length;
                /* 占位符为可见文件 chip（label=文件名）：用户能看到附件位置，删除 chip 为显式的主动操作。
                 * 不能把 label 置空，否则 backdrop 隐藏 chip 后 textarea 里的 U+FFFC 原本体会裸露成"隐形占位"。 */
                const accepted = input.insertReference({
                    source: common.SOURCE,
                    ref: ref,
                    label: file.name,
                    clipboardText: '[文件: ' + file.name + ']',
                }, {start: start, end: start, draftRev: next.draftRev});
                if (!accepted) {
                    this.records.delete(ref);
                    return false;
                }
                this.changed();
                /* 选中即解析：立即后台 /process（含多模态等耗时步骤），发送时 serialize 会 await 同一 promise。 */
                this.startProcess(ref).catch(function () {});
                return true;
            }

            async addFiles(sessionId, files) {
                if (!Array.isArray(files) || files.length === 0) return;
                const input = this.inputFor(sessionId);
                if (input === undefined) return;
                const state = input.state.getSnapshot();
                const images = files.filter(isImageFile);
                /* 所有非图片文件（含未知格式）都走上传+解析；未知格式由 host 按文本读取，读不了会提示用户。 */
                const docs = files.filter(function (file) {
                    return !isImageFile(file);
                });
                if (images.length > 0 && state.phase === 'plain') this.addNativeImages(sessionId, input, images);
                const failures = [];
                for (const file of docs) {
                    try {
                        const ok = await this.addNonImage(sessionId, input, file);
                        if (!ok) failures.push('「' + file.name + '」未添加');
                    } catch (error) {
                        failures.push('「' + file.name + '」添加失败：' + messageOf(error));
                    }
                }
                if (failures.length > 0) {
                    try {
                        input.notify('error', failures.join('；'));
                    } catch (e) { /* ignore */
                    }
                }
            }

            /** 轮询宿主端处理进度，把实时阶段写入 chip 详情（多模态识别时用户能看到“识别图片 x/n”）。 */
            pollProgress(token, signal, record) {
                let stopped = false;
                const poll = function () {
                    if (stopped) return;
                    fetch('/api/omnifile/status?token=' + encodeURIComponent(token), {signal: signal || undefined})
                        .then(function (res) {
                            return res.json();
                        })
                        .catch(function () {
                            return {};
                        })
                        .then(function (json) {
                            if (stopped) return;
                            const p = json && json.progress;
                            if (p && typeof p.detail === 'string' && p.detail !== '') {
                                record.progressDetail = p.detail;
                            } else if (p && typeof p.stage === 'string' && p.stage !== '') {
                                record.progressDetail = p.stage;
                            }
                            this.changed();
                        });
                }.bind(this);
                const timer = setInterval(poll, this.limits.progressPollMs || DEFAULT_LIMITS.progressPollMs);
                poll();
                return function () {
                    stopped = true;
                    clearInterval(timer);
                };
            }

            /**
             * 选中即解析（幂等）：同一 ref 只发起一次 /process，后续调用复用进行中的 promise。
             * 解析进度写入 chip；成功时把 md 落盘路径记到 record.parsedPath。发送时 serialize
             * await 此方法，从而保证“点击发送时所有文件都已解析完成”。
             * @returns {Promise<object|null>} 解析结果 json；失败时置 record.error 并 reject（调用方捕获）。
             */
            async startProcess(ref, signal) {
                const record = this.records.get(ref);
                if (record === undefined) throw new Error('文件已从草稿移除');
                if (record.path === undefined || record.path === '') throw new Error('文件尚未保存完成');
                if (record.status === 'done' && record._result !== undefined) return record._result;
                if (record._processPromise !== undefined) return record._processPromise;
                record.status = 'processing';
                record._result = undefined;
                record.error = undefined;
                record.progressDetail = '';
                this.changed();
                const token = id();
                const stopPoll = this.pollProgress(token, signal, record);
                const promise = (async function () {
                    try {
                        const response = await fetch('/api/omnifile/process', {
                            method: 'POST',
                            headers: {'content-type': 'application/json'},
                            body: JSON.stringify({sessionId: record.sessionId, path: record.path, name: record.name, kind: record.kind, token: token}),
                            signal: signal || undefined,
                        });
                        const json = await response.json().catch(function () {
                            return {};
                        });
                        if (!json || json.ok !== true) throw new Error((json && json.error) || ('处理失败（HTTP ' + response.status + '）'));
                        record.status = 'done';
                        record._result = json;
                        if (typeof json.parsedPath === 'string' && json.parsedPath !== '') record.parsedPath = json.parsedPath;
                        this.changed();
                        return json;
                    } catch (error) {
                        record.status = 'error';
                        record.error = messageOf(error);
                        this.changed();
                        throw error;
                    } finally {
                        stopPoll();
                    }
                }.bind(this))();
                record._processPromise = promise;
                /* 后台预解析的 rejection 在此消化，避免 unhandledrejection；serialize 会显式 await 恢复错误。 */
                promise.catch(function () {});
                return promise;
            }

            /** 把 ref 的解析结果序列化为一行可读消息标记；发送时由运行时 await，等待该文件解析完成。
             * 统一格式：解析后保存路径：<md 或源路径>（完整内容见上方文件卡片，可点击展开；源文件：<源路径> | 无法按文本读取：… | 解析失败：…）
             * 成功时保存路径即 {源文件名}.md 绝对路径，模型可用内置 read 直接读取；源文件为原始文件路径。 */
            async serialize(ref, signal) {
                /* 发送前确保拿到 common.js 权威常量（本地毫秒级；失败继续用启动镜像）。 */
                await ensureCommon();
                const self = this;
                const record = this.records.get(ref);
                if (record === undefined) throw new Error('文件已从草稿移除');
                if (record.path === undefined || record.path === '') throw new Error('文件尚未保存完成');
                const sid = record.sessionId;
                /* 防重复发送：同一会话已有一次“等待解析完成后发送”的周期 → 本轮为重复点击，拒绝之，
                 * 框架会 abort 本轮且不发出第二条消息（默认 sink 不执行）。 */
                const activeSignal = this._sendSignal.get(sid);
                if (activeSignal !== undefined && activeSignal !== signal) {
                    return Promise.reject(new Error('已有点发送正在等待文件解析完成，请勿重复点击'));
                }
                if (activeSignal === undefined) {
                    this._sendSignal.set(sid, signal);
                    /* 周期被 abort（取消/失败时框架会 abort 该 signal）→ 释放发送锁，允许重新发送。 */
                    if (typeof signal.addEventListener === 'function') {
                        signal.addEventListener('abort', function () {
                            if (self._sendSignal.get(sid) === signal) self._sendSignal.delete(sid);
                        });
                    }
                }
                /* 点发送时文件还在解析：标 awaitingSend → 对话区底部显示实时解析进度，chip 同步等待态。 */
                if (record.status !== 'done' && !record._waitNotified) {
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
                /* 取消/删除文件：该引用已不在草稿 → 拒绝本发送周期，框架 abort、不发消息、草稿保留。 */
                const occs = typeof this.inputFor === 'function' ? this.inputFor(sid)?.state?.getSnapshot?.()?.occurrences : undefined;
                const stillInDraft = !Array.isArray(occs) || occs.some(function (o) {
                    return o.source === common.SOURCE && o.ref === ref;
                });
                if (!stillInDraft) {
                    return Promise.reject(new Error('文件已被移除，发送已取消，请重新发送'));
                }
                /* 解析已结束：解除等待态。 */
                if (record.awaitingSend) {
                    record.awaitingSend = false;
                    this.changed();
                }
                /* 发送成功提交后（草稿清空、本引用消失）释放发送锁；microtask 的 defaultSink 先于本宏任务执行，
                 * 因此此处看到的 occurreneces 反映的是“发送后”的状态。 */
                setTimeout(function () {
                    if (self._sendSignal.get(sid) !== signal) return;
                    const occs2 = typeof self.inputFor === 'function' ? self.inputFor(sid)?.state?.getSnapshot?.()?.occurrences : undefined;
                    const mine = Array.isArray(occs2) && occs2.some(function (o) {
                        return o.source === common.SOURCE && o.ref === ref;
                    });
                    if (!mine) self._sendSignal.delete(sid);
                }, 0);
                if (json !== null && json.ok === true) {
                    const p = (typeof json.parsedPath === 'string' && json.parsedPath !== '') ? json.parsedPath : record.path;
                    if (json.kind === 'other') {
                        /* 不可读：保存路径即源文件，无需再附源文件回指。 */
                        return markerText(p, {ok: common.MARKER_STATUS_UNREADABLE, note: json.note || ''}) + '\n';
                    }
                    /* image / doc / text 命中 → 有 md（{源文件名}.md），只放一行引用，完整内容在卡片里；
                     * 附「源文件」回指，客户端 📂 与卡片据此打开原始文件。 */
                    return markerText(p, {ok: common.MARKER_STATUS_OK, source: record.path}) + '\n';
                }
                return markerText(record.path, {ok: common.MARKER_STATUS_FAILED, note: record.error || ''}) + '\n';
            }

            remove(sessionId, occurrence) {
                const input = this.inputFor(sessionId);
                if (input === undefined) return;
                if (input.state.getSnapshot().phase !== 'plain') return;
                const snapshot = input.state.getSnapshot();
                const current = snapshot.occurrences.find(function (o) {
                    return o.source === common.SOURCE && o.occurrenceId === occurrence.occurrenceId && o.ref === occurrence.ref;
                });
                if (current === undefined) return;
                const accepted = input.insertText('', {
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
                    trigger: '@',
                    name: common.SOURCE,
                    order: 1000,
                    candidates: function (projection, opts) {
                        const sessionId = projection && projection.sessionId;
                        if (sessionId === undefined || sessionId === '') return Promise.resolve([]);
                        return controller.listWorkspaceFiles(sessionId, opts && opts.query, opts && opts.signal);
                    },
                    onPick: function (pick) {
                        const candidate = pick && pick.candidate;
                        if (candidate === undefined || candidate === null || typeof candidate.path !== 'string' || candidate.path === '') return undefined;
                        const sessionId = pick.session && pick.session.sessionId;
                        const ref = id();
                        const record = {
                            ref: ref,
                            sessionId: sessionId,
                            name: String(candidate.name || '文件'),
                            path: candidate.path,
                            kind: String(candidate.kind || 'other'),
                            size: Number(candidate.size) || 0,
                            status: 'ready',
                            error: undefined,
                        };
                        controller.records.set(ref, record);
                        controller.changed();
                        /* 选中即解析：工作区文件已有真实路径，立即后台 /process，发送时 serialize 会 await。 */
                        controller.startProcess(ref).catch(function () {});
                        return {
                            insert: {
                                source: common.SOURCE,
                                ref: ref,
                                label: record.name,
                                clipboardText: '[文件: ' + record.name + ']',
                            },
                        };
                    },
                    codec: {
                        clipboardText: (ref) => {
                            const record = controller.records.get(ref);
                            return '[文件: ' + (record ? record.name : '附件') + ']';
                        },
                        serialize: (ref, signal) => controller.serialize(ref, signal),
                    },
                };
            }

            async openPath(sessionId, path) {
                const connection = this.ctx.get('connection');
                if (connection && connection.api && connection.api.host && typeof connection.api.host.openPath === 'function') {
                    try {
                        await connection.api.host.openPath({path: path});
                        return;
                    } catch (e) { /* fall through */
                    }
                }
                try {
                    await fetch('/api/omnifile/open', {
                        method: 'POST',
                        headers: {'content-type': 'application/json'},
                        body: JSON.stringify({sessionId: sessionId, path: path}),
                    });
                } catch (e) { /* ignore */
                }
            }

            /** 懒加载解析结果（<uploads>/<源文件名>.md）：按 会话|路径 缓存成功结果、去重在途请求。 */
            loadParsed(sessionId, file) {
                const path = file && file.path;
                if (typeof path !== 'string' || path === '') return Promise.reject(new Error('没有可加载的解析文件'));
                const key = String(sessionId || '') + '|' + path;
                if (this._parsedCache.has(key)) return Promise.resolve(this._parsedCache.get(key));
                const promise = fetch('/api/omnifile/parsed?sessionId=' + encodeURIComponent(String(sessionId || ''))
                    + '&path=' + encodeURIComponent(path))
                    .then(function (response) {
                        if (!response.ok) throw new Error('加载解析内容失败（HTTP ' + response.status + '）');
                        return response.text();
                    })
                    .then(function (text) {
                        if (text === '') throw new Error('解析内容为空');
                        return text;
                    });
                this._parsedCache.set(key, promise);
                /* 失败不缓存，再次展开可重试。 */
                promise.catch(function () { this._parsedCache.delete(key); }.bind(this));
                return promise;
            }

            /** 工作区文件列表缓存：sessionId -> {at, files, inflight}，避免 @ 每次击键都请求宿主。 */
            fileListing(sessionId, signal) {
                const key = String(sessionId || '');
                if (key === '') return Promise.resolve([]);
                const now = Date.now();
                const cached = this._fileCache.get(key);
                if (cached !== undefined && cached.inflight === undefined && now - cached.at < 15000) {
                    return Promise.resolve(cached.files);
                }
                const req = fetch('/api/omnifile/list?sessionId=' + encodeURIComponent(key), {signal: signal || undefined})
                    .then(function (r) {
                        return r.json();
                    })
                    .then(function (j) {
                        return j && j.ok === true && Array.isArray(j.files) ? j.files : [];
                    })
                    .catch(function () {
                        return cached !== undefined && cached.inflight === undefined ? cached.files : [];
                    });
                const settled = req.then(function (files) {
                    this._fileCache.set(key, {at: Date.now(), files: files, inflight: undefined});
                    return files;
                }.bind(this));
                this._fileCache.set(key, {at: now, files: cached !== undefined ? cached.files : [], inflight: settled});
                return settled;
            }

            /** @ 文件候选：按 query 子串（不区分大小写）过滤工作区文件列表，映射为菜单项。 */
            listWorkspaceFiles(sessionId, query, signal) {
                const q = String(query || '').trim().toLowerCase();
                return this.fileListing(sessionId, signal).then(function (files) {
                    const matched = q === '' ? files : files.filter(function (f) {
                        return String(f.rel || f.name || '').toLowerCase().indexOf(q) >= 0;
                    });
                    return matched.slice(0, CANDIDATE_LIMIT).map(function (f) {
                        return {
                            icon: iconFor(f.kind, f.name),
                            name: f.name,
                            description: String(f.rel || ''),
                            path: f.path,
                            kind: f.kind,
                            size: f.size,
                        };
                    });
                });
            }
        }

        function OmnifileDock(props) {
            const controller = props.controller;
            useStore(controller);
            const occurrences = ((props.input && props.input.occurrences) || []).filter(function (o) {
                return o.source === common.SOURCE;
            });
            if (occurrences.length === 0) return null;
            /* 点发送后仍有文件未解析完：在对话区底部显示实时解析进度（全部完成才随消息一起收起）。 */
            const sending = Array.from(controller.records.values()).filter(function (r) {
                return r.awaitingSend || r._waitNotified;
            });
            const waiting = sending.filter(function (r) {
                return r.status !== 'done' && r.status !== 'error';
            });
            const doneCount = sending.length - waiting.length;
            const currentDetail = waiting.length > 0
                ? (waiting[0].progressDetail || '解析中...')
                : (sending.length > 0 ? '即将完成...' : '');
            const sendWaitRow = waiting.length > 0
                ? react.createElement('div', {className: 'omnifile-sendwait'},
                    react.createElement('span', {className: 'omnifile-sendwait-icon', 'aria-hidden': 'true'}, '⏳'),
                    react.createElement('span', {className: 'omnifile-sendwait-text'},
                        '正在解析文件 ' + doneCount + '/' + sending.length + '：' + currentDetail + '（完成后自动发送）'),
                )
                : null;
            return react.createElement('div', {className: 'omnifile-dock', role: 'status', 'aria-label': '已附加文件'},
                occurrences.map(function (occurrence) {
                    const record = controller.records.get(occurrence.ref);
                    if (record === undefined) return null;
                    const detail = record.awaitingSend ? '等待解析完成后发送...'
                        : record.status === 'processing' ? (record.progressDetail || '解析中...')
                            : record.status === 'done' ? '已就绪'
                                : record.status === 'error' ? (record.error || '失败')
                                    : humanBytes(record.size);
                    /* 移除仅受输入 phase 限制（发送等待期 phase 仍为 plain，仍可移除单个文件以取消发送）。 */
                    const disabled = !!(props.input && props.input.phase !== 'plain');
                    return react.createElement('div', {
                            key: occurrence.occurrenceId,
                            className: 'omnifile-chip',
                            'data-status': record.status,
                            'data-clickable': disabled ? 'false' : 'true',
                            title: (record.error || record.path) + LBL_CHIP_OPEN,
                            onClick: function (ev) {
                                if (disabled) return;
                                ev.stopPropagation();
                                if (typeof props.openPath === 'function' && record.path) props.openPath(record.path);
                            },
                        },
                        react.createElement('span', {className: 'omnifile-chip-icon'}, iconFor(record.kind, record.name)),
                        react.createElement('span', {className: 'omnifile-chip-name'}, record.name),
                        react.createElement('span', {className: 'omnifile-chip-detail'}, detail),
                        react.createElement('button', {
                            type: 'button',
                            className: 'omnifile-chip-remove',
                            'aria-label': '移除 ' + record.name,
                            disabled: disabled,
                            onClick: function (ev) {
                                ev.stopPropagation();
                                props.remove(occurrence);
                            },
                        }, '×'),
                    );
                }),
                sendWaitRow,
            );
        }

        function UploadButton(props) {
            const inputRef = react.useRef(null);
            const controller = props.controller;
            return react.createElement('button', {
                    type: 'button',
                    className: 'omnifile-upload-btn',
                    'aria-label': LBL_ADD_FILES,
                    title: LBL_ADD_FILES,
                    onClick: function () {
                        if (inputRef.current) inputRef.current.click();
                    },
                },
                react.createElement('input', {
                    ref: inputRef,
                    type: 'file',
                    multiple: true,
                    style: {display: 'none'},
                    onChange: function (e) {
                        const files = Array.from(e.target.files || []);
                        if (files.length > 0 && props.sessionId) props.controller.addFiles(props.sessionId, files);
                        e.target.value = '';
                    },
                }),
                react.createElement('svg', {
                        width: 14,
                        height: 14,
                        viewBox: '0 0 16 16',
                        fill: 'none',
                        stroke: 'currentColor',
                        strokeWidth: 1.5,
                        strokeLinecap: 'round',
                        strokeLinejoin: 'round',
                        style: {flex: 'none', display: 'block'}
                    },
                    react.createElement('path', {d: 'M8 10V3'}),
                    react.createElement('path', {d: 'M4.5 6L8 2.5L11.5 6'}),
                    react.createElement('path', {d: 'M3 11.5v1.5h10v-1.5'}),
                ),
            );
        }

        function OmnifileFilesCard(props) {
            const node = props.node;
            /* 兜底去重：同一路径只渲染一张卡片，避免重复 📝/文本卡片 */
            const seen = {};
            const files = ((node && node.data && node.data.files) || []).filter(function (file) {
                if (!file || !file.path) return false;
                if (seen[file.path]) return false;
                seen[file.path] = true;
                return true;
            });
            if (files.length === 0) return null;
            /* 外层只做分组容器（右对齐），每张卡片由 ParseBlock 自持独立块，避免嵌套 parse-block */
            return react.createElement('div', {className: 'omnifile-chat-group'},
                files.map(function (file) {
                    const key = file.path;
                    /* 文档/文本有解析结果 → 可展开的解析卡片；其余（未知格式）仅展示可点击的文件卡片。 */
                    if (file.kind === common.KIND_DOC || file.kind === common.KIND_TEXT) {
                        return react.createElement(ParseBlock, {
                            key: key,
                            file: file,
                            sessionId: props.sessionId,
                            openPath: props.openPath,
                            loadParsed: props.loadParsed,
                        });
                    }
                    return react.createElement('div', {key: key, className: 'omnifile-chat-files'},
                        react.createElement('button', {
                                type: 'button',
                                className: 'omnifile-chat-card',
                                title: (file.sourcePath || file.path) + '（' + LBL_OPEN_SOURCE + '）',
                                onClick: function () {
                                    if (typeof props.openPath === 'function') props.openPath(file.sourcePath || file.path);
                                },
                            },
                            react.createElement('span', {className: 'omnifile-chip-icon'}, iconFor(file.kind, file.name)),
                            react.createElement('span', {className: 'omnifile-chat-name'}, file.name),
                        ),
                    );
                }),
            );
        }

        /** 单个文件的解析卡片：一行（图标+文件名+箭头+📂），位于用户消息上方；
         *  点击行展开/收缩，展开区懒加载显示转换后的 md 全文；📂 用本地默认程序打开源文件。 */
        function ParseBlock(props) {
            const file = props.file;
            const sourcePath = file.sourcePath || file.path;
            const [expanded, setExpanded] = react.useState(false);
            const [body, setBody] = react.useState(null);
            const [error, setError] = react.useState(null);
            const toggle = function (ev) {
                ev.stopPropagation();
                if (expanded) {
                    setExpanded(false);
                    return;
                }
                setExpanded(true);
                if (body !== null || error !== null) return;
                if (typeof props.loadParsed !== 'function') {
                    setError('加载解析内容不可用');
                    return;
                }
                props.loadParsed(props.sessionId, file)
                    .then(function (text) {
                        setBody(text);
                    })
                    .catch(function (e) {
                        setError(messageOf(e));
                    });
            };
            const onKeyDown = function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggle(e);
                }
            };
            /* 展开时才构造内容区（限高+滚动容器）；收缩为 null，不生成多余节点。 */
            const bodyView = expanded
                ? body !== null
                    ? react.createElement('div', {className: 'omnifile-parse-body'},
                        react.createElement('pre', {className: 'omnifile-parse-pre'}, body))
                    : error !== null
                        ? react.createElement('div', {className: 'omnifile-parse-hint omnifile-parse-error'}, '加载解析内容失败：' + error)
                        : react.createElement('div', {className: 'omnifile-parse-hint'}, '正在加载...')
                : null;
            return react.createElement('div', {className: 'omnifile-parse-block'},
                react.createElement('div', {
                    className: 'omnifile-parse-row',
                    role: 'button',
                    tabIndex: 0,
                    'aria-expanded': expanded,
                    'aria-label': (expanded ? LBL_COLLAPSE : LBL_EXPAND) + '：' + file.name,
                    title: expanded ? LBL_COLLAPSE : LBL_EXPAND,
                    onClick: toggle,
                    onKeyDown: onKeyDown,
                },
                    react.createElement('span', {className: 'omnifile-parse-icon'}, iconFor(file.kind, file.name)),
                    react.createElement('span', {className: 'omnifile-parse-title'}, file.name),
                    react.createElement('span', {className: 'omnifile-parse-caret', 'aria-hidden': 'true'}, expanded ? '▾' : '▸'),
                    react.createElement('button', {
                        type: 'button',
                        className: 'omnifile-parse-open',
                        'aria-label': LBL_OPEN_SOURCE + '：' + file.name,
                        title: sourcePath + '（' + LBL_OPEN_SOURCE + '）',
                        onClick: function (ev) {
                            ev.stopPropagation();
                            if (typeof props.openPath === 'function') props.openPath(sourcePath);
                        },
                        /* 阻止按键冒泡：聚焦按钮按 Enter/Space 只触发打开源文件，不触发行展开。 */
                        onKeyDown: function (e) {
                            e.stopPropagation();
                        },
                    }, '📂'),
                ),
                bodyView,
            );
        }

        function setPath(obj, segs, val) {
            let target = obj;
            for (let i = 0; i < segs.length - 1; i++) {
                if (typeof target[segs[i]] !== 'object' || target[segs[i]] === null) target[segs[i]] = {};
                target = target[segs[i]];
            }
            target[segs[segs.length - 1]] = val;
            return obj;
        }

        function OmnifileSettings(props) {
            const scope = props.scope;
            if (scope === undefined) return react.createElement('div', {className: 'omnifile-hint'}, '设置服务不可用。可在 $DSH_HOME/settings.yaml 的 omnifile: 小节配置。');
            const snap = useStore(scope);
            const [draft, setDraft] = react.useState(null);
            const [savedTick, setSavedTick] = react.useState(0);
            const [catalog, setCatalog] = react.useState(null);
            const [catalogError, setCatalogError] = react.useState(null);
            const [jumpHint, setJumpHint] = react.useState(false);
            const base = snap && snap.value ? snap.value : {};
            const value = draft || base;

            const update = function (path, val) {
                const nextDraft = JSON.parse(JSON.stringify(draft || base || {}));
                setPath(nextDraft, path, val);
                setDraft(nextDraft);
                setSavedTick(0);
            };

            /* 拉取「设置-模型」里已配置的支持 image 的提供商/模型，供下拉选择（唯一配置来源）。 */
            const loadCatalog = function () {
                setCatalogError(null);
                fetch('/api/omnifile/models')
                    .then(function (res) {
                        return res.json();
                    })
                    .catch(function () {
                        return {ok: false};
                    })
                    .then(function (json) {
                        if (json && json.ok === true && Array.isArray(json.providers)) {
                            setCatalog(json.providers.map(function (p) {
                                return {
                                    ref: p.ref,
                                    displayName: p.displayName || p.provider || '',
                                    modelId: p.modelId,
                                    modelName: p.modelName || p.modelId,
                                    baseURL: p.baseURL,
                                    apiKeyEnv: p.apiKeyEnv || '',
                                };
                            }));
                        } else {
                            setCatalog([]);
                            setCatalogError((json && json.error) || '读取已配置模型失败');
                        }
                    });
            };
            react.useEffect(function () {
                loadCatalog();
            }, []);

            /* 选中已配置模型 → 只保存一条 providerRef 引用（不保存多份模型配置）。 */
            const pickCatalog = function (ref) {
                update(['providerRef'], ref);
            };

            /* 前往「设置-模型」：优先使用平台暴露的跳转能力（当前 DSH 无公共 API，给出提示降级）。 */
            const goToModels = function () {
                let jumped = false;
                try {
                    if (props.settings && typeof props.settings.openSection === 'function') {
                        props.settings.openSection('models');
                        jumped = true;
                    }
                } catch (e) { /* ignore */ }
                if (jumped) return;
                setJumpHint(true);
            };

            /* 保存：写入的都是顶层标量（settingsScope.set 按单段路径写入），确保真正生效；
             * 顺带清理历史遗留的旧 provider 点分键 / _auto，保证“不保存多份模型配置”。 */
            const commit = function () {
                const target = draft || base;
                const fields = ['providerRef', 'reasoningEffort', 'thinking', 'concurrency', 'temperature', 'topP', 'maxTokens',
                    'describeCacheMax', 'listMaxFiles', 'listMaxDepth', 'maxNameChars', 'maxBatchImages', 'progressPollMs',
                    'maxFileBytes', 'maxDocImages', 'docMaxChars', 'enableVariants', 'timeoutMs'];
                const writes = fields
                    .filter(function (key) {
                        return target[key] !== undefined && target[key] !== null;
                    })
                    .map(function (key) {
                        return [key, target[key]];
                    });
                writes.push(['providerRef', typeof target.providerRef === 'string' ? target.providerRef : '']);
                writes.reduce(function (chain, op) {
                    return chain.then(function () {
                        return scope.set(op[0], op[1]);
                    });
                }, Promise.resolve())
                    .then(function () {
                        return ['provider', 'provider.baseUrl', 'provider.model', 'provider.credential', '_auto']
                            .reduce(function (chain, key) {
                                return chain.then(function () {
                                    return scope.unset(key);
                                }).catch(function () {
                                    /* 旧键可能不存在，忽略 */
                                });
                            }, Promise.resolve());
                    })
                    .then(function () {
                        setSavedTick(function (n) {
                            return n + 1;
                        });
                        scope.load();
                    });
            };

            const activeRef = (value && value.providerRef) || '';
            const activeItem = (catalog || []).find(function (item) {
                return item.ref === activeRef;
            });

            const field = function (label, control, hint) {
                const children = [react.createElement('span', {className: 'omnifile-cfg-label'}, label), control];
                if (hint) children.push(react.createElement('span', {className: 'omnifile-cfg-hint'}, hint));
                return react.createElement('div', {className: 'omnifile-cfg-group'}, children);
            };
            /* 通用数值输入：mb=true 以 MB 展示/落盘；integer=true 只保留正整数。 */
            const numberInput = function (key, fallback, opts) {
                const o = opts || {};
                const div = o.mb ? 1024 * 1024 : 1;
                const current = value[key] === undefined || value[key] === null ? fallback : Number(value[key]);
                return react.createElement('input', {
                    className: 'omnifile-cfg-input',
                    type: 'number',
                    min: o.min,
                    max: o.max,
                    step: o.step,
                    value: current / div,
                    onChange: function (e) {
                        const n = parseFloat(e.target.value);
                        const raw = !Number.isFinite(n) ? fallback
                            : o.mb ? Math.round(n * div)
                                : o.integer ? (n >= 1 ? Math.floor(n) : fallback)
                                    : n;
                        update([key], raw);
                    },
                });
            };
            const numField = function (label, key, fallback, min, step, hint, mb) {
                return field(label, numberInput(key, fallback, {min: min, step: step, mb: mb}),
                    hint + (mb && (value[key] === undefined || value[key] === null) ? '（当前 ' + Math.round(fallback / (1024 * 1024)) + 'MB）' : ''));
            };

            return react.createElement('div', {className: 'omnifile-cfg'},
                /* 头部 */
                react.createElement('div', {className: 'omnifile-cfg-head'}, [
                    react.createElement('h3', {className: 'omnifile-cfg-title'}, '多模态模型配置'),
                    react.createElement('p', {className: 'omnifile-cfg-desc'}, '用于识别用户添加的图片、文档内嵌图片，并为文本-only 主模型生成图像描述。只从「设置-模型」中选择一个已配置的多模态模型，不在此保存多份模型配置。'),
                ]),
                /* 从「设置-模型」选择（唯一配置来源） */
                react.createElement('div', {className: 'omnifile-cfg-group'}, [
                    react.createElement('span', {className: 'omnifile-cfg-label'}, '多模态模型（来自「设置-模型」）'),
                    react.createElement('select', {
                        className: 'omnifile-cfg-select',
                        value: activeRef,
                        disabled: catalog === null,
                        onChange: function (e) {
                            pickCatalog(e.target.value);
                        },
                    }, [
                        react.createElement('option', {key: '', value: '', disabled: true}, catalog === null ? '正在读取已配置模型...' : '—— 请选择多模态模型 ——'),
                        (catalog || []).map(function (item) {
                            return react.createElement('option', {key: item.ref, value: item.ref},
                                String(item.displayName || item.modelId) + ' · ' + item.modelName + ' (' + item.modelId + ')');
                        }),
                    ]),
                    activeItem
                        ? react.createElement('div', {className: 'omnifile-cfg-tag'}, [
                            react.createElement('b', {key: 'b'}, activeItem.displayName || activeItem.modelId),
                            react.createElement('span', {key: 'c'}, activeItem.modelName + '（' + activeItem.modelId + '） · ' + activeItem.baseURL),
                        ])
                        : react.createElement('span', {className: 'omnifile-cfg-hint'}, '选择后将保存为该模型的唯一引用（providerRef），实际地址/密钥都来自「设置-模型」。'),
                    catalogError && react.createElement('div', {className: 'omnifile-cfg-error'}, '⚠ ' + catalogError),
                    catalog !== null && catalog.length === 0 && !catalogError
                        ? react.createElement('div', {className: 'omnifile-cfg-empty'}, [
                            react.createElement('p', {key: '1'}, '「设置-模型」中还没有配置支持 image 输入的多模态模型，请先到「设置-模型」里添加。'),
                            react.createElement('div', {key: '2', className: 'omnifile-cfg-actions'},
                                react.createElement('button', {type: 'button', className: 'omnifile-cfg-btn', onClick: goToModels}, '前往「设置-模型」配置'),
                            ),
                        ])
                        : react.createElement('div', {className: 'omnifile-cfg-actions'}, [
                            react.createElement('button', {type: 'button', className: 'omnifile-cfg-btn omnifile-cfg-btn-ghost', onClick: loadCatalog}, '刷新列表'),
                            react.createElement('button', {type: 'button', className: 'omnifile-cfg-btn-link', onClick: goToModels}, '在「设置-模型」中管理模型 →'),
                        ]),
                    jumpHint && react.createElement('div', {className: 'omnifile-cfg-hint'}, '当前 DSH 版本未开放从插件小节直接跳转的接口；请点击设置面板左侧导航中的「模型」标签页。'),
                ]),
                react.createElement('hr', {className: 'omnifile-cfg-divider'}),
                /* 常规模型参数 */
                react.createElement('div', {className: 'omnifile-cfg-grid'}, [
                    field('采样温度 temperature（0–2）', numberInput('temperature', 0.7, {min: 0, max: 2, step: 0.1}), '数值越低越确定，默认 0.7'),
                    field('top_p（0–1）', numberInput('topP', 1, {min: 0, max: 1, step: 0.05}), 'nucleus 采样，默认 1'),
                    field('最大输出 token', numberInput('maxTokens', 8192, {min: 1, step: 128, integer: true}), '默认 8192'),
                    field('多模态并发数', numberInput('concurrency', 1, {min: 1, max: 16, step: 1, integer: true}), '同时识别多张图的任务数'),
                ]),
                react.createElement('hr', {className: 'omnifile-cfg-divider'}),
                /* 限制参数（可在设置界面配置） */
                react.createElement('div', {className: 'omnifile-cfg-group'}, [
                    react.createElement('span', {className: 'omnifile-cfg-label'}, '上限与限制参数'),
                    react.createElement('div', {className: 'omnifile-cfg-grid'}, [
                        numField('单文件大小（MB）', 'maxFileBytes', 50 * 1024 * 1024, 1, 1, '单个上传文件大小上限', true),
                        numField('单文档最多识别图片数', 'maxDocImages', 8, 1, 1, '文档内嵌图片/扫描页交给多模态识别的数量上限'),
                        numField('文档字符保留上限', 'docMaxChars', 120000, 1000, 1000, '文档转 Markdown 后保留的最大字符数，超出截断'),
                        numField('识图缓存条数', 'describeCacheMax', 300, 16, 1, '同一图片描述结果的 LRU 缓存条数'),
                        numField('@ 文件选择器最大文件数', 'listMaxFiles', 2000, 1, 100, '递归列出工作区文件的上限'),
                        numField('@ 文件选择器最大深度', 'listMaxDepth', 12, 1, 1, '递归遍历最大深度'),
                        numField('文件名最大长度（字符）', 'maxNameChars', 120, 8, 1, '文件名清洗后的最大长度'),
                        numField('单次图片批量上限', 'maxBatchImages', 20, 1, 1, '一次粘贴/拖拽最多放入原生附件的图片数'),
                        numField('进度轮询间隔（毫秒）', 'progressPollMs', 400, 50, 50, '解析进度轮询间隔'),
                    ]),
                    react.createElement('span', {className: 'omnifile-cfg-hint'}, '修改后点击「保存配置」生效；宿主侧（文件大小/文档截断/@ 列表等）需重启后完全生效，客户端侧（图片批量/轮询间隔）由设置保存后即时生效。'),
                ]),
                react.createElement('div', {className: 'omnifile-cfg-group'}, [
                    react.createElement('label', {className: 'omnifile-cfg-check'},
                        react.createElement('input', {
                            type: 'checkbox',
                            checked: value.thinking === true,
                            onChange: function (e) {
                                update(['thinking'], e.target.checked);
                            },
                        }),
                        '启用思考模式（默认禁止；开启时发送 reasoning_effort）',
                    ),
                ]),
                /* 底部操作 */
                react.createElement('div', {className: 'omnifile-cfg-actions'}, [
                    react.createElement('button', {type: 'button', className: 'omnifile-cfg-btn', onClick: commit}, '保存配置'),
                    savedTick > 0 && react.createElement('span', {key: 'saved', className: 'omnifile-cfg-saved'}, '✓ 已保存'),
                ]),
            );
        }
        function omnifileChatDefinition() {
            return {
                kind: 'omnifile-files',
                target: 'chat',
                match: function (event) {
                    if (event.type !== 'user/message') return null;
                    let append = true;
                    try {
                        const runtime = require('@deepseek-ai/dsh-client-runtime');
                        if (runtime && typeof runtime.isAppendSurfaceEvent === 'function') append = runtime.isAppendSurfaceEvent(event);
                    } catch (e) { /* ignore */
                    }
                    if (!append) return null;
                    if (!hasParseMarker(event.data.content)) return null;
                    return {id: String(event.data.id), role: 'start'};
                },
                start: function (context, match, reader) {
                    const messageId = String(match.event.data && match.event.data.id || '');
                    if (messageId !== '' && startedCards.has(messageId)) return undefined;
                    const files = extractFiles(match.event.data.content);
                    if (files.length === 0) return undefined;
                    if (messageId !== '') startedCards.add(messageId);
                    return {
                        kind: 'omnifile-files',
                        files: files,
                        messageId: match.event.data.id,
                        seq: match.event.seq,
                        time: match.event.time
                    };
                },
                update: function (context) {
                    return context.state;
                },
                buildViewNode: function (context) {
                    if (context.state === undefined) return null;
                    /* 锚点取(用户消息 seq - 0.5)：折叠卡片稳定排在用户消息上方，不再混入 AI 回复。 */
                    return chatNode(context, 'omnifile-files', context.state.seq + FILES_ANCHOR_OFFSET, context.state);
                },
            };
        }

        function installPasteAndDrag(ctx, controller) {
            const hasFiles = function (e) {
                return e.dataTransfer && Array.from(e.dataTransfer.types || []).indexOf('Files') >= 0;
            };
            let overlay = null;
            let overlayDepth = 0;
            const showOverlay = function () {
                overlayDepth += 1;
                if (overlay === null && typeof document !== 'undefined') {
                    overlay = document.createElement('div');
                    overlay.className = 'omnifile-overlay';
                    const box = document.createElement('div');
                    box.className = 'omnifile-overlay-box';
                    box.textContent = '松开鼠标把文件添加进对话';
                    overlay.appendChild(box);
                    (document.body || document.documentElement).appendChild(overlay);
                }
            };
            const hideOverlay = function () {
                overlayDepth = Math.max(0, overlayDepth - 1);
                if (overlayDepth === 0 && overlay !== null) {
                    overlay.remove();
                    overlay = null;
                }
            };
            const onDragEnter = function (e) {
                if (!hasFiles(e)) return;
                e.preventDefault();
                e.stopPropagation();
                showOverlay();
            };
            const onDragOver = function (e) {
                if (!hasFiles(e)) return;
                e.preventDefault();
                e.stopPropagation();
            };
            const onDragLeave = function (e) {
                if (!hasFiles(e)) return;
                hideOverlay();
            };
            const onDrop = function (e) {
                if (!hasFiles(e)) return;
                e.preventDefault();
                e.stopPropagation();
                hideOverlay();
                const files = collectFiles(e.dataTransfer);
                if (files.length === 0) return;
                const sessionId = controller.currentSessionId();
                if (sessionId === undefined) return;
                controller.addFiles(sessionId, files);
            };
            const onPaste = function (e) {
                const files = collectFiles(e.clipboardData);
                if (files.length === 0) return;
                const target = e.target;
                if (!(target && target.tagName === 'TEXTAREA') || !(target.closest && target.closest('[data-composer-card]'))) return;
                e.preventDefault();
                e.stopPropagation();
                if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
                const sessionId = controller.currentSessionId();
                if (sessionId === undefined) return;
                controller.addFiles(sessionId, files);
            };
            ctx.effect(function () {
                document.addEventListener('dragenter', onDragEnter, true);
                document.addEventListener('dragover', onDragOver, true);
                document.addEventListener('dragleave', onDragLeave, true);
                document.addEventListener('drop', onDrop, true);
                document.addEventListener('paste', onPaste, true);
                return function () {
                    document.removeEventListener('dragenter', onDragEnter, true);
                    document.removeEventListener('dragover', onDragOver, true);
                    document.removeEventListener('dragleave', onDragLeave, true);
                    document.removeEventListener('drop', onDrop, true);
                    document.removeEventListener('paste', onPaste, true);
                    if (overlay !== null) {
                        overlay.remove();
                        overlay = null;
                    }
                };
            }, 'dsh-omnifile: paste & drop capture');
        }

        /** RegExp 转义（用于把 common 常量安全拼进正则；避免 $& / 隐患，逐字符处理）。 */
        function escapeRegExp(text) {
            const special = '\\^$.*+?()[]{}|';
            const s = String(text || '');
            let out = '';
            for (let i = 0; i < s.length; i++) {
                const c = s.charAt(i);
                if (special.indexOf(c) >= 0) out += '\\';
                out += c;
            }
            return out;
        }

        /* 用户消息气泡里不出现任何文件解析信息（marker 仍保留在 content 中，
         * 供模型 read/read_image 工具识别保存路径）。DSH 的用户气泡把全部 text 块拼成
         * 单个纯文本 div，没有按行过滤的渲染缝；这里用 MutationObserver 把 marker
         * （「解析后保存路径：…（状态…）」整段）包成 display:none 的 span，只影响本
         * 插件 marker，不影响其它消息/插件；历史与新增消息都由 observer 统一覆盖。 */
        function installMarkerHiding(ctx) {
            if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
            /* 守卫：某个节点及其祖先是本插件已隐藏的 span → 不再处理，
             * 避免 hideMarkerInText 的 replaceChild 触发 observer → 再次包裹的死循环。 */
            const insideHidden = function (node) {
                let cur = node;
                while (cur !== null && cur !== document) {
                    if (cur.nodeType === 1 && cur.getAttribute && cur.getAttribute('data-omnifile-hidden')) return true;
                    cur = cur.parentNode;
                }
                return false;
            };
            const scanNode = function (root) {
                if (root === null || root === undefined || root.nodeType !== 1) return;
                if (insideHidden(root)) return;
                if (root.textContent === undefined || root.textContent.indexOf(common.MARKER_PREFIX) < 0) return;
                const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
                const hits = [];
                while (true) {
                    const node = walker.nextNode();
                    if (node === null) break;
                    if (node.nodeValue && node.nodeValue.indexOf(common.MARKER_PREFIX) >= 0) hits.push(node);
                }
                for (const textNode of hits) hideMarkerInText(textNode);
            };
            const hideMarkerInText = function (textNode) {
                if (textNode.parentNode === null || insideHidden(textNode)) return;
                const text = String(textNode.nodeValue || '');
                const statusGroup = '(?:' + escapeRegExp(common.MARKER_STATUS_OK)
                    + '|' + escapeRegExp(common.MARKER_STATUS_UNREADABLE)
                    + '|' + escapeRegExp(common.MARKER_STATUS_FAILED)
                    + '|' + escapeRegExp(common.MARKER_UNKNOWN) + ')';
                const markerRe = new RegExp('(\\r?\\n)?' + escapeRegExp(common.MARKER_PREFIX)
                    + '(.+?)（(' + statusGroup + '[^）]*)）(\\r?\\n)?', 'g');
                const ranges = [];
                let m;
                while ((m = markerRe.exec(text)) !== null) {
                    ranges.push({start: m.index, end: m.index + m[0].length});
                }
                if (ranges.length === 0) return;
                const parent = textNode.parentNode;
                if (parent === null) return;
                const fragment = document.createDocumentFragment();
                let cursor = 0;
                for (const range of ranges) {
                    if (range.start > cursor) fragment.appendChild(document.createTextNode(text.slice(cursor, range.start)));
                    const hidden = document.createElement('span');
                    hidden.className = 'omnifile-hidden-marker';
                    hidden.setAttribute('data-omnifile-hidden', '1');
                    hidden.textContent = text.slice(range.start, range.end);
                    fragment.appendChild(hidden);
                    cursor = range.end;
                }
                if (cursor < text.length) fragment.appendChild(document.createTextNode(text.slice(cursor)));
                parent.replaceChild(fragment, textNode);
            };
            const observer = new MutationObserver(function (mutations) {
                for (const mutation of mutations) {
                    for (const added of mutation.addedNodes) {
                        if (added.nodeType === 3) {
                            if (added.nodeValue && added.nodeValue.indexOf(common.MARKER_PREFIX) >= 0) hideMarkerInText(added);
                        } else if (added.nodeType === 1) {
                            scanNode(added);
                        }
                    }
                }
            });
            if (document.body !== null) scanNode(document.body);
            observer.observe(document.documentElement, {subtree: true, childList: true});
            ctx.effect(function () {
                return function () {
                    observer.disconnect();
                };
            });
        }

        function registerCodec(ctx, controller) {
            /* 在输入框触发器（@ 提及）注册文件引用源：候选/挑选/序列化都由 controller 负责。
             * 作用域 dispose 时自动注销（HMR 重载时旧源被清理，不会重复注册）。 */
            ctx.inject(['inputTriggers'], function (scope) {
                const triggers = scope && scope.get ? scope.get('inputTriggers') : undefined;
                if (triggers === undefined || typeof triggers.registerSource !== 'function') return;
                scope.effect(function () {
                    return triggers.registerSource(controller.source());
                }, 'dsh-omnifile: file reference source');
            });
        }

        function apply(ctx) {
            ctx.effect(installStyles, 'dsh-omnifile: styles');
            /* 拉取 common.js 权威常量（串行化 await；失败保留启动镜像，功能不中断）。 */
            ensureCommon();
            const controller = new OmnifileController(ctx);
            installPasteAndDrag(ctx, controller);
            registerCodec(ctx, controller);
            /* 隐藏用户消息气泡里的 marker（保留在 content 供模型工具识别）。 */
            installMarkerHiding(ctx);

            ctx.slots.inject('conversation.input.dock', function () {
                return ctx.slots.register({
                    name: 'conversation.input.dock',
                    id: 'omnifile',
                    order: 5,
                    inject: function (sessionId) {
                        return {
                            controller: controller,
                            remove: function (occurrence) {
                                controller.remove(String(sessionId), occurrence);
                            },
                            /* 点击 dock 缩略图/文件卡片 → 用系统默认程序预览 */
                            openPath: function (path) {
                                controller.openPath(String(sessionId), path);
                            },
                        };
                    },
                }, OmnifileDock);
            });

            ctx.slots.inject('conversation.input.left', function () {
                return ctx.slots.register({
                    name: 'conversation.input.left',
                    id: 'omnifile',
                    order: 10,
                    inject: function (sessionId) {
                        return {controller: controller, sessionId: String(sessionId)};
                    },
                }, UploadButton);
            });

            ctx.slots.inject('conversation.chat.node', function () {
                return ctx.slots.register({
                    name: 'conversation.chat.node',
                    key: 'omnifile-files',
                    inject: function (sessionId) {
                        return {
                            sessionId: String(sessionId),
                            openPath: function (path) {
                                controller.openPath(String(sessionId), path);
                            },
                            loadParsed: function (sid, file) {
                                return controller.loadParsed(String(sid || sessionId), file);
                            },
                        };
                    },
                }, OmnifileFilesCard);
            });

            ctx.inject(['conversationEvents'], function (scope) {
                const events = scope && scope.get ? scope.get('conversationEvents') : undefined;
                if (events && typeof events.register === 'function') {
                    events.register(omnifileChatDefinition());
                }
            });

            ctx.slots.inject('settings.section', function () {
                return ctx.slots.register({
                    name: 'settings.section',
                    id: 'omnifile',
                    order: 30,
                    label: function () {
                        return 'DshOmniFile';
                    },
                    inject: function () {
                        let scope;
                        try {
                            const binder = ctx.get('settingsScope');
                            if (binder && typeof binder.bind === 'function') scope = binder.bind({namespace: 'omnifile'});
                        } catch (e) {
                            scope = undefined;
                        }
                        return {scope: scope};
                    },
                }, OmnifileSettings);
            });
        }

        exports.inject = ['slots', 'sessions', 'conversation', 'conversationEvents', 'remote'];
        exports.apply = apply;
        return module.exports;
    }
});
