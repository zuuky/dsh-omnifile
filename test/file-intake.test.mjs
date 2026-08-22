/**
 * dsh-omnifile 文件接入（file-intake）功能块回归测试（node:test）
 * 运行：node --test test/file-intake.test.mjs
 *
 * 覆盖：客户端控制器（上传/发送等待/防重复/移除解耦/提示清理）、
 *       输入区 dock chip + 发送等待进度行渲染、chip 置顶插入、@ 过滤，
 *       以及本功能块 CSS 静态断言。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clientSrc, bootClient, el, els, textOf } from './helpers.mjs'

/* ============ 1. CSS / 常量静态断言 ============ */
test('CSS：dock/chip/sendwait/上传按钮/拖拽遮罩存在且全宽', () => {
    assert.ok(clientSrc.indexOf('.omnifile-dock{') >= 0, 'dock 样式存在');
    assert.ok(clientSrc.indexOf('.omnifile-sendwait{') >= 0, 'sendwait 进度行样式存在');
    assert.ok(clientSrc.indexOf('.omnifile-chip{') >= 0, 'chip 样式存在');
    assert.ok(clientSrc.indexOf('.omnifile-upload-btn{') >= 0, '上传按钮样式存在');
    assert.ok(clientSrc.indexOf('.omnifile-overlay{') >= 0, '拖拽遮罩样式存在');
    assert.ok(clientSrc.indexOf('[data-input-backdrop] span[data-decoration="chip"]{') >= 0, '输入框 chip 指引样式存在');
});

/* ============ 2. 渲染：dock chip + sendwait 进度行 ============ */
test('渲染：草稿态 chip + 发送中 sendwait 进度行', async () => {
    const b = bootClient()
    b.controller.records.set('r1', { ref: 'r1', sessionId: 's1', name: '报告.docx', path: 'C:/x/1.docx', kind: 'doc', size: 12, status: 'processing', progressDetail: '识别内嵌图片 2/5' })
    b.occurrences = [{ source: '文件', occurrenceId: 'o1', ref: 'r1' }]
    b.elements.length = 0
    b.dock({ controller: b.controller, input: { occurrences: b.occurrences, phase: 'plain' }, openPath: () => {}, remove: () => {} })
    assert.equal(els(b.elements, 'omnifile-chip').length, 1, 'chip 渲染')
    assert.equal(els(b.elements, 'omnifile-sendwait').length, 0, '未发送 → 无进度行')
    assert.equal(textOf(el(b.elements, 'omnifile-chip-name')), '报告.docx', 'chip 文件名')

    /* 点发送 → awaitingSend → 对话区进度行实时显示 */
    const rec = b.controller.records.get('r1'); rec.awaitingSend = true; rec._waitNotified = true; rec.progressDetail = '识别内嵌图片 3/5'
    b.elements.length = 0
    b.dock({ controller: b.controller, input: { occurrences: b.occurrences, phase: 'plain' }, openPath: () => {}, remove: () => {} })
    const sw = els(b.elements, 'omnifile-sendwait')
    assert.equal(sw.length, 1, '发送中显示进度行')
    assert.ok(/正在解析文件 0\/1/.test(textOf(sw[0])) && /识别内嵌图片 3\/5/.test(textOf(sw[0])), '进度行内容实时')

    /* 全部完成 → 进度行消失 */
    rec.status = 'done'; rec.awaitingSend = false
    b.elements.length = 0
    b.dock({ controller: b.controller, input: { occurrences: b.occurrences, phase: 'plain' }, openPath: () => {}, remove: () => {} })
    assert.equal(els(b.elements, 'omnifile-sendwait').length, 0, '完成后进度行消失')
});

