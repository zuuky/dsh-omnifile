/**
 * 客户端核心控制器：文件记录、上传/解析管线、chip 插入（始终置顶）、序列化与移除。
 */
import { SOURCE, KIND_IMAGE, KIND_DOC, KIND_TEXT, KIND_MEDIA, KIND_OTHER, MARKER_STATUS_OK, MARKER_STATUS_UNREADABLE, MARKER_STATUS_FAILED, markerText, sourcePathOf } from '../../../core/index.js'
import { DEFAULT_LIMITS, CANDIDATE_LIMIT } from './constants.js'
import { id, humanBytes, messageOf, iconFor, isImageFile } from '../../../core/client/util.js'

/** 客户端双端共用镜像（保持既有调用点形态）。 */
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
    sourcePathOf,
}

interface OmnifileRecord {
    ref: string
    sessionId: string
    name: string
    path?: string
    kind: string
    size: number
    status: 'ready' | 'processing' | 'done' | 'error'
    error?: string
    progressDetail?: string
    awaitingSend?: boolean
    _waitNotified?: boolean
    _processPromise?: Promise<any>
    _result?: any
    parsedPath?: string
}

class OmnifileController {
    ctx: any
    records = new Map<string, OmnifileRecord>()
    listeners = new Set<() => void>()
    revision = 0
    _fileCache = new Map<string, any>()
    _parsedCache = new Map<string, Promise<string>>()
    /* 发送锁：sessionId -> 当前“等待解析完成后发送”周期的 signal；用于防重复发送。 */
    _sendSignal = new Map<string, AbortSignal>()
    /* 客户端限额从宿主 /api/omnifile/config 读取，避免与 settings 不同步。 */
    limits: { maxFileBytes: number; maxBatchImages: number; progressPollMs: number } = Object.assign({}, DEFAULT_LIMITS)

    constructor(ctx: any) {
        this.ctx = ctx
        this.loadLimits()
    }

    /** 从宿主读取当前生效的客户端限额（文件大小/图片批量/轮询间隔），失败静默保留缺省值。 */
    loadLimits(): void {
        const controller = this
        fetch('/api/omnifile/config')
            .then(function (res) {
                return res.json()
            })
            .catch(function () {
                return {}
            })
            .then(function (json: any) {
                const limits = json && json.ok === true ? json.limits : null
                if (limits === null) return
                const next: Record<string, number> = {}
                const map: Record<string, string> = { maxFileBytes: 'maxFileBytes', maxBatchImages: 'maxBatchImages', progressPollMs: 'progressPollMs' }
                Object.keys(map).forEach(function (key) {
                    const value = Number(limits[map[key]])
                    if (Number.isFinite(value) && value > 0) next[key] = key === 'progressPollMs' ? Math.max(50, value) : value
                })
                if (Object.keys(next).length > 0) controller.limits = Object.assign({}, controller.limits, next)
            })
    }

    subscribe(fn: () => void): () => void {
        this.listeners.add(fn)
        return () => { this.listeners.delete(fn) }
    }

    snapshot(): number {
        return this.revision
    }

    getSnapshot(): number {
        return this.revision
    }

    changed(): void {
        this.revision += 1
        for (const fn of this.listeners) {
            try {
                fn()
            } catch (e) { /* ignore */ }
        }
    }

    currentSessionId(): string | undefined {
        const list = this.ctx.get('sessions')
        const current = list && list.list && list.list.getSnapshot ? list.list.getSnapshot().current : undefined
        return current === undefined ? undefined : String(current)
    }

    inputFor(sessionId: string): any {
        const sessions = this.ctx.get('sessions')
        const conversation = this.ctx.get('conversation')
        if (sessions === undefined || conversation === undefined) return undefined
        const actx = sessions.scope(sessionId)
        if (actx === undefined) return undefined
        try {
            return conversation.input.for(actx)
        } catch (e) {
            return undefined
        }
    }

