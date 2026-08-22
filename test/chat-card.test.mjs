/**
 * dsh-omnifile 聊天文件卡片（chat-card）功能块回归测试（node:test）
 * 运行：node --test test/chat-card.test.mjs
 *
 * 覆盖：解析卡片 CSS 静态断言（全宽/限高滚动/pre 换行）、
 *       ParseBlock 渲染（单行 + 展开懒加载 + 滚动容器包裹 pre）。
 *       实现位于 features/chat-card/client/*（chat/parse/components/dom）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clientSrc, bootClient, el, els } from './helpers.mjs'

/* ============ 1. CSS / 常量静态断言 ============ */
test('CSS: 卡片全宽 + 展开限高滚动 + pre 强制换行', () => {
    assert.ok(clientSrc.indexOf('.omnifile-parse-block{box-sizing:border-box;display:flex;flex-direction:column;gap:4px;width:100%;min-width:0;}') >= 0, 'parse-block 全宽 width:100%')
    assert.ok(clientSrc.indexOf('.omnifile-chat-group{box-sizing:border-box;display:flex;flex-direction:column;gap:6px;width:100%;}') >= 0, 'chat-group 全宽')
    assert.ok(clientSrc.indexOf('.omnifile-parse-body{box-sizing:border-box;width:100%;min-width:0;max-height:360px;overflow-y:auto;overflow-x:hidden;') >= 0, 'parse-body 限高360+纵向滚动')
    assert.ok(clientSrc.indexOf('.omnifile-parse-pre{margin:0;padding:10px 12px;white-space:pre-wrap;overflow-wrap:anywhere;') >= 0, 'pre 强制换行')
    assert.ok(!/omnifile-parse-block\{[^}]*fit-content/.test(clientSrc), 'parse-block 无 fit-content')
    assert.ok(clientSrc.indexOf('.omnifile-chat-card{') >= 0, '文件卡片样式存在')
    assert.ok(clientSrc.indexOf('.omnifile-hidden-marker{display:none!important;}') >= 0, 'marker 隐藏样式存在')
})

/* ============ 2. 渲染：ParseBlock 单行 + 展开滚动容器 ============ */
test('渲染：ParseBlock 单行展开（滚动容器包裹 pre）', async () => {
    const b = bootClient({ fetch: () => Promise.resolve({ json: async () => ({ ok: true, limits: { maxFileBytes: 52428800, maxBatchImages: 20, progressPollMs: 40 }, parsedPath: 'C:/x/p.md' }) }) })
    const file = { name: '报告', kind: 'doc', path: 'C:/x/p.md', sourcePath: 'C:/x/p.docx' }
    let loaded = 0
    const loadParsed = () => { loaded++; return Promise.resolve('# 报告内容') }
    const before = b.elements.length
    b.chat({ sessionId: 's1', openPath: () => {}, loadParsed, node: { data: { files: [file] } } })
    const group = b.elements.slice(before).find((e) => e.props && e.props.className === 'omnifile-chat-group')
    const kids = Array.isArray(group.kids) && group.kids.length === 1 && Array.isArray(group.kids[0]) ? group.kids[0] : (group.kids || [])
    const pbEl = kids.find((k) => k && typeof k.type === 'function')
    assert.ok(pbEl, '找到 ParseBlock 函数组件')

    /* 收缩：单行卡片，无 parse-body */
    const f1 = b.elements.length
    b.renderComp(pbEl.type, pbEl.props)
    const r1 = b.elements.slice(f1)
    assert.equal(els(r1, 'omnifile-parse-row').length, 1, '单行')
    assert.equal(els(r1, 'omnifile-parse-body').length, 0, '收缩无内容区')

    /* 点击 → 展开 + 懒加载；flush 后出现滚动容器 */
    el(r1, 'omnifile-parse-row').props.onClick({ stopPropagation() {} })
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    const f2 = b.elements.length
    b.renderComp(pbEl.type, pbEl.props)
    const r2 = b.elements.slice(f2)
    const bodies = els(r2, 'omnifile-parse-body')
    assert.equal(bodies.length, 1, '展开出现 parse-body（限高滚动容器）')
    assert.ok(bodies[0].kids.some((k) => k && k.props && k.props.className === 'omnifile-parse-pre'), 'body 内包裹 pre')
    assert.equal(loaded, 1, '内容只加载一次')
})