/* ============ 3. 渲染：处理中 × 可用（单个文件取消） ============ */
test('渲染：处理中文件 × 可用，点击触发 remove', () => {
    const b = bootClient()
    b.controller.records.set('r1', { ref: 'r1', sessionId: 's1', name: 'x.docx', path: 'C:/x/x.docx', kind: 'doc', size: 1, status: 'processing' })
    b.occurrences = [{ source: '文件', occurrenceId: 'o1', ref: 'r1' }]
    b.elements.length = 0
    let removed = false
    b.dock({ controller: b.controller, input: { occurrences: b.occurrences, phase: 'plain' }, openPath: () => {}, remove: () => { removed = true } })
    const rm = el(b.elements, 'omnifile-chip-remove')
    assert.ok(rm && rm.props.disabled === false, '处理中 × 可用')
    rm.props.onClick({ stopPropagation() {} })
    assert.ok(removed, '点击 × 触发 remove')
});

/* ============ 4. serialize：等待解析完成后发送 ============ */
test('serialize：等待解析完成后返回成功标记、解除等待态', async () => {
    let gates = []
    const b = bootClient({
        fetch: (url) => {
            const u = String(url || '')
            if (u.indexOf('/api/omnifile/config') >= 0) return Promise.resolve({ json: async () => ({ ok: true, limits: { maxFileBytes: 52428800, maxBatchImages: 20, progressPollMs: 40 } }) })
            if (u.indexOf('/api/omnifile/status') >= 0) return Promise.resolve({ json: async () => ({ ok: true, progress: null }) })
            if (u.indexOf('/api/omnifile/process') >= 0) { let rel; const p = new Promise((r) => { rel = r }); gates.push(rel); return p.then(() => ({ json: async () => ({ ok: true, kind: 'text', parsedPath: 'C:/x/u/m.md', path: 'C:/x/u/p.docx' }) })) }
            return Promise.resolve({ json: async () => ({ ok: false }) })
        },
    })
    b.controller.records.set('rA', { ref: 'rA', sessionId: 's1', name: 'a.docx', path: 'C:/x/a.docx', kind: 'doc', size: 1, status: 'processing' })
    b.occurrences = [{ source: '文件', occurrenceId: 'oA', ref: 'rA' }]
    const ctl = new AbortController()
    const p = Promise.all([b.controller.serialize('rA', ctl.signal)])
    await new Promise((r) => setTimeout(r, 5)) // ensureCommon 微任务 + fetch 入队
    gates.forEach((g) => g())
    const parts0 = await p
    assert.ok(parts0.length === 1 && /解析后保存路径：/.test(parts0[0]), '返回成功 marker')
    assert.equal(b.controller.records.get('rA').awaitingSend, false, '解析后解除等待态')
});

/* ============ 5. 防重复发送 ============ */
test('防重复：等待期再次点发送被拒，首周期照常完成', async () => {
    let gates = []
    const b = bootClient({
        fetch: (url) => {
            const u = String(url || '')
            if (u.indexOf('/api/omnifile/config') >= 0) return Promise.resolve({ json: async () => ({ ok: true, limits: { maxFileBytes: 52428800, maxBatchImages: 20, progressPollMs: 40 } }) })
            if (u.indexOf('/api/omnifile/status') >= 0) return Promise.resolve({ json: async () => ({ ok: true, progress: null }) })
            if (u.indexOf('/api/omnifile/process') >= 0) { let rel; const p = new Promise((r) => { rel = r }); gates.push(rel); return p.then(() => ({ json: async () => ({ ok: true, kind: 'text', parsedPath: 'C:/x/u/m.md', path: 'C:/x/u/p.docx' }) })) }
            return Promise.resolve({ json: async () => ({ ok: false }) })
        },
    })
    b.controller.records.set('rA', { ref: 'rA', sessionId: 's1', name: 'a.docx', path: 'C:/x/a.docx', kind: 'doc', size: 1, status: 'processing' })
    b.occurrences = [{ source: '文件', occurrenceId: 'oA', ref: 'rA' }]

    const c1 = new AbortController()
    const cyc1 = Promise.all([b.controller.serialize('rA', c1.signal)])
    const c2 = new AbortController()
    let dupErr = null
    try { await Promise.all([b.controller.serialize('rA', c2.signal), b.controller.serialize('rA', c2.signal)]) } catch (e) { dupErr = e && e.message || String(e) }
    assert.ok(dupErr && dupErr.indexOf('请勿重复点击') >= 0, '重复点击被拒：' + (dupErr || ''))

    gates.forEach((g) => g())
    const parts0 = await cyc1
    assert.ok(parts0.length === 1 && /解析后保存路径：/.test(parts0[0]), '首周期正常完成')
});

