/** 统计字符串中的替换字符（U+FFFD）个数。 */
declare function countReplacement(text: string): number;
/** 用 TextDecoder 解码（label 不可用时返回 null，由调用方降级）。 */
declare function decodeWith(label: string, bytes: Uint8Array): string | null;
/** UTF-32 手工解码（Node 的 TextDecoder 不支持 utf-32le/utf-32be）：
 *  按 4 字节一码点解析，LE/BE 由 be 决定；代理区/超范围码点用 U+FFFD 占位。 */
declare function utf32Decode(bytes: Uint8Array, be: boolean): string;
/**
 * 无 BOM 的 UTF-16 检测：统计 2 字节单元里 NUL 字节的奇/偶对齐。
 *  - UTF-16LE：ASCII 字符编码为 [低位, 0x00]，NUL 落在奇数位；
 *  - UTF-16BE：ASCII 字符编码为 [0x00, 高位]，NUL 落在偶数位；
 *  - 严格模式要求 ≥8 个可打印 ASCII 对且对齐占比 ≥80%，避免误伤 UTF-8/GBK 文本；
 *  - 检测到即按 UTF-16 解码（如 Windows 记事本之外的工具产生的无 BOM UTF-16 文本）。
 */
declare function tryUtf16NoBom(bytes: Uint8Array): string | null;
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
declare function decodeText(bytes: Uint8Array): string;
/** 极简 HTML → 可读文本：去掉 script/style，剥标签，还原常用实体并收拢空白。 */
declare function htmlToText(raw: unknown): string;
/** 截断长文本：超出 maxChars 时追加可读提示，返回 {body, truncated}。 */
declare function truncateLong(raw: unknown, maxChars: number): {
    body: string;
    truncated: boolean;
};
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
declare function isBinaryish(bytes: Uint8Array, decoded?: string): boolean;
/**
 * 解析纯文本格式（json/txt/md/html/shtml）：直接解码为文字，不经过 anydoc。
 * JSON 尝试美化（未压缩时更易读）；HTML 剥标签。
 */
declare function processText(ctx: any, cfg: Record<string, any>, cwd: string, filePath: string, fileName: string): Promise<{
    markdown: string;
    images: never[];
    truncated: boolean;
}>;
export { countReplacement, decodeWith, utf32Decode, tryUtf16NoBom, decodeText, htmlToText, truncateLong, isBinaryish, processText, };
