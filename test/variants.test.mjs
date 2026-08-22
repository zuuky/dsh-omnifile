/**
 * dsh-omnifile 文本模型变体（variants）功能块回归测试（node:test）
 * 运行：node --test test/variants.test.mjs
 *
 * 覆盖：lastUserQuestion（发送时取最新用户问题作为识图上下文）、
 *       识图提示词拼接（带问题/不带问题）。实现位于 features/variants/host/index.ts。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { indexSrc, extractFn } from './helpers.mjs'

/* ============ 1. lastUserQuestion：取最新用户文本问题 ============ */
test('宿主 lastUserQuestion：取最新用户文本问题', () => {
    const src = extractFn(indexSrc, 'function lastUserQuestion')
    assert.ok(src, '提取到函数源码')
    const f = eval('(' + src + ')')
    assert.equal(f([{ role: 'assistant', content: 'x' }, { role: 'user', content: [{ type: 'image_url' }, { type: 'text', text: ' 图里增长率？ ' }] }]), '图里增长率？', 'block 结构取文本')
    assert.equal(f([{ role: 'user', content: '直接问题' }]), '直接问题', '字符串内容')
    assert.equal(f([{ role: 'user', content: [{ type: 'image_url' }] }, { role: 'user', content: '更早问题' }]), '更早问题', '跳过无文本 user')
    assert.equal(f([{ role: 'assistant', content: 'x' }]), '', '无问题返回空')
})

/* ============ 2. 识图提示词拼接：带问题/无问题 ============ */
test('识图提示词拼接：带问题/无问题', () => {
    const pStart = indexSrc.indexOf('const basePrompt = cfg.describePrompt')
    const pEnd = indexSrc.indexOf('const description', pStart)
    let chunk = indexSrc.slice(pStart, pEnd).replace(/\r/g, '').replace('const describePrompt', 'result')
    const make = eval('(function (cfg, question, DEFAULT_DESCRIBE_PROMPT) { let result; ' + chunk + '; return result; })')
    const base = '请按要求描述这张图片。'
    const wq = make({ describePrompt: base }, '  图里增长率？  ', base)
    assert.ok(wq.includes('用户的问题是：「图里增长率？」'), '带问题包含用户问题')
    assert.equal(make({ describePrompt: base }, '', base), base, '无问题仅基础提示')
})