/* ============ 6. 移除与发送解耦 ============ */
test('移除文件不取消发送：被移除引用返回空、剩余照发', async () => {
    let gates = []
    const b = bootClient({
        fetch: (url) => {
            const u = String(url || '')
            if (u.indexOf('/api/omnifile/config') >= 0) return Promise.resolve({ json: async () => ({ ok: true, limits: { maxFileBytes: 52428800, maxBatchImages: 20, progressPollMs: 40 } }) })
            if (u.indexOf('/api/omnifile/status') >= 0) return Promise.resolve({ json: async () => ({ ok: true, progress: null }) })
            if (u.indexOf('/api/omnifile/process') >= 0) { let rel; const p = new Promise((r) => { rel = r }); gates.push(rel); return p.then(() => ({ json: async () => ({ ok: true, kind: 'text', parsedPath: 'C:/x/u/m.md', path: 'C:/x/u/p.docx' }) })) }
            return Promise.resolve({ json: async () => ({ ok: false }) })
        },
    })
    b.controller.records.set('rA', { ref: 'rA', sessionId: 's1', name: 'a.docx', path: 'C:/x/a.docx', kind: 'doc', size: 1, status: 'processing' })
    b.controller.records.set('rB', { ref: 'rB', sessionId: 's1', name: 'b.pdf', path: 'C:/x/b.pdf', kind: 'doc', size: 1, status: 'processing' })
    b.occurrences = [{ source: '文件', occurrenceId: 'oA', ref: 'rA' }, { source: '文件', occurrenceId: 'oB', ref: 'rB' }]

    const ctl = new AbortController()
    const cycA = b.controller.serialize('rA', ctl.signal)
    const cycB = b.controller.serialize('rB', ctl.signal)
    await new Promise((r) => setTimeout(r, 5)) // 让两个 serialize 进入 /process

    /* 模拟用户移除 rA：记录删除 + 从草稿去掉 */
    b.controller.records.delete('rA')
    b.occurrences = b.occurrences.filter((o) => o.ref !== 'rA')

    gates.forEach((g) => g())
    const markerA = await cycA
    const markerB = await cycB
    assert.equal(markerA, '', '被移除引用返回空（丢弃）')
    assert.ok(/解析后保存路径：/.test(markerB), '剩余文件 marker 正常')
    await new Promise((r) => setTimeout(r, 6)) // 等 setTimeout 宏任务释放锁
    assert.ok(!b.controller._sendSignal.has('s1'), '发送锁未卡死')
    b.occurrences = []
    await new Promise((r) => setTimeout(r, 5))
    assert.ok(!b.controller._sendSignal.has('s1'), '提交后锁释放')
});

/* ============ 7. composer 提示清理 ============ */
test('发送提交后清理由"请勿重复点击"残留的提示', async () => {
    let gates = []
    const b = bootClient({
        fetch: (url) => {
            const u = String(url || '')
            if (u.indexOf('/api/omnifile/config') >= 0) return Promise.resolve({ json: async () => ({ ok: true, limits: { maxFileBytes: 52428800, maxBatchImages: 20, progressPollMs: 40 } }) })
            if (u.indexOf('/api/omnifile/status') >= 0) return Promise.resolve({ json: async () => ({ ok: true, progress: null }) })
            if (u.indexOf('/api/omnifile/process') >= 0) { let rel; const p = new Promise((r) => { rel = r }); gates.push(rel); return p.then(() => ({ json: async () => ({ ok: true, kind: 'text', parsedPath: 'C:/x/u/m.md', path: 'C:/x/u/p.docx' }) })) }
            return Promise.resolve({ json: async () => ({ ok: false }) })
        },
    })
    b.controller.records.set('rA', { ref: 'rA', sessionId: 's1', name: 'a.docx', path: 'C:/x/a.docx', kind: 'doc', size: 1, status: 'processing' })
    b.occurrences = [{ source: '文件', occurrenceId: 'oA', ref: 'rA' }]
    const cth = new AbortController()
    const p = Promise.all([b.controller.serialize('rA', cth.signal)])
    await new Promise((r) => setTimeout(r, 5))
    /* 重复点击产生的提示（模拟 composer notices 已有值） */
    b.setNotice('请勿重复点击')
    gates.forEach((g) => g())
    await p
    /* 发送提交（草稿清空）→ setTimeout 触发 clearNotice */
    b.occurrences = []
    await new Promise((r) => setTimeout(r, 10))
    assert.equal(b.noticeValue, null, '发送提交后提示被清理')
});

