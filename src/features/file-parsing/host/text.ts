/**
 * 纯文本处理：解码（多编码）、二进制检测、HTML 剥离、截断与 processText。
 */
import fs from 'node:fs/promises'
import { extname } from 'node:path'
import { docChars } from '../../../core/host/config.js'

/** 统计字符串中的替换字符（U+FFFD）个数。 */
function countReplacement(text: string): number {
    return (text.match(/\uFFFD/g) || []).length
}

/** 用 TextDecoder 解码（label 不可用时返回 null，由调用方降级）。 */
function decodeWith(label: string, bytes: Uint8Array): string | null {
    try {
        return new TextDecoder(label).decode(bytes)
    } catch {
        return null
    }
}

/** UTF-32 手工解码（Node 的 TextDecoder 不支持 utf-32le/utf-32be）：
 *  按 4 字节一码点解析，LE/BE 由 be 决定；代理区/超范围码点用 U+FFFD 占位。 */
function utf32Decode(bytes: Uint8Array, be: boolean): string {
    let out = ''
    for (let i = 0; i + 3 < bytes.length; i += 4) {
        const cp = be
            ? ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0
            : ((bytes[i + 3] << 24) | (bytes[i + 2] << 16) | (bytes[i + 1] << 8) | bytes[i]) >>> 0
        if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
            out += '\ufffd'
        } else if (cp <= 0xffff) {
            out += String.fromCharCode(cp)
        } else {
            const v = cp - 0x10000
            out += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff))
        }
    }
    return out
}

/**
 * 无 BOM 的 UTF-16 检测：统计 2 字节单元里 NUL 字节的奇/偶对齐。
 *  - UTF-16LE：ASCII 字符编码为 [低位, 0x00]，NUL 落在奇数位；
 *  - UTF-16BE：ASCII 字符编码为 [0x00, 高位]，NUL 落在偶数位；
 *  - 严格模式要求 ≥8 个可打印 ASCII 对且对齐占比 ≥80%，避免误伤 UTF-8/GBK 文本；
 *  - 检测到即按 UTF-16 解码（如 Windows 记事本之外的工具产生的无 BOM UTF-16 文本）。
 */
function tryUtf16NoBom(bytes: Uint8Array): string | null {
    const len = bytes.length
    if (len < 4 || len % 2 !== 0) return null
    const sample = Math.min(len, 16384)
    let asciiPairs = 0
    let evenNull = 0 /* [c, 0x00]：UTF-16BE 的 ASCII */
    let oddNull = 0  /* [0x00, c]：UTF-16LE 的 ASCII */
    const isAsciiChar = (b: number) => (b >= 0x20 && b <= 0x7e) || b === 0x09 || b === 0x0a || b === 0x0d
    for (let i = 0; i + 1 < sample; i += 2) {
        const a = bytes[i]
        const b = bytes[i + 1]
        const aAscii = isAsciiChar(a)
        const bAscii = isAsciiChar(b)
        if (!aAscii && !bAscii) continue
        asciiPairs += 1
        if (b === 0 && aAscii) evenNull += 1
        if (a === 0 && bAscii) oddNull += 1
    }
    if (asciiPairs < 8) return null
    if (evenNull / asciiPairs >= 0.8) {
        const le = decodeWith('utf-16le', bytes)
        if (le !== null) return le
    }
    if (oddNull / asciiPairs >= 0.8) {
        const be = decodeWith('utf-16be', bytes)
        if (be !== null) return be
    }
    return null
}

/**
 * 将文件字节解码为文本。按 BOM 优先识别编码，避免把文本误判为二进制：
 *  - UTF-8 BOM（EF BB BF）→ 去 BOM 后按 UTF-8；
 *  - UTF-16 LE/BE BOM（FF FE / FE FF）→ Windows 记事本「Unicode」保存的 txt 即 UTF-16 LE，
 *    这类文件若按 UTF-8 解码会出现大量 NUL/替换字符而被误判为二进制；
 *  - UTF-32 LE/BE BOM（FF FE 00 00 / 00 00 FE FF）→ 手工 4 字节解码（TextDecoder 不支持 utf-32）；
 *  - 无 BOM：先按字节奇偶 NUL 分布识别 UTF-16（英文/数字/符号为主的无 BOM UTF-16 文本常见），
 *    再 UTF-8 优先，替换字符过多时回退 GB18030（GBK/GB18030 是中文 Windows 常见纯文本编码，
 *    TextDecoder('gb18030') 是 Node 内置能力）。
 */
