window.__ModuleLoader__.load({
    id: 'dsh-omnifile',
    factory: (require) => {
        var module = {exports: {}};
        var exports = module.exports;
        Object.defineProperty(exports, Symbol.toStringTag, {value: 'Module'});
        let react = require('react');

        const SOURCE = '文件';
        const MAX_FILE_BYTES = 30 * 1024 * 1024;
        const MAX_BATCH_IMAGES = 20;
        /* 折叠卡片相对用户消息的锚点偏移：略小于用户消息 seq，保证卡片稳定排在用户消息上方（而非混入 AI 回复）。 */
        const FILES_ANCHOR_OFFSET = -0.5;
        /* 处理进度轮询间隔（毫秒）。 */
        const PROGRESS_POLL_MS = 400;

        const CSS = [
            '.omnifile-dock{box-sizing:border-box;width:100%;max-width:var(--dsh-composer-card-max-width,960px);margin:0 auto;display:flex;flex-wrap:wrap;gap:6px;padding:2px 4px;}',
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
            '.omnifile-chat-files{display:flex;flex-wrap:wrap;gap:6px;width:fit-content;margin-left:auto;align-self:flex-end;}',
            '.omnifile-chat-card{box-sizing:border-box;display:inline-flex;align-items:center;gap:6px;max-width:300px;height:34px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12));border-radius:10px;background:var(--dsw-specific-tip,rgba(128,128,128,.08));cursor:pointer;color:var(--dsw-alias-label-primary,#222);font-size:12px;text-align:left;}',
            '.omnifile-chat-card:hover{background:rgba(0,0,0,.08);}',
            '.omnifile-chat-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:auto;}',
            '.omnifile-upload-btn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;flex:none;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#666);cursor:pointer;padding:0;}',
            '.omnifile-upload-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));}',
            '.omnifile-upload-btn:disabled{opacity:.5;cursor:default;}',
            '.omnifile-overlay{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;pointer-events:none;background:rgba(20,40,120,.08);backdrop-filter:blur(1px);font-size:15px;color:var(--dsw-alias-label-primary,#222);}',
            '.omnifile-overlay-box{background:var(--dsw-alias-bg-elevation,#fff);border:1px dashed var(--dsw-alias-brand-primary,#4b6bfb);border-radius:14px;padding:18px 28px;box-shadow:0 8px 30px rgba(0,0,0,.15);}',
            '.omnifile-hint{color:var(--dsw-alias-label-tertiary,#888);font-size:12px;line-height:1.6;}',
            /* 聊天内「已解析文件内容」折叠卡片（类 Think 折叠） */
            '.omnifile-parse-block{display:flex;flex-direction:column;gap:2px;max-width:640px;width:fit-content;margin-left:auto;align-self:flex-end;}',
            /* 多条文件消息分组容器：右对齐，每条解析块各自独立（避免嵌套 parse-block） */
            '.omnifile-chat-group{box-sizing:border-box;display:flex;flex-direction:column;align-items:flex-end;gap:6px;max-width:100%;width:fit-content;margin-left:auto;align-self:flex-end;}',
            '.omnifile-parse-row{box-sizing:border-box;display:flex;align-items:center;gap:8px;height:30px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12));border-radius:10px;background:var(--dsw-specific-tip,rgba(128,128,128,.08));cursor:pointer;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1;user-select:none;}',
            '.omnifile-parse-row:hover{background:rgba(0,0,0,.08);}',
            '.omnifile-parse-row[data-open="true"]{border-radius:10px 10px 0 0;}',
            '.omnifile-parse-icon{flex:none;font-size:14px;line-height:1;}',
            '.omnifile-parse-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:auto;color:var(--dsw-alias-label-primary);}',
            '.omnifile-parse-summary{flex:none;color:var(--dsw-alias-label-tertiary,#888);font-size:11px;}',
            '.omnifile-parse-open{flex:none;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#666);cursor:pointer;font-size:13px;line-height:1;}',
            '.omnifile-parse-open:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));color:var(--dsw-alias-label-primary,#222);}',
            '.omnifile-parse-chevron{flex:none;display:inline-flex;align-items:center;color:var(--dsw-alias-label-secondary);transition:transform .15s ease;}',
            '.omnifile-parse-row[data-open="true"] .omnifile-parse-chevron{transform:rotate(90deg);}',
            '.omnifile-parse-body{box-sizing:border-box;max-height:420px;overflow:auto;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12));border-top:none;border-radius:0 0 10px 10px;background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base,#fff));padding:10px 12px;}',
            '.omnifile-parse-body pre{margin:0;white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;line-height:1.7;color:var(--dsw-alias-label-primary);}',
            '.omnifile-parse-loading{color:var(--dsw-alias-label-tertiary,#888);font-size:12px;padding:8px 0;}',
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

        /* 聊天卡片定位标记（纯可读文本，无 token）。格式统一为：
         * 【(文档|文本|文件)「<文件名>」·保存路径：<绝对路径>】<状态词>...
         * 卡片据此提取文件名/类别/保存路径；「保存路径」同时供展开时加载解析结果与本地打开。
         * 正则要求 】 后紧跟本插件的状态词，避免把文件内容里形似的字符串误抽成卡片。 */
        const PARSE_RE = /【(文档|文本|文件)「(.+?)」·保存路径：([^\n]+)】(已解析|无法按文本读取|解析失败)(?:（源文件：([^\n（）]+)）)?/g;
        const PARSE_MARKER_RE = /【(文档|文本|文件)「.+?」·保存路径：[^\n]+】(已解析|无法按文本读取|解析失败)(?:（源文件：[^\n（）]+）)?/;

        /* 已生成卡片的消息防重：同一消息只建一次卡片节点（防御运行时对同一逻辑消息产生不同 id 的重复事件）。 */
        const startedCards = new Set();

        function iconFor(kind, name) {
            const ext = String(name || '').split('.').pop().toLowerCase();
            if (kind === 'image') return '🖼';
            if (kind === 'doc') {
                if (ext === 'pdf') return '📕';
                if (['doc', 'docx', 'docm', 'rtf', 'odt'].indexOf(ext) >= 0) return '📘';
                if (['xls', 'xlsx', 'xlsm', 'xlsb', 'ods', 'csv'].indexOf(ext) >= 0) return '📗';
                if (['ppt', 'pptx', 'pptm', 'pps', 'ppsx', 'pot', 'ppsm', 'odp'].indexOf(ext) >= 0) return '📙';
                if (ext === 'epub') return '📚';
                return '📄';
            }
            if (kind === 'media') return '🎞';
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

        /** 从消息正文提取「已解析文件」清单（名称/类别/保存路径），按保存路径去重（同一文件即使多次附加也仅一张卡片）。 */
        function extractFiles(content) {
            const files = [];
            let m;
            PARSE_RE.lastIndex = 0;
            const text = textOf(content);
            const kindByLabel = {'文档': 'doc', '文本': 'text', '文件': 'other'};
            const seenPaths = {};
            while ((m = PARSE_RE.exec(text)) !== null) {
                const path = String(m[3] || '').trim();
                if (path === '' || seenPaths[path]) continue;
                seenPaths[path] = true;
                const source = (m[5] && String(m[5]).trim()) || undefined;
                files.push({name: String(m[2] || ''), kind: kindByLabel[m[1]] || 'other', path, source});
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
                if (file.size > MAX_FILE_BYTES) return {ok: false, error: '「' + file.name + '」超过 30MB，已跳过'};
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
                    const attachments = conversation.createDraftImages(files.slice(0, MAX_BATCH_IMAGES));
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
                    source: SOURCE,
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
                const timer = setInterval(poll, PROGRESS_POLL_MS);
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

            /** 把 ref 的解析结果序列化为可读消息标记；发送时由运行时 await，等待该文件解析完成。 */
            async serialize(ref, signal) {
                const record = this.records.get(ref);
                if (record === undefined) throw new Error('文件已从草稿移除');
                if (record.path === undefined || record.path === '') throw new Error('文件尚未保存完成');
                let json = null;
                try {
                    json = await this.startProcess(ref, signal);
                } catch (error) {
                    json = null;
                }
                /* 保存路径优先用解析出的 md 绝对路径（{源文件名}.md，便于模型 read）；源文件路径追加为后缀供「打开」。 */
                const p = (json !== null && typeof json.parsedPath === 'string' && json.parsedPath !== '') ? json.parsedPath : record.path;
                const srcTail = (p !== record.path) ? ('（源文件：' + record.path + '）') : '';
                if (json !== null && json.ok === true) {
                    if (json.kind === 'image') {
                        return '【图片「' + record.name + '」·保存路径：' + p + '】\n' + (json.text || '') + '\n';
                    }
                    if (json.kind === 'doc' || json.kind === 'text') {
                        const label = json.kind === 'doc' ? '文档' : '文本';
                        const chars = String(json.markdown || '').length;
                        /* 只放可读引用与可用路径、不重复填充对话栏：完整内容在聊天卡片里（点击展开由 /parsed 懒加载）。 */
                        return '【' + label + '「' + record.name + '」·保存路径：' + p + '】已解析' + srcTail + ' · ' + chars + ' 字符（完整内容见上方文件卡片，可点击展开）\n';
                    }
                    return '【文件「' + record.name + '」·保存路径：' + p + '】无法按文本读取' + (json.note ? '：' + json.note : '') + '\n';
                }
                return '【文件「' + record.name + '」·保存路径：' + record.path + '】解析失败：' + (record.error || '') + '\n';
            }

            remove(sessionId, occurrence) {
                const input = this.inputFor(sessionId);
                if (input === undefined) return;
                if (input.state.getSnapshot().phase !== 'plain') return;
                const snapshot = input.state.getSnapshot();
                const current = snapshot.occurrences.find(function (o) {
                    return o.source === SOURCE && o.occurrenceId === occurrence.occurrenceId && o.ref === occurrence.ref;
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
                    name: SOURCE,
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
                                source: SOURCE,
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

            async loadParsed(sessionId, file) {
                const path = file && file.path;
                if (typeof path !== 'string' || path === '') throw new Error('没有可加载的解析文件');
                /* 保存路径即 <uploads>/<源文件名>.md，宿主按该路径直接读取解析结果全文。 */
                const response = await fetch('/api/omnifile/parsed?sessionId=' + encodeURIComponent(String(sessionId || ''))
                    + '&path=' + encodeURIComponent(path));
                if (!response.ok) throw new Error('加载解析内容失败（HTTP ' + response.status + '）');
                const text = await response.text();
                if (text === '') throw new Error('解析内容为空');
                return text;
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
                    return matched.slice(0, 200).map(function (f) {
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
            react.useSyncExternalStore(
                function (fn) {
                    return controller.subscribe(fn);
                },
                function () {
                    return controller.snapshot();
                },
                function () {
                    return controller.snapshot();
                },
            );
            const occurrences = ((props.input && props.input.occurrences) || []).filter(function (o) {
                return o.source === SOURCE;
            });
            if (occurrences.length === 0) return null;
            return react.createElement('div', {className: 'omnifile-dock', role: 'status', 'aria-label': '已附加文件'},
                occurrences.map(function (occurrence) {
                    const record = controller.records.get(occurrence.ref);
                    if (record === undefined) return null;
                    const detail = record.status === 'processing' ? (record.progressDetail || '解析中...')
                        : record.status === 'done' ? '已就绪'
                            : record.status === 'error' ? (record.error || '失败')
                                : humanBytes(record.size);
                    const disabled = (props.input && props.input.phase !== 'plain') || record.status === 'processing';
                    return react.createElement('div', {
                            key: occurrence.occurrenceId,
                            className: 'omnifile-chip',
                            'data-status': record.status,
                            'data-clickable': disabled ? 'false' : 'true',
                            title: (record.error || record.path) + '（点击预览）',
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
            );
        }

        function UploadButton(props) {
            const inputRef = react.useRef(null);
            const controller = props.controller;
            return react.createElement('button', {
                    type: 'button',
                    className: 'omnifile-upload-btn',
                    'aria-label': '添加本地文件（可多选，支持拖拽/粘贴）',
                    title: '添加本地文件（可多选，支持拖拽/粘贴）',
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
                    /* 文档/文本一定有解析结果 → 折叠卡片；其余（未知格式）仅展示可点击的文件卡片。 */
                    if (file.kind === 'doc' || file.kind === 'text') {
                        return react.createElement(ParseBlock, {
                            key: key,
                            file: file,
                            sessionId: props.sessionId,
                            loadParsed: props.loadParsed,
                            openPath: props.openPath,
                        });
                    }
                    return react.createElement('div', {key: key, className: 'omnifile-chat-files'},
                        react.createElement('button', {
                                type: 'button',
                                className: 'omnifile-chat-card',
                                title: file.path + '（点击用本地默认程序打开）',
                                onClick: function () {
                                    if (typeof props.openPath === 'function') props.openPath(file.source || file.path);
                                },
                            },
                            react.createElement('span', {className: 'omnifile-chip-icon'}, iconFor(file.kind, file.name)),
                            react.createElement('span', {className: 'omnifile-chat-name'}, file.name),
                        ),
                    );
                }),
            );
        }

        /** 单个文件的「已解析内容」折叠块：默认折叠，展开时懒加载全文（类 Think）。 */
        function ParseBlock(props) {
            const file = props.file;
            const [open, setOpen] = react.useState(false);
            const [content, setContent] = react.useState(null);
            const [loading, setLoading] = react.useState(false);
            const [error, setError] = react.useState(null);
            const toggle = function () {
                const next = !open;
                setOpen(next);
                if (next && content === null && error === null && !loading) {
                    setLoading(true);
                    Promise.resolve().then(function () {
                        return props.loadParsed(props.sessionId, file);
                    }).then(function (text) {
                        setContent(text);
                        setLoading(false);
                    }).catch(function (err) {
                        setError(messageOf(err));
                        setLoading(false);
                    });
                }
            };
            const summary = file.kind === 'text' ? '已读取'
                : file.kind === 'doc' ? '已解析'
                    : '';
            const title = (file.kind === 'text' ? '文本「' : '文档「') + file.name + '」';
            return react.createElement('div', {className: 'omnifile-parse-block'},
                react.createElement('div', {
                        className: 'omnifile-parse-row',
                        role: 'button',
                        tabIndex: 0,
                        'data-open': open ? 'true' : undefined,
                        title: file.path + '（点击展开/折叠解析内容）',
                        onClick: toggle,
                        onKeyDown: function (e) {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                toggle();
                            }
                        },
                    },
                    react.createElement('span', {className: 'omnifile-parse-icon'}, iconFor(file.kind, file.name)),
                    react.createElement('span', {className: 'omnifile-parse-title'}, title),
                    react.createElement('span', {className: 'omnifile-parse-summary'}, summary),
                    react.createElement('button', {
                        type: 'button',
                        className: 'omnifile-parse-open',
                        'aria-label': '用本地默认程序打开 ' + file.name,
                        title: '用本地默认程序打开',
                        onClick: function (ev) {
                            ev.stopPropagation();
                            if (typeof props.openPath === 'function') props.openPath(file.source || file.path);
                        },
                    }, '📂'),
                    react.createElement('span', {className: 'omnifile-parse-chevron'}, '›'),
                ),
                open
                    ? react.createElement('div', {className: 'omnifile-parse-body'},
                        error !== null
                            ? react.createElement('div', {className: 'omnifile-parse-loading'}, '加载失败：' + error)
                            : loading
                                ? react.createElement('div', {className: 'omnifile-parse-loading'}, '加载中...')
                                : react.createElement('pre', null, content === null ? '' : content),
                    )
                    : null,
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
            const snap = react.useSyncExternalStore(
                function (fn) {
                    return scope.subscribe(fn);
                },
                function () {
                    return scope.getSnapshot();
                },
                function () {
                    return scope.getSnapshot();
                },
            );
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
                const fields = ['providerRef', 'reasoningEffort', 'thinking', 'concurrency', 'temperature', 'topP', 'maxTokens'];
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
                    field('采样温度 temperature（0–2）', react.createElement('input', {
                        className: 'omnifile-cfg-input',
                        type: 'number',
                        min: 0,
                        max: 2,
                        step: 0.1,
                        value: value.temperature === undefined || value.temperature === null ? 0.7 : Number(value.temperature),
                        onChange: function (e) {
                            const n = parseFloat(e.target.value);
                            update(['temperature'], Number.isFinite(n) ? n : 0.7);
                        },
                    }), '数值越低越确定，默认 0.7'),
                    field('top_p（0–1）', react.createElement('input', {
                        className: 'omnifile-cfg-input',
                        type: 'number',
                        min: 0,
                        max: 1,
                        step: 0.05,
                        value: value.topP === undefined || value.topP === null ? 1 : Number(value.topP),
                        onChange: function (e) {
                            const n = parseFloat(e.target.value);
                            update(['topP'], Number.isFinite(n) ? n : 1);
                        },
                    }), 'nucleus 采样，默认 1'),
                    field('最大输出 token', react.createElement('input', {
                        className: 'omnifile-cfg-input',
                        type: 'number',
                        min: 1,
                        step: 128,
                        value: value.maxTokens === undefined || value.maxTokens === null ? 8192 : Number(value.maxTokens),
                        onChange: function (e) {
                            const n = parseInt(e.target.value, 10);
                            update(['maxTokens'], Number.isFinite(n) && n >= 1 ? n : 8192);
                        },
                    }), '默认 8192'),
                    field('多模态并发数', react.createElement('input', {
                        className: 'omnifile-cfg-input',
                        type: 'number',
                        min: 1,
                        max: 16,
                        value: value.concurrency === undefined || value.concurrency === null ? 1 : Number(value.concurrency),
                        onChange: function (e) {
                            const n = parseInt(e.target.value, 10);
                            update(['concurrency'], Number.isFinite(n) && n >= 1 ? n : 1);
                        },
                    }), '同时识别多张图的任务数'),
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
            const controller = new OmnifileController(ctx);
            installPasteAndDrag(ctx, controller);
            registerCodec(ctx, controller);

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