/* ============ 8. 文件 chip 置顶（#3）：无论输入框有无文字，chip 都在最前 ============ */
test('chip 位置：frontInsertSpan 始终返回正文之前的位置', () => {
    const b = bootClient()
    /* 输入框已有正文、无 chip → 插到最前（start=0） */
    const s1 = b.controller.frontInsertSpan({ state: { getSnapshot: () => ({ occurrences: [], draft: '你好 world', draftRev: 1 }) } })
    assert.equal(s1.start, 0, '无 chip 时插到正文最前')
    /* 已有 chip @0 + 正文（"￼ hello"）→ 紧跟 chip 之后、正文之前 */
    const s2 = b.controller.frontInsertSpan({ state: { getSnapshot: () => ({ occurrences: [{ source: '文件', offset: 0 }], draft: '￼ hello', draftRev: 2 }) } })
    assert.equal(s2.start, 2, '已有 chip 时紧跟其后再插（正文之前）')
    /* 多个 chip（"￼ ￼ hello"）→ 紧跟最后一个 chip */
    const s3 = b.controller.frontInsertSpan({ state: { getSnapshot: () => ({ occurrences: [{ source: '文件', offset: 0 }, { source: '文件', offset: 2 }], draft: '￼ ￼ hello', draftRev: 3 }) } })
    assert.equal(s3.start, 4, '紧跟最后一个 chip 之后')
    /* 其它来源（非本插件）不参与：仍插最前 */
    const s4 = b.controller.frontInsertSpan({ state: { getSnapshot: () => ({ occurrences: [{ source: '其它', offset: 0 }], draft: '￼ hello', draftRev: 4 }) } })
    assert.equal(s4.start, 0, '只看本插件 chip')
});

test('chip 位置：addNonImage 在输入框已有文字时调用 insertReference 于最前位置', async () => {
    const calls = []
    const b = bootClient({
        sandbox: {
            FileReader: class {
                onerror = null
                onload = null
                readAsDataURL(file) {
                    /* 模拟 readAsDataURL：'x' → data:application/octet-stream;base64,eA== */
                    if (this.onload) this.onload({ target: { result: 'data:application/octet-stream;base64,' + Buffer.from('x').toString('base64') } })
                    else this.onerror({ message: 'no onload' })
                }
            },
        },
        fetch: (url) => {
            const u = String(url || '')
            if (u.indexOf('/api/omnifile/config') >= 0) return Promise.resolve({ json: async () => ({ ok: true, limits: { maxFileBytes: 52428800, maxBatchImages: 20, progressPollMs: 40 } }) })
            if (u.indexOf('/api/omnifile/save') >= 0) return Promise.resolve({ json: async () => ({ ok: true, path: 'C:/u/1.save', kind: 'doc', size: 12 }) })
            if (u.indexOf('/api/omnifile/process') >= 0) return Promise.resolve({ json: async () => ({ ok: true, kind: 'doc', parsedPath: 'C:/u/1.md' }) })
            if (u.indexOf('/api/omnifile/status') >= 0) return Promise.resolve({ json: async () => ({ ok: true, progress: null }) })
            return Promise.resolve({ json: async () => ({ ok: false }) })
        },
    })
    let snap = { occurrences: [{ ref: 'old', source: '文件', occurrenceId: 'o0', offset: 0 }], draft: '￼ 已有正文', draftRev: 9, phase: 'plain' }
    const customInput = {
        notify() {},
        notices: { set() {} },
        state: { getSnapshot: () => snap },
        insertReference(ref, span) {
            calls.push({ ref: ref.ref, start: span.start, end: span.end })
            snap = { ...snap, draft: '￼ ￼ 已有正文', draftRev: snap.draftRev + 1, occurrences: [...snap.occurrences, { ref: ref.ref, source: '文件', occurrenceId: 'o' + snap.occurrences.length, offset: span.start }] }
            return true
        },
        addImages() {},
    }
    b.controller.ctx.get = (k) => {
        if (k === 'conversation') return { input: { for: () => customInput } }
        if (k === 'sessions') return { scope: () => ({}) }
        return undefined
    }
    await b.controller.addNonImage('s1', customInput, new File(['x'], '报告.txt', { type: 'text/plain' }))
    assert.equal(calls.length, 1, 'insertReference 被调用一次')
    /* 已有 chip @0（offset=0），正文从第 2 字符开始 → 新 chip 插在 offset=2（紧跟 chip、正文之前） */
    assert.equal(calls[0].start, 2, '输入框已有文字时 chip 插到最前（正文之前）')
});