function decodeText(bytes: Uint8Array): string {
    if (bytes.length === 0) return ''
    /* UTF-8 BOM */
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
        return Buffer.from(bytes.subarray(3)).toString('utf8')
    }
    /* UTF-32 LE/BE BOM */
    if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xfe && bytes[2] === 0x00 && bytes[3] === 0x00) {
        return utf32Decode(bytes.subarray(4), false)
    }
    if (bytes.length >= 4 && bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0xfe && bytes[3] === 0xff) {
        return utf32Decode(bytes.subarray(4), true)
    }
    /* UTF-16 LE/BE BOM */
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
        const s = decodeWith('utf-16le', bytes.subarray(2))
        if (s !== null) return s
    }
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
        const s = decodeWith('utf-16be', bytes.subarray(2))
        if (s !== null) return s
    }
    /* 无 BOM：先识别无 BOM 的 UTF-16（修复“英文 UTF-16 无 BOM 被 NUL 误判为二进制”） */
    const noBom16 = tryUtf16NoBom(bytes)
    if (noBom16 !== null) return noBom16
    /* UTF-8 优先 */
    const utf8 = Buffer.from(bytes).toString('utf8')
    const badCount = countReplacement(utf8)
    if (badCount === 0) return utf8
    /* GB18030 兜底（GBK/GB18030 是中文 Windows 常见纯文本编码） */
    try {
        const gbk = new TextDecoder('gb18030').decode(bytes)
        if (countReplacement(gbk) < badCount) return gbk
    } catch { /* TextDecoder 不可用时保留 UTF-8 结果 */ }
    return utf8
}

/** 极简 HTML → 可读文本：去掉 script/style，剥标签，还原常用实体并收拢空白。 */
function htmlToText(raw: unknown): string {
    return String(raw || '')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|h[1-6]|li|tr|table|section|article)>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}

/** 截断长文本：超出 maxChars 时追加可读提示，返回 {body, truncated}。 */
function truncateLong(raw: unknown, maxChars: number): { body: string; truncated: boolean } {
    const text = String(raw ?? '')
    const max = Math.max(1, Number(maxChars) || 120000)
    if (text.length <= max) return { body: text, truncated: false }
    return {
        body: text.slice(0, max) + '\n\n...（内容过长，已截断，原文共 ' + text.length + ' 字符）',
        truncated: true,
    }
}

/**
 * 判断文件内容是否更像二进制而非文本。
 * 修复说明：旧实现直接统计原始字节的“控制字符”占比（byte > 0x7e && byte < 0xa0），
 * 会把 UTF-8 多字节中文（连续字节常落在 0x80-0x9F）以及带有任意单个 NUL 的文本误判为二进制。
 * 新实现以「解码后的文本」为主判据：
 *  - 任何单个 NUL 不再一票否决（UTF-16 解码错误产生的 NUL 会体现在控制字符占比上）；
 *  - 控制字符（C0 除 \t\n\r\f\v、DEL、C1 0x80-0x9F）在解码文本中占比过高才判二进制；
 *  - 替换字符（U+FFFD）占比过高（编码完全不匹配）判二进制；
 *  - 解码为空/不可用时退回按原始字节 NUL 占比判断。
 */
function isBinaryish(bytes: Uint8Array, decoded?: string): boolean {
    if (bytes.length === 0) return false
    if (typeof decoded === 'string' && decoded !== '') {
        const sample = decoded.slice(0, 8192)
        let control = 0
        for (const ch of sample) {
            const code = ch.codePointAt(0) ?? 0
            if (code === 0) { control += 1 } // NUL（UTF-16 解错的典型特征）
            else if (code < 0x09) { control += 1 } // 0x00-0x08
            else if (code > 0x0d && code < 0x20) { control += 1 } // 0x0e-0x1f
            else if (code >= 0x7f && code < 0xa0) { control += 1 } // DEL + C1 控制
        }
        if (sample.length > 0 && control / sample.length > 0.3) return true
        const bad = (decoded.match(/\uFFFD/g) || []).length
        if (decoded.length > 0 && bad / decoded.length > 0.1) return true
        return false
    }
    /* 解码失败/空：退回原始字节 NUL 占比判断 */
    const sampleBytes = bytes.subarray(0, Math.min(bytes.length, 8192))
    let nuls = 0
    for (const byte of sampleBytes) if (byte === 0) nuls += 1
    return sampleBytes.length > 0 && nuls / sampleBytes.length > 0.3
}

/**
 * 解析纯文本格式（json/txt/md/html/shtml）：直接解码为文字，不经过 anydoc。
 * JSON 尝试美化（未压缩时更易读）；HTML 剥标签。
 */
async function processText(ctx: any, cfg: Record<string, any>, cwd: string, filePath: string, fileName: string): Promise<{ markdown: string; images: never[]; truncated: boolean }> {
    const bytes = await fs.readFile(filePath)
    const ext = extname(fileName || filePath).toLowerCase()
    let raw = decodeText(bytes)
    // 二进制检测：基于解码后的文本判断（UTF-8/GBK/UTF-16 的原始字节不能当控制字符统计）
    if (isBinaryish(bytes, raw)) {
        throw new Error('该文件不是文本文件（检测到二进制内容）')
    }
    if (ext === '.json') {
        try {
            const parsed = JSON.parse(raw)
            raw = JSON.stringify(parsed, null, 2)
        } catch { /* 非严格 JSON 保持原样 */ }
    } else if (ext === '.html' || ext === '.shtml') {
        raw = htmlToText(raw)
        if (raw === '') raw = decodeText(bytes)
    }
    const { body, truncated } = truncateLong(raw, docChars(cfg))
    return { markdown: body, images: [], truncated }
}

export {
    countReplacement, decodeWith, utf32Decode, tryUtf16NoBom, decodeText,
    htmlToText, truncateLong, isBinaryish, processText,
}
