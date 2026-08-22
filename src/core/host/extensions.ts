/**
 * 文件类别判定：按扩展名 / anydoc 支持识别文件类型（image/doc/text/media/other）。
 */
import { formatFromPath } from '@firecrawl/anydoc'
import { extname } from 'node:path'
import { KIND_IMAGE, KIND_DOC, KIND_TEXT, KIND_MEDIA, KIND_OTHER } from '../index.js'

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.svg', '.avif'])
/* anydoc 支持格式（权威来源 = anydoc 的 formatFromPath）：
 * doc/docx/odt/pdf/ppt/pptx/rtf/epub/xlsx/ods/odp/csv 及其容器变体（docm/xlsm/ppsx...）。 */
const TEXT_EXTENSIONS = new Set(['.json', '.txt', '.md', '.html', '.shtml'])
const MEDIA_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac', '.wma', '.mp4', '.mkv', '.webm', '.mov', '.avi', '.flv', '.wmv', '.m4v', '.mpg', '.mpeg', '.3gp', '.ts'])
const MIME_BY_EXT: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
    '.gif': 'image/gif', '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.avif': 'image/avif',
}
/* 兜底扩展名集（仅当 formatFromPath 不可用时使用；与 anydoc Format 枚举一致） */
const DOC_EXTENSIONS_FALLBACK = new Set(['.doc', '.docx', '.docm', '.ppt', '.pps', '.pot', '.pptx', '.pptm', '.ppsx', '.ppsm', '.xls', '.xlsx', '.xlsm', '.xlsb', '.odt', '.ods', '.odp', '.rtf', '.epub', '.csv', '.pdf'])

function fileKind(name: string): string {
    const ext = extname(name).toLowerCase()
    if (IMAGE_EXTENSIONS.has(ext)) return KIND_IMAGE
    /* doc 判定以 anydoc 的 formatFromPath 为唯一权威：返回非 null 即 anydoc 支持 */
    if (typeof formatFromPath === 'function') {
        try {
            if (formatFromPath(name) !== null) return KIND_DOC
        } catch { /* 忽略，走其余分类 */ }
    }
    if (DOC_EXTENSIONS_FALLBACK.has(ext)) return KIND_DOC
    if (TEXT_EXTENSIONS.has(ext)) return KIND_TEXT
    if (MEDIA_EXTENSIONS.has(ext)) return KIND_MEDIA
    return KIND_OTHER
}

function mimeFor(path: string): string {
    const ext = extname(path).toLowerCase()
    return MIME_BY_EXT[ext] ?? 'application/octet-stream'
}

export { IMAGE_EXTENSIONS, TEXT_EXTENSIONS, MEDIA_EXTENSIONS, DOC_EXTENSIONS_FALLBACK, MIME_BY_EXT, fileKind, mimeFor }
