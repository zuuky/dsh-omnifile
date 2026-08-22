/**
 * dsh-omnifile 文件解析（file-parsing）功能块回归测试（node:test）
 * 运行：node --test test/file-parsing.test.mjs
 *
 * 覆盖：纯文本解码（多编码）与二进制检测——中文 UTF-8/GBK/UTF-16（含无 BOM）、
 *       UTF-32，以及真实二进制样本。实现位于 features/file-parsing/host/text.ts。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadTextUtils } from './helpers.mjs'

/* ============ 1. 二进制检测修复（#2）：文本不误判、二进制不放过 ============ */
test('二进制检测：中文 UTF-8 / GBK / UTF-16 文本不再被误判为二进制', () => {
    const { decodeText, isBinaryish } = loadTextUtils()
    /* UTF-8 中文（旧逻辑会因连续字节落在 0x80-0x9F 被误判） */
    const utf8 = Buffer.from('这是一个中文字符串测试，包含标点符号！Hello 123。', 'utf8')
    assert.equal(isBinaryish(utf8, decodeText(utf8)), false, 'UTF-8 中文不判二进制')
    /* GBK 中文 */
    const gbk = Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0xce, 0xc4, 0xbc, 0xfe, 0xc4, 0xda, 0xc8, 0xdd, 0xb2, 0xe2, 0xca, 0xd4, 0xa3, 0xac, 0xba, 0xac, 0xb1, 0xea, 0xb5, 0xe3, 0xb7, 0xfb, 0xba, 0xc5, 0xa3, 0xa1, 0x31, 0x32, 0x33, 0x41, 0x42, 0x43])
    assert.ok(new TextDecoder('gb18030').decode(gbk).includes('中文文件内容测试'), 'GBK 样本可解')
    assert.equal(isBinaryish(gbk, decodeText(gbk)), false, 'GBK 中文不判二进制')
    /* UTF-16 LE（Windows 记事本「Unicode」）：BOM FF FE */
    const utf16le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Unicode 中文文本测试 file.', 'utf16le')])
    assert.ok(decodeText(utf16le).includes('Unicode 中文文本测试'), 'UTF-16 LE 解码成功')
    assert.equal(isBinaryish(utf16le, decodeText(utf16le)), false, 'UTF-16 LE 文本不判二进制')
    /* UTF-16 BE：BOM FE FF */
    const beBody = []
    for (const c of 'Unicode BE test 文本。') { const n = c.codePointAt(0); beBody.push(n >> 8, n & 0xff) }
    const utf16be = Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(beBody)])
    assert.ok(decodeText(utf16be).includes('Unicode BE test'), 'UTF-16 BE 解码成功')
    assert.equal(isBinaryish(utf16be, decodeText(utf16be)), false, 'UTF-16 BE 文本不判二进制')
    /* 纯 ASCII 文本 */
    assert.equal(isBinaryish(Buffer.from('pure ascii text 12345', 'ascii'), decodeText(Buffer.from('pure ascii text 12345', 'ascii'))), false, '纯 ASCII 不判二进制')
    /* 单个 NUL 不再一票否决（打磨/填充数据） */
    const withNul = Buffer.concat([Buffer.from('hello world', 'ascii'), Buffer.from([0x00]), Buffer.from(' tail', 'ascii')])
    assert.equal(isBinaryish(withNul, decodeText(withNul)), false, '单个 NUL 不判二进制')
})

test('二进制检测：#2 修复——无 BOM 的 UTF-16 文本不再误判为二进制', () => {
    const { decodeText, isBinaryish } = loadTextUtils()
    /* UTF-16 LE 无 BOM（英文/数字为主）：旧/现逻辑会把每两个字符出现一次的 NUL 当控制字符 → 误判二进制 */
    const en = 'Hello world, this is a UTF-16LE file without BOM. Line 2 here. Numbers 12345.'
    const utf16leNoBom = Buffer.from(en, 'utf16le')
    const dec1 = decodeText(utf16leNoBom)
    assert.equal(dec1, en, 'UTF-16LE 无 BOM 正确解码')
    assert.equal(isBinaryish(utf16leNoBom, dec1), false, 'UTF-16LE 无 BOM 不判二进制')

    /* UTF-16 BE 无 BOM */
    const beText = 'UTF-16BE no BOM sample text 2024'
    const beNoBom = []
    for (const c of beText) { const n = c.codePointAt(0); beNoBom.push(n >> 8, n & 0xff) }
    const utf16beNoBom = Buffer.from(beNoBom)
    const dec2 = decodeText(utf16beNoBom)
    assert.equal(dec2, beText, 'UTF-16BE 无 BOM 正确解码')
    assert.equal(isBinaryish(utf16beNoBom, dec2), false, 'UTF-16BE 无 BOM 不判二进制')
})

test('二进制检测：UTF-32 BOM 文本正确解码且不判二进制', () => {
    const { decodeText, isBinaryish } = loadTextUtils()
    const utf32leText = 'Test UTF-32 文本 sample。'
    const leBytes = []
    for (const c of utf32leText) { const n = c.codePointAt(0); leBytes.push(n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff) }
    const utf32le = Buffer.concat([Buffer.from([0xff, 0xfe, 0x00, 0x00]), Buffer.from(leBytes)])
    assert.ok(decodeText(utf32le).includes('Test UTF-32'), 'UTF-32LE BOM 解码成功')
    assert.equal(isBinaryish(utf32le, decodeText(utf32le)), false, 'UTF-32LE BOM 不判二进制')

    const be32 = []
    for (const c of 'UTF32BE sample') { const n = c.codePointAt(0); be32.push((n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff) }
    const utf32be = Buffer.concat([Buffer.from([0x00, 0x00, 0xfe, 0xff]), Buffer.from(be32)])
    assert.ok(decodeText(utf32be).includes('UTF32BE'), 'UTF-32BE BOM 解码成功')
    assert.equal(isBinaryish(utf32be, decodeText(utf32be)), false, 'UTF-32BE BOM 不判二进制')
})

test('二进制检测：真实二进制仍被正确识别', () => {
    const { decodeText, isBinaryish } = loadTextUtils()
    /* 随机字节（含控制/替换字符） */
    const rand = Buffer.alloc(1024)
    for (let i = 0; i < 1024; i++) rand[i] = (i * 37 + 11) % 256
    assert.equal(isBinaryish(rand, decodeText(rand)), true, '随机字节判二进制')
    /* PNG 签名文件 */
    const png = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.from([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]),
        Buffer.from([0x08, 0x06, 0x00]),
    ])
    assert.equal(isBinaryish(png, decodeText(png)), true, 'PNG 判二进制')
    /* 全零填充 */
    assert.equal(isBinaryish(Buffer.alloc(2048, 0), decodeText(Buffer.alloc(2048, 0))), true, '全零判二进制')
    /* 空文件 */
    assert.equal(isBinaryish(Buffer.alloc(0), decodeText(Buffer.alloc(0))), false, '空文件不算二进制')
})
