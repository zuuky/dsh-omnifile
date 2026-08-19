window.__ModuleLoader__.load({
    id: 'dsh-omnifile',
    factory: (require) => {
        var module = {exports: {}};
        var exports = module.exports;
        Object.defineProperty(exports, Symbol.toStringTag, {value: 'Module'});
        let react = require('react');

        const SOURCE = 'omnifile-file';
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
            '.omnifile-chat-files{display:flex;flex-wrap:wrap;gap:6px;}',
            '.omnifile-chat-card{box-sizing:border-box;display:inline-flex;align-items:center;gap:6px;max-width:300px;height:34px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12));border-radius:10px;background:var(--dsw-specific-tip,rgba(128,128,128,.08));cursor:pointer;color:var(--dsw-alias-label-primary,#222);font-size:12px;text-align:left;}',
            '.omnifile-chat-card:hover{background:rgba(0,0,0,.08);}',
            '.omnifile-chat-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:auto;}',
            '.omnifile-upload-btn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;flex:none;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#666);cursor:pointer;padding:0;}',
            '.omnifile-upload-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));}',
            '.omnifile-upload-btn:disabled{opacity:.5;cursor:default;}',
            '.omnifile-overlay{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;pointer-events:none;background:rgba(20,40,120,.08);backdrop-filter:blur(1px);font-size:15px;color:var(--dsw-alias-label-primary,#222);}',
            '.omnifile-overlay-box{background:var(--dsw-alias-bg-elevation,#fff);border:1px dashed var(--dsw-alias-brand-primary,#4b6bfb);border-radius:14px;padding:18px 28px;box-shadow:0 8px 30px rgba(0,0,0,.15);}',
            '.omnifile-section{display:flex;flex-direction:column;gap:12px;max-width:560px;}',
            '.omnifile-field{display:flex;flex-direction:column;gap:4px;font-size:13px;}',
            '.omnifile-field label{color:var(--dsw-alias-label-secondary,#666);}',
            '.omnifile-field input[type=text],.omnifile-field input[type=number]{box-sizing:border-box;width:100%;padding:6px 8px;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.15));border-radius:8px;background:var(--dsw-specific-input-major,var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base,#fff)));color:var(--dsw-alias-label-primary,#222);font-size:13px;color-scheme:light dark;}',
            '.omnifile-field input[type=text]::placeholder,.omnifile-field input[type=number]::placeholder{color:var(--dsw-alias-label-dimmed,#888);}',
            '.omnifile-field input[type=number]{max-width:120px;}',
            '.omnifile-check input[type=checkbox]{width:14px;height:14px;margin:0;accent-color:var(--dsw-alias-button-primary-fill,#4b6bfb);cursor:pointer;}',
            '.omnifile-check{display:flex;align-items:center;gap:6px;font-size:13px;}',
            '.omnifile-hint{color:var(--dsw-alias-label-tertiary,#888);font-size:12px;line-height:1.6;}',
            /* 保存按钮使用 DSH 官方主按钮配色对（background=button-primary-fill，
             * 前景=label-primary-foreground），明暗主题下都是互补色、与 theme 一致。
             * color-scheme 让按钮跟随所在 surface 的明暗，避免解析到错位的系统默认。 */
            '.omnifile-save{box-sizing:border-box;width:fit-content;height:34px;padding:0 16px;border:none;border-radius:18px;background:var(--dsw-alias-button-primary-fill,#4b6bfb);color:var(--dsw-alias-label-primary-foreground,#fff);cursor:pointer;font-size:14px;line-height:22px;font:inherit;color-scheme:light dark;}',
            '.omnifile-save:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-button-primary-fill,#4b6bfb));}',
            '.omnifile-save:disabled{opacity:.5;cursor:default;}',
            /* 聊天内「已解析文件内容」折叠卡片（类 Think 折叠） */
            '.omnifile-parse-block{display:flex;flex-direction:column;gap:2px;max-width:640px;}',
            '.omnifile-parse-row{box-sizing:border-box;display:flex;align-items:center;gap:8px;height:30px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12));border-radius:10px;background:var(--dsw-specific-tip,rgba(128,128,128,.08));cursor:pointer;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1;user-select:none;}',
            '.omnifile-parse-row:hover{background:rgba(0,0,0,.08);}',
            '.omnifile-parse-row[data-open="true"]{border-radius:10px 10px 0 0;}',
            '.omnifile-parse-icon{flex:none;font-size:14px;line-height:1;}',
            '.omnifile-parse-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:auto;color:var(--dsw-alias-label-primary);}',
            '.omnifile-parse-summary{flex:none;color:var(--dsw-alias-label-tertiary,#888);font-size:11px;}',
            '.omnifile-parse-chevron{flex:none;display:inline-flex;align-items:center;color:var(--dsw-alias-label-secondary);transition:transform .15s ease;}',
            '.omnifile-parse-row[data-open="true"] .omnifile-parse-chevron{transform:rotate(90deg);}',
            '.omnifile-parse-body{box-sizing:border-box;max-height:420px;overflow:auto;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12));border-top:none;border-radius:0 0 10px 10px;background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base,#fff));padding:10px 12px;}',
            '.omnifile-parse-body pre{margin:0;white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;line-height:1.7;color:var(--dsw-alias-label-primary);}',
            '.omnifile-parse-loading{color:var(--dsw-alias-label-tertiary,#888);font-size:12px;padding:8px 0;}',
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

        /** 从解析文本中提取一行紧凑摘要（去掉标题符号、空白，截断到 ~120 字符）。 */
        function summaryOf(markdown) {
            const text = String(markdown || '')
                .replace(/^#+\s*/gm, '')
                .replace(/[*_`~>|]/g, '')
                .replace(/\s+/g, ' ')
                .trim();
            if (text === '') return '';
            return text.length > 120 ? text.slice(0, 120) + '…' : text;
        }

        function messageOf(error) {
            return error instanceof Error ? error.message : String(error);
        }

        /* 「已解析文件」消息用可读正文标记（不再嵌入 [[omnifile:...]] 这类无意义 token）：
         * 【文档「x」已解析 · N 字符（内容已折叠，点击上方文件卡片可展开）】
         * 摘要：...
         * 保存路径：<绝对路径>
         * 折叠卡片据此定位、提取文件名/类别/保存路径，展开时由宿主按保存路径推导解析结果。 */
        const PARSE_RE = /【(文档|文本)「([^」]+)」已解析[\s\S]*?保存路径：([^\n]+)/g;
        const PARSE_MARKER_RE = /【(文档|文本)「.+?」已解析/;

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
            if (kind === 'text') return '📝';
            if (kind === 'media') return '🎞';
            return '📎';
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

        /** 从消息正文提取「已解析文件」清单（名称/类别/保存路径），供折叠卡片渲染。 */
        function extractFiles(content) {
            const files = [];
            let m;
            PARSE_RE.lastIndex = 0;
            const text = textOf(content);
            while ((m = PARSE_RE.exec(text)) !== null) {
                files.push({
                    name: String(m[2] || ''),
                    kind: m[1] === '文本' ? 'text' : 'doc',
                    path: String(m[3] || '').trim(),
                });
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
                    size: json.size,
                    mime: json.mime
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
                    mime: saved.mime || file.type || '',
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

            async serialize(ref, signal) {
                const record = this.records.get(ref);
                if (record === undefined) throw new Error('文件已从草稿移除');
                if (record.path === undefined || record.path === '') throw new Error('文件尚未保存完成');
                record.status = 'processing';
                record.error = undefined;
                record.progressDetail = '';
                this.changed();
                /* 每次发送生成独立处理 token，宿主用它在 /api/omnifile/status 记录实时进度。 */
                const token = id();
                const stopPoll = this.pollProgress(token, signal, record);
                try {
                    const response = await fetch('/api/omnifile/process', {
                        method: 'POST',
                        headers: {'content-type': 'application/json'},
                        body: JSON.stringify({sessionId: record.sessionId, path: record.path, kind: record.kind, token: token}),
                        signal: signal || undefined,
                    });
                    const json = await response.json().catch(function () {
                        return {};
                    });
                    if (!json || json.ok !== true) throw new Error((json && json.error) || ('处理失败（HTTP ' + response.status + '）'));
                    record.status = 'done';
                    record.progressDetail = '';
                    this.changed();
                    if (json.kind === 'image') return '【图片「' + record.name + '」】' + '\n\n' + (json.text || '');
                    if (json.kind === 'doc' || json.kind === 'text') {
                        const label = json.kind === 'doc' ? '文档' : '文本';
                        const summary = summaryOf(json.markdown || '');
                        const chars = String(json.markdown || '').length;
                        /* 可读标记 + 保存路径（对用户/模型都有意义）：折叠卡片从正文提取，「保存路径」供展开时加载解析结果。 */
                        return '【' + label + '「' + record.name + '」已解析 · ' + chars + ' 字符（内容已折叠，点击上方文件卡片可展开）】\n\n'
                            + (summary !== '' ? '摘要：' + summary + '\n\n' : '')
                            + '保存路径：' + record.path + '\n';
                    }
                    return '【文件「' + record.name + '」】' + json.path + (json.size ? '（' + humanBytes(json.size) + '）' : '') + '\n\n' + (json.note || '');
                } catch (error) {
                    stopPoll();
                    record.status = 'error';
                    record.error = messageOf(error);
                    record.progressDetail = '';
                    this.changed();
                    return '【文件「' + record.name + '」】保存路径：' + record.path + '（自动解析失败：' + messageOf(error) + '）';
                } finally {
                    stopPoll();
                }
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
                    candidates: function () {
                        return Promise.resolve([]);
                    },
                    onPick: function () {
                        return undefined;
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
                /* 宿主按「保存路径」推导解析结果文件（uploads/<原名>.parsed.md），命名规则留在服务端。 */
                const response = await fetch('/api/omnifile/parsed?sessionId=' + encodeURIComponent(String(sessionId || ''))
                    + '&path=' + encodeURIComponent(path));
                if (!response.ok) throw new Error('加载解析内容失败（HTTP ' + response.status + '）');
                const text = await response.text();
                if (text === '') throw new Error('解析内容为空');
                return text;
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
                    const detail = record.status === 'processing' ? (record.progressDetail || '解析中…')
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
            const files = (node && node.data && node.data.files) || [];
            if (files.length === 0) return null;
            return react.createElement('div', {className: 'omnifile-parse-block'},
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
                                title: file.path,
                                onClick: function () {
                                    if (typeof props.openPath === 'function') props.openPath(file.path);
                                    else if (typeof props.openFile === 'function') props.openFile(file.path);
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
                    react.createElement('span', {className: 'omnifile-parse-chevron'}, '›'),
                ),
                open
                    ? react.createElement('div', {className: 'omnifile-parse-body'},
                        error !== null
                            ? react.createElement('div', {className: 'omnifile-parse-loading'}, '加载失败：' + error)
                            : loading
                                ? react.createElement('div', {className: 'omnifile-parse-loading'}, '加载中…')
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
            const base = snap && snap.value ? snap.value : {};
            const value = draft || base;
            const provider = value.provider || {};
            const update = function (path, val) {
                const nextDraft = JSON.parse(JSON.stringify(draft || base || {}));
                setPath(nextDraft, path, val);
                setDraft(nextDraft);
                setSavedTick(0);
            };
            const commit = function () {
                const target = draft || base;
                const ops = [];
                const p = target.provider || {};
                if (p.baseUrl) ops.push(['provider.baseUrl', String(p.baseUrl)]);
                if (p.model) ops.push(['provider.model', String(p.model)]);
                if (p.credential) ops.push(['provider.credential', String(p.credential)]);
                if (typeof target.thinking === 'boolean') ops.push(['thinking', target.thinking]);
                /* 并发数由客户端设置（默认 1） */
                if (target.concurrency !== undefined && target.concurrency !== null) ops.push(['concurrency', Math.max(1, Math.floor(Number(target.concurrency) || 1))]);
                ops.reduce(function (chain, op) {
                    return chain.then(function () {
                        return scope.set(op[0], op[1]);
                    });
                }, Promise.resolve()).then(function () {
                    setSavedTick(function (n) {
                        return n + 1;
                    });
                    scope.load();
                });
            };
            return react.createElement('div', {className: 'omnifile-section'},
                react.createElement('div', {className: 'omnifile-hint'}, '多模态模型配置：用于识别用户添加的图片、文档内嵌图片，并为文本-only 主模型生成图像描述（omnifile-* 变体）。'),
                react.createElement('div', {className: 'omnifile-field'},
                    react.createElement('label', null, 'API 地址（OpenAI 兼容，含 /v1）'),
                    react.createElement('input', {
                        type: 'text', value: provider.baseUrl || '', onChange: function (e) {
                            update(['provider', 'baseUrl'], e.target.value);
                        }
                    }),
                ),
                react.createElement('div', {className: 'omnifile-field'},
                    react.createElement('label', null, '模型名称'),
                    react.createElement('input', {
                        type: 'text', value: provider.model || '', onChange: function (e) {
                            update(['provider', 'model'], e.target.value);
                        }
                    }),
                ),
                react.createElement('div', {className: 'omnifile-field'},
                    react.createElement('label', null, 'API Key（credential 引用或环境变量名）'),
                    react.createElement('input', {
                        type: 'text',
                        value: provider.credential || '',
                        onChange: function (e) {
                            update(['provider', 'credential'], e.target.value);
                        }
                    }),
                ),
                react.createElement('div', {className: 'omnifile-check'},
                    react.createElement('label', null,
                        react.createElement('input', {
                            type: 'checkbox',
                            checked: value.thinking === true,
                            onChange: function (e) {
                                update(['thinking'], e.target.checked);
                            }
                        }),
                        ' 启用思考模式（默认禁止）',
                    ),
                ),
                react.createElement('div', {className: 'omnifile-field'},
                    react.createElement('label', null, '多模态调用并发数'),
                    react.createElement('input', {
                        type: 'number',
                        min: 1,
                        max: 16,
                        value: value.concurrency === undefined || value.concurrency === null ? 1 : Number(value.concurrency),
                        onChange: function (e) {
                            const n = parseInt(e.target.value, 10);
                            update(['concurrency'], Number.isFinite(n) && n >= 1 ? n : 1);
                        }
                    }),
                ),
                savedTick > 0 && react.createElement('div', {className: 'omnifile-hint'}, '已保存。'),
                react.createElement('button', {
                    type: 'button',
                    className: 'omnifile-save',
                    onClick: commit
                }, '保存配置'),
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
                    const files = extractFiles(match.event.data.content);
                    if (files.length === 0) return undefined;
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
            const ORIGINAL = Symbol.for('cordis.original');
            const registryIdentity = function (registry) {
                let current = registry;
                while (true) {
                    const original = (current || {})[ORIGINAL];
                    if ((typeof original !== 'object' && typeof original !== 'function') || original === null || original === current) return current;
                    current = original;
                }
            };
            const registered = new WeakMap();
            const register = function (scope, registry) {
                scope.effect(function () {
                    const identity = registryIdentity(registry);
                    let entry = registered.get(identity);
                    if (entry === undefined) {
                        entry = {dispose: registry.registerSource(controller.source()), owners: 0};
                        registered.set(identity, entry);
                    }
                    entry.owners += 1;
                    return function () {
                        if (registered.get(identity) !== entry) return;
                        entry.owners -= 1;
                        if (entry.owners > 0) return;
                        registered.delete(identity);
                        entry.dispose();
                    };
                }, 'dsh-omnifile: file reference codec');
            };
            ctx.inject(['inputTriggers'], function (scope) {
                const triggers = scope && scope.get ? scope.get('inputTriggers') : undefined;
                if (triggers) register(scope, triggers);
            });
            ctx.inject(['slash'], function (scope) {
                const slash = scope && scope.get ? scope.get('slash') : undefined;
                if (slash) register(scope, slash);
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
                        return 'Omnifile';
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