    async saveOne(sessionId: string, file: File): Promise<{ ok: boolean; error?: string; path?: string; kind?: string; size?: number }> {
        const cap = this.limits.maxFileBytes || DEFAULT_LIMITS.maxFileBytes
        if (file.size > cap) return { ok: false, error: '「' + file.name + '」超过 ' + Math.round(cap / 1024 / 1024) + 'MB，已跳过' }
        const dataUrl = await new Promise<string>(function (resolveRead, rejectRead) {
            const reader = new FileReader()
            reader.onerror = function () {
                rejectRead(new Error('读取失败'))
            }
            reader.onload = function () {
                resolveRead(String(reader.result || ''))
            }
            reader.readAsDataURL(file)
        })
        const comma = dataUrl.indexOf(',')
        const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : ''
        const response = await fetch('/api/omnifile/save', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId: sessionId, name: file.name, base64: base64 }),
        })
        const json = await response.json().catch(function () {
            return {}
        })
        if (json && json.ok === true) return {
            ok: true,
            path: json.path,
            kind: json.kind,
            size: json.size,
        }
        return { ok: false, error: (json && json.error) || ('上传失败（HTTP ' + response.status + '）') }
    }

    addNativeImages(sessionId: string, input: any, files: File[]): boolean {
        const conversation = this.ctx.get('conversation')
        if (conversation === undefined || typeof conversation.createDraftImages !== 'function') return false
        try {
            const attachments = conversation.createDraftImages(files.slice(0, this.limits.maxBatchImages || DEFAULT_LIMITS.maxBatchImages))
            if (attachments.length > 0) input.addImages(attachments.map(function (a: any) {
                return a.id
            }))
            return true
        } catch (error) {
            try {
                input.notify('error', '图片添加失败：' + messageOf(error))
            } catch (e) { /* ignore */ }
            return false
        }
    }

    /** 计算新 chip 的插入位置：始终放在输入区最前（正文之前）。
     *  已有本插件 chip 时紧跟最后一个 chip 之后（保持 chips 成组且顺序稳定），
     *  没有则放在 draft 开头。返回 {start, draftRev}。 */
    frontInsertSpan(input: any): { start: number; draftRev: number } {
        const snapshot = input.state.getSnapshot()
        const occurrences = Array.isArray(snapshot.occurrences) ? (snapshot.occurrences as any[]) : []
        const mine = occurrences.filter(function (o: any) {
            return o && o.source === common.SOURCE && typeof o.offset === 'number'
        })
        const draft = String(snapshot.draft || '')
        let start = 0
        if (mine.length > 0) {
            let last = -1
            for (const o of mine) if (o.offset > last) last = o.offset
            start = last + 1 /* 紧跟最后一个 chip 占位符（占 1 字符） */
            if (draft.charAt(start) === ' ') start += 1 /* 跳过已存在的分隔空格，避免双空格 */
        }
        return { start, draftRev: snapshot.draftRev }
    }

    async addNonImage(sessionId: string, input: any, file: File): Promise<boolean> {
        const saved = await this.saveOne(sessionId, file)
        if (!saved.ok) {
            try {
                input.notify('error', saved.error || '')
            } catch (e) { /* ignore */ }
            return false
        }
        const ref = id()
        const record: OmnifileRecord = {
            ref: ref,
            sessionId: sessionId,
            name: file.name,
            path: saved.path,
            kind: saved.kind || 'other',
            size: saved.size || file.size,
            status: 'ready',
            error: undefined,
        }
        this.records.set(ref, record)
        /* 占位符为可见文件 chip（label=文件名）：用户能看到附件位置，删除 chip 为显式的主动操作。
         * 不能把 label 置空，否则 backdrop 隐藏 chip 后 textarea 里的 U+FFFC 原本体会裸露成"隐形占位"。
         * chip 始终插入输入区最前（正文之前）——即使输入框已有文字，文件 chip 也保持在最前面。 */
        const span = this.frontInsertSpan(input)
        const accepted = input.insertReference({
            source: common.SOURCE,
            ref: ref,
            label: file.name,
            clipboardText: '[文件: ' + file.name + ']',
        }, { start: span.start, end: span.start, draftRev: span.draftRev })
        if (!accepted) {
            this.records.delete(ref)
            return false
        }
        this.changed()
        /* 选中即解析：立即后台 /process（含多模态等耗时步骤），发送时 serialize 会 await 同一 promise。 */
        this.startProcess(ref).catch(function () {})
        return true
    }

    async addFiles(sessionId: string, files: File[]): Promise<void> {
        if (!Array.isArray(files) || files.length === 0) return
        const input = this.inputFor(sessionId)
        if (input === undefined) return
        const state = input.state.getSnapshot()
        const images = files.filter(isImageFile)
        /* 所有非图片文件（含未知格式）都走上传+解析；未知格式由 host 按文本读取，读不了会提示用户。 */
        const docs = files.filter(function (file) {
            return !isImageFile(file)
        })
        if (images.length > 0 && state.phase === 'plain') this.addNativeImages(sessionId, input, images)
        const failures: string[] = []
        for (const file of docs) {
            try {
                const ok = await this.addNonImage(sessionId, input, file)
                if (!ok) failures.push('「' + file.name + '」未添加')
            } catch (error) {
                failures.push('「' + file.name + '」添加失败：' + messageOf(error))
            }
        }
        if (failures.length > 0) {
            try {
                input.notify('error', failures.join('；'))
            } catch (e) { /* ignore */ }
        }
    }

    /** 轮询宿主端处理进度，把实时阶段写入 chip 详情（多模态识别时用户能看到“识别图片 x/n”）。 */
    pollProgress(token: string, signal: AbortSignal | undefined, record: OmnifileRecord): () => void {
        let stopped = false
        const poll = () => {
            if (stopped) return
            fetch('/api/omnifile/status?token=' + encodeURIComponent(token), { signal: signal || undefined })
                .then((res) => res.json())
                .catch(() => ({}))
                .then((json: any) => {
                    if (stopped) return
                    const p = json && json.progress
                    if (p && typeof p.detail === 'string' && p.detail !== '') {
                        record.progressDetail = p.detail
                    } else if (p && typeof p.stage === 'string' && p.stage !== '') {
                        record.progressDetail = p.stage
                    }
                    this.changed()
                })
        }
        const timer = setInterval(poll, this.limits.progressPollMs || DEFAULT_LIMITS.progressPollMs)
        poll()
        return function () {
            stopped = true
            clearInterval(timer)
        }
    }

    /**
     * 选中即解析（幂等）：同一 ref 只发起一次 /process，后续调用复用进行中的 promise。
     * 解析进度写入 chip；成功时把 md 落盘路径记到 record.parsedPath。发送时 serialize
     * await 此方法，从而保证“点击发送时所有文件都已解析完成”。
     * @returns 解析结果 json；失败时置 record.error 并 reject（调用方捕获）。
     */
    async startProcess(ref: string, signal?: AbortSignal): Promise<any> {
        const record = this.records.get(ref)
        if (record === undefined) throw new Error('文件已从草稿移除')
        if (record.path === undefined || record.path === '') throw new Error('文件尚未保存完成')
        if (record.status === 'done' && record._result !== undefined) return record._result
        if (record._processPromise !== undefined) return record._processPromise
        record.status = 'processing'
        record._result = undefined
        record.error = undefined
        record.progressDetail = ''
        this.changed()
        const token = id()
        const stopPoll = this.pollProgress(token, signal, record)
        const promise = (async function () {
            try {
                const response = await fetch('/api/omnifile/process', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ sessionId: record.sessionId, path: record.path, name: record.name, kind: record.kind, token: token }),
                    signal: signal || undefined,
                })
                const json = await response.json().catch(function () {
                    return {}
                })
                if (!json || json.ok !== true) throw new Error((json && json.error) || ('处理失败（HTTP ' + response.status + '）'))
                record.status = 'done'
                record._result = json
                if (typeof json.parsedPath === 'string' && json.parsedPath !== '') record.parsedPath = json.parsedPath
                this.changed()
                return json
            } catch (error) {
                record.status = 'error'
                record.error = messageOf(error)
                this.changed()
                throw error
            } finally {
                stopPoll()
            }
        }.bind(this))()
        record._processPromise = promise
        /* 后台预解析的 rejection 在此消化，避免 unhandledrejection；serialize 会显式 await 恢复错误。 */
        promise.catch(function () {})
        return promise
    }

    /** 清除输入区 composer 提示（如“请勿重复点击”），发送提交/周期结束后调用。 */
    clearNotice(sid: string): void {
        try {
            const input = typeof this.inputFor === 'function' ? this.inputFor(sid) : undefined
            if (input && input.notices && typeof input.notices.set === 'function') input.notices.set(null)
        } catch (e) { /* ignore */ }
    }

    /** 把 ref 的解析结果序列化为一行可读消息标记；发送时由运行时 await，等待该文件解析完成。
     * 统一格式：解析后保存路径：<md 或源路径>（完整内容见上方文件卡片，可点击展开；源文件：<源路径> | 无法按文本读取：… | 解析失败：…）
     */
    async serialize(ref: string, signal?: AbortSignal): Promise<string> {
        const self = this
        const record = this.records.get(ref)
        /* 文件已被移除：不关联发送——仅丢弃该文件的标记，其余文件/纯文本照常发送。 */
        if (record === undefined) return ''
        if (record.path === undefined || record.path === '') throw new Error('文件尚未保存完成')
        const sid = record.sessionId
        /* 防重复发送：同一会话已有一次“等待解析完成后发送”的周期 → 本轮为重复点击，拒绝之，
         * 框架会 abort 本轮且不发出第二条消息（默认 sink 不执行）。 */
        const activeSignal = this._sendSignal.get(sid)
        if (activeSignal !== undefined && activeSignal !== signal) {
            return Promise.reject(new Error('已有点发送正在等待文件解析完成，请勿重复点击'))
        }
        if (activeSignal === undefined) {
            this._sendSignal.set(sid, signal as AbortSignal)
            /* 周期被 abort（取消/失败时框架会 abort 该 signal）→ 释放发送锁，允许重新发送。 */
            if (typeof signal?.addEventListener === 'function') {
                signal.addEventListener('abort', function () {
                    if (self._sendSignal.get(sid) === signal) self._sendSignal.delete(sid)
                    self.clearNotice(sid)
                })
            }
        }
        /* 点发送时文件还在解析：标 awaitingSend → 对话区底部显示实时解析进度，chip 同步等待态。 */
        if (record.status !== 'done' && !record._waitNotified) {
            record._waitNotified = true
            record.awaitingSend = true
            this.changed()
        }
        let json: any = null
        try {
            json = await this.startProcess(ref, signal)
        } catch (error) {
            json = null
        }
        /* 发送提交后 / 草稿清空时：释放发送锁，并清理由“请勿重复点击”类残留的 composer 提示。 */
        setTimeout(function () {
            if (self._sendSignal.get(sid) !== signal) return
            const occs2 = typeof self.inputFor === 'function' ? self.inputFor(sid)?.state?.getSnapshot?.()?.occurrences : undefined
            const mine = Array.isArray(occs2) && occs2.some(function (o: any) {
                return o.source === common.SOURCE && o.ref === ref
            })
            if (!mine) {
                self.clearNotice(sid)
                self._sendSignal.delete(sid)
            }
        }, 0)
        /* 文件在本周期内被移除：仅丢弃其标记，不取消发送（其余文件/纯文本照发）。 */
        const occs = typeof this.inputFor === 'function' ? this.inputFor(sid)?.state?.getSnapshot?.()?.occurrences : undefined
        if (Array.isArray(occs) && !occs.some(function (o: any) {
            return o.source === common.SOURCE && o.ref === ref
        })) {
            if (record.awaitingSend) {
                record.awaitingSend = false
                this.changed()
            }
            return ''
        }
        /* 解析已结束：解除等待态。 */
        if (record.awaitingSend) {
            record.awaitingSend = false
            this.changed()
        }
        if (json !== null && json.ok === true) {
            const p = (typeof json.parsedPath === 'string' && json.parsedPath !== '') ? json.parsedPath : record.path
            if (json.kind === 'other') {
                /* 不可读：保存路径即源文件，无需再附源文件回指。 */
                return markerText(p, { ok: common.MARKER_STATUS_UNREADABLE, note: json.note || '' }) + '\n'
            }
            /* image / doc / text 命中 → 有 md（{源文件名}.md），只放一行引用，完整内容在卡片里；
             * 附「源文件」回指，客户端 📂 与卡片据此打开原始文件。 */
            return markerText(p, { ok: common.MARKER_STATUS_OK, source: record.path }) + '\n'
        }
        return markerText(record.path, { ok: common.MARKER_STATUS_FAILED, note: record.error || '' }) + '\n'
    }

    remove(sessionId: string, occurrence: any): void {
        const input = this.inputFor(sessionId)
        if (input === undefined) return
        if (input.state.getSnapshot().phase !== 'plain') return
        const snapshot = input.state.getSnapshot()
        const current = snapshot.occurrences.find(function (o: any) {
            return o.source === common.SOURCE && o.occurrenceId === occurrence.occurrenceId && o.ref === occurrence.ref
        })
        if (current === undefined) return
        const accepted = input.insertText('', {
            start: current.offset,
            end: current.offset + 1,
            draftRev: snapshot.draftRev,
        })
        if (!accepted) return
        this.records.delete(occurrence.ref)
        this.changed()
    }

    source(): any {
        const controller = this
        return {
            trigger: '@',
            name: common.SOURCE,
            order: 1000,
            candidates: function (projection: any, opts: any) {
                const sessionId = projection && projection.sessionId
                if (sessionId === undefined || sessionId === '') return Promise.resolve([])
                return controller.listWorkspaceFiles(sessionId, opts && opts.query, opts && opts.signal)
            },
            onPick: function (pick: any) {
                const candidate = pick && pick.candidate
                if (candidate === undefined || candidate === null || typeof candidate.path !== 'string' || candidate.path === '') return undefined
                const sessionId = pick.session && pick.session.sessionId
                const ref = id()
                const record: OmnifileRecord = {
                    ref: ref,
                    sessionId: sessionId,
                    name: String(candidate.name || '文件'),
                    path: candidate.path,
                    kind: String(candidate.kind || 'other'),
                    size: Number(candidate.size) || 0,
                    status: 'ready',
                    error: undefined,
                }
                controller.records.set(ref, record)
                controller.changed()
                /* 选中即解析：工作区文件已有真实路径，立即后台 /process，发送时 serialize 会 await。 */
                controller.startProcess(ref).catch(function () {})
                return {
                    insert: {
                        source: common.SOURCE,
                        ref: ref,
                        label: record.name,
                        clipboardText: '[文件: ' + record.name + ']',
                    },
                }
            },
            codec: {
                clipboardText: (ref: string) => {
                    const record = controller.records.get(ref)
                    return '[文件: ' + (record ? record.name : '附件') + ']'
                },
                serialize: (ref: string, signal?: AbortSignal) => controller.serialize(ref, signal),
            },
        }
    }

    async openPath(sessionId: string, path: string): Promise<void> {
        const connection = this.ctx.get('connection')
        if (connection && connection.api && connection.api.host && typeof connection.api.host.openPath === 'function') {
            try {
                await connection.api.host.openPath({ path: path })
                return
            } catch (e) { /* fall through */ }
        }
        try {
            await fetch('/api/omnifile/open', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ sessionId: sessionId, path: path }),
            })
        } catch (e) { /* ignore */ }
    }

    /** 懒加载解析结果（<uploads>/<源文件名>.md）：按 会话|路径 缓存成功结果、去重在途请求。 */
    loadParsed(sessionId: string, file: any): Promise<string> {
        const path = file && file.path
        if (typeof path !== 'string' || path === '') return Promise.reject(new Error('没有可加载的解析文件'))
        const key = String(sessionId || '') + '|' + path
        if (this._parsedCache.has(key)) return Promise.resolve(this._parsedCache.get(key) as Promise<string>)
        const promise = fetch('/api/omnifile/parsed?sessionId=' + encodeURIComponent(String(sessionId || ''))
            + '&path=' + encodeURIComponent(path))
            .then(function (response) {
                if (!response.ok) throw new Error('加载解析内容失败（HTTP ' + response.status + '）')
                return response.text()
            })
            .then(function (text) {
                if (text === '') throw new Error('解析内容为空')
                return text
            })
        this._parsedCache.set(key, promise)
        /* 失败不缓存，再次展开可重试。 */
        promise.catch(function () { this._parsedCache.delete(key) }.bind(this))
        return promise
    }

    /** 工作区文件列表缓存：sessionId -> {at, files, inflight}，避免 @ 每次击键都请求宿主。 */
    fileListing(sessionId: string, signal?: AbortSignal): Promise<any[]> {
        const key = String(sessionId || '')
        if (key === '') return Promise.resolve([])
        const now = Date.now()
        const cached = this._fileCache.get(key)
        if (cached !== undefined && cached.inflight === undefined && now - cached.at < 15000) {
            return Promise.resolve(cached.files)
        }
        const req = fetch('/api/omnifile/list?sessionId=' + encodeURIComponent(key), { signal: signal || undefined })
            .then(function (r) {
                return r.json()
            })
            .then(function (j: any) {
                return j && j.ok === true && Array.isArray(j.files) ? j.files : []
            })
            .catch(function () {
                return cached !== undefined && cached.inflight === undefined ? cached.files : []
            })
        const settled = req.then(function (files) {
            this._fileCache.set(key, { at: Date.now(), files: files, inflight: undefined })
            return files
        }.bind(this))
        this._fileCache.set(key, { at: now, files: cached !== undefined ? cached.files : [], inflight: settled })
        return settled
    }

    /** @ 文件候选：按 query 子串（不区分大小写）过滤工作区文件列表，映射为菜单项。 */
    listWorkspaceFiles(sessionId: string, query?: string, signal?: AbortSignal): Promise<any[]> {
        const q = String(query || '').trim().toLowerCase()
        return this.fileListing(sessionId, signal).then(function (files) {
            const matched = q === '' ? files : files.filter(function (f: any) {
                return String(f.rel || f.name || '').toLowerCase().indexOf(q) >= 0
            })
            return matched.slice(0, CANDIDATE_LIMIT).map(function (f: any) {
                return {
                    icon: iconFor(f.kind, f.name),
                    name: f.name,
                    description: String(f.rel || ''),
                    path: f.path,
                    kind: f.kind,
                    size: f.size,
                }
            })
        })
    }
}

export type { OmnifileRecord }
export { OmnifileController, common, humanBytes }