test('chip 位置：输入框只有文字（无 chip）时上传 → insertReference 于 start=0（最前）', async () => {
    const calls = []
    const b = bootClient({
        sandbox: {
            FileReader: class {
                onerror = null
                onload = null
                readAsDataURL() { if (this.onload) this.onload({ target: { result: 'data:application/octet-stream;base64,eA==' } }); else this.onerror({ message: 'no onload' }) }
            },
        },
        fetch: (url) => {
            const u = String(url || '')
            if (u.indexOf('/api/omnifile/config') >= 0) return Promise.resolve({ json: async () => ({ ok: true, limits: { maxFileBytes: 52428800, maxBatchImages: 20, progressPollMs: 40 } }) })
            if (u.indexOf('/api/omnifile/save') >= 0) return Promise.resolve({ json: async () => ({ ok: true, path: 'C:/u/9.save', kind: 'text', size: 5 }) })
            if (u.indexOf('/api/omnifile/process') >= 0) return Promise.resolve({ json: async () => ({ ok: true, kind: 'text', parsedPath: 'C:/u/9.md' }) })
            if (u.indexOf('/api/omnifile/status') >= 0) return Promise.resolve({ json: async () => ({ ok: true, progress: null }) })
            return Promise.resolve({ json: async () => ({ ok: false }) })
        },
    })
    let snap = { occurrences: [], draft: '我已经输入了一些文字内容', draftRev: 3, phase: 'plain' }
    const customInput = {
        notify() {},
        notices: { set() {} },
        state: { getSnapshot: () => snap },
        insertReference(ref, span) {
            calls.push({ ref: ref.ref, start: span.start, end: span.end, draftRev: span.draftRev })
            snap = { ...snap, draft: '￼ ' + snap.draft, draftRev: snap.draftRev + 1, occurrences: [{ ref: ref.ref, source: '文件', occurrenceId: 'o1', offset: span.start }] }
            return true
        },
        addImages() {},
    }
    b.controller.ctx.get = (k) => {
        if (k === 'conversation') return { input: { for: () => customInput } }
        if (k === 'sessions') return { scope: () => ({}) }
        return undefined
    }
    await b.controller.addNonImage('s1', customInput, new File(['y'], '说明.txt', { type: 'text/plain' }))
    assert.equal(calls.length, 1, 'insertReference 被调用一次')
    assert.equal(calls[0].start, 0, '输入框只有文字时 chip 插到最前（start=0）')
    assert.equal(calls[0].end, 0, 'end=start')
    assert.equal(calls[0].draftRev, 3, '使用读取时的 draftRev 做 CAS')
});
