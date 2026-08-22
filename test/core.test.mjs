/**
 * dsh-omnifile 共享层（core/）回归测试（node:test）
 * 运行：node --test test/core.test.mjs
 *
 * 覆盖：
 *  - markers（消息标记组装/解析）：直接导入 lib/common.js（core 双端共用的构建产物）；
 *  - extensions（文件类别判定/扩展名→MIME）：从 lib/index.js 提取宿主实现做行为验证。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadExtensionUtils } from './helpers.mjs'
import {
    markerText, sourcePathOf,
    MARKER_PREFIX, MARKER_STATUS_OK, MARKER_STATUS_UNREADABLE, MARKER_STATUS_FAILED,
} from '../lib/common.js'

/* ============ 1. markers：标记组装 ============ */
test('markers：成功标记带「完整内容见上方文件卡片」与源文件回指', () => {
    const t = markerText('C:/w/uploads/报告.md', { ok: true, source: 'C:/w/报告.docx' })
    assert.ok(t.startsWith(MARKER_PREFIX + 'C:/w/uploads/报告.md'), '前缀 + 保存路径')
    assert.ok(t.includes('（' + MARKER_STATUS_OK), '成功状态词在括号内')
    assert.ok(t.includes('源文件：C:/w/报告.docx'), '携带源文件绝对路径回指')
});

test('markers：解析失败/不可读标记携带原因', () => {
    const failed = markerText('C:/w/a.pdf', { ok: false, note: '解析失败原因' })
    assert.ok(failed.startsWith(MARKER_PREFIX + 'C:/w/a.pdf'), '失败时保存路径为源路径')
    assert.ok(failed.includes('（' + MARKER_STATUS_FAILED + '：解析失败原因）'), '失败状态 + 原因')
    const unreadable = markerText('C:/w/b.bin', { note: '无法识别格式' })
    assert.ok(unreadable.includes('（' + MARKER_STATUS_UNREADABLE + '：无法识别格式）'), '不可读状态 + 原因')
    const defaultNote = markerText('C:/w/c.bin')
    assert.ok(defaultNote.includes('（' + MARKER_STATUS_UNREADABLE), '缺省为不可读状态')
});

test('markers：无/重复源文件时不附加回指', () => {
    const noSource = markerText('C:/w/x.md', { ok: true })
    assert.ok(!noSource.includes('源文件：'), '未给 source 不附加')
    const samePath = markerText('C:/w/x.md', { ok: true, source: 'C:/w/x.md' })
    assert.ok(!samePath.includes('源文件：'), '保存路径与源路径相同不附加')
});

/* ============ 2. markers：标记解析 ============ */
test('markers：sourcePathOf 从状态尾巴提取源文件路径', () => {
    assert.equal(sourcePathOf(MARKER_STATUS_OK + '；源文件：C:/w/报告.docx'), 'C:/w/报告.docx', '提取源文件')
    assert.equal(sourcePathOf(MARKER_STATUS_OK), undefined, '无源文件返回 undefined')
    assert.equal(sourcePathOf(''), undefined, '空尾巴返回 undefined')
    assert.equal(sourcePathOf(MARKER_STATUS_OK + '；源文件：   '), undefined, '空白源文件视为无')
});

/* ============ 3. extensions：文件类别判定 ============ */
test('extensions：图片扩展名判为 image 且 MIME 正确', () => {
    const { fileKind, mimeFor } = loadExtensionUtils()
    for (const ext of ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.svg', '.avif']) {
        assert.equal(fileKind('a' + ext), 'image', ext + ' 判为 image')
    }
    assert.equal(mimeFor('a.png'), 'image/png', 'png MIME')
    assert.equal(mimeFor('a.svg'), 'image/svg+xml', 'svg MIME')
});

test('extensions：文档扩展名判为 doc，未知扩展默认 other', () => {
    const { fileKind } = loadExtensionUtils()
    for (const ext of ['.docx', '.pdf', '.xlsx', '.pptx', '.odt', '.csv']) {
        assert.equal(fileKind('a' + ext), 'doc', ext + ' 判为 doc')
    }
    assert.equal(fileKind('a.bin'), 'other', '未知扩展判 other')
});

test('extensions：文本扩展名判为 text', () => {
    const { fileKind } = loadExtensionUtils()
    for (const ext of ['.json', '.txt', '.md', '.html', '.shtml']) {
        assert.equal(fileKind('a' + ext), 'text', ext + ' 判为 text')
    }
});
