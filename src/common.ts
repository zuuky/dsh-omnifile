/**
 * dsh-omnifile 双端共用元素（常量 / 字符串 / 工具函数）——唯一来源。
 *
 * 两端如何拿到这份共用元素：
 *  - 宿主端 src/index.ts（Node ESM）：静态 import { ... } from './common.js'；
 *  - 浏览器端 src/client.ts：DSH 只把一个客户端 bundle（lib/client.js）交给浏览器，
 *    其中 require() 只能解析已注册模块、无法加载本文件的兄弟模块，所以由宿主在
 *    /api/omnifile/common.js 挂一个路由把本文件编译产物（lib/common.js）原文按 ESM 返回，
 *    client.ts 再 dynamic import('/api/omnifile/common.js') 拿到同一份导出。
 *
 * 约定：改动消息标记（MARKER_*）或 markerText 组装规则时，只改本文件，两端自动一致。
 */

/** 设置命名空间（宿主 settings 与客户端 /api 路径共用）。 */
export const NAMESPACE = 'omnifile'

/** 输入引用源名称（@ 文件选择器 / 序列化的 source 名）。 */
export const SOURCE = '文件'

/** 文件类别（宿主 fileKind 与客户端卡片/kinds 共用）。 */
export const KIND_IMAGE = 'image'
export const KIND_DOC = 'doc'
export const KIND_TEXT = 'text'
export const KIND_MEDIA = 'media'
export const KIND_OTHER = 'other'

/* ══════════════════════════════════════════════════════════════════
 * 消息标记（「解析后保存路径」）；宿主工具 execute 与客户端 serialize 同形，
 * 客户端 PARSE_RE 据此从消息正文提取文件卡片数据（改动需两端一致 → 本文件唯一来源）。
 *   成功：   解析后保存路径：<md绝对路径>（完整内容见上方文件卡片，可点击展开；源文件：<源绝对路径>）
 *   不可读： 解析后保存路径：<源路径>（无法按文本读取：<原因>）
 *   失败：   解析后保存路径：<源路径>（解析失败：<原因>）
 * ══════════════════════════════════════════════════════════════════ */
export const MARKER_PREFIX = '解析后保存路径：'
export const MARKER_STATUS_OK = '完整内容见上方文件卡片，可点击展开'
export const MARKER_STATUS_UNREADABLE = '无法按文本读取'
export const MARKER_STATUS_FAILED = '解析失败'
export const MARKER_UNKNOWN = '未知原因'
export const MARKER_SOURCE_TAG = '源文件：'

export interface MarkerOptions {
  /** true=成功；false=解析失败；字符串或缺省=该状态词（传 '无法按文本读取' 或略过 → 不可读）。 */
  ok?: boolean | string
  /** 状态后的原因说明（失败/不可读时）。 */
  note?: string
  /** 成功时附带的「源文件」绝对路径回指（与 path 不同才附加）。 */
  source?: string
}

/**
 * 组装「解析后保存路径」标记（两端共用）。
 * @param path - 保存路径（成功为 <uploads>/<源文件名>.md，失败/不可读为源路径）。
 * @param options - 见 {@link MarkerOptions}。
 * @returns 一行可读标记。
 */
export function markerText(path: string, options: MarkerOptions = {}): string {
    const p = String(path || '')
    const isOk = options.ok === true || options.ok === MARKER_STATUS_OK
    if (isOk) {
        const sourceTail = (typeof options.source === 'string' && options.source !== '' && options.source !== p)
            ? '；' + MARKER_SOURCE_TAG + options.source
            : ''
        return MARKER_PREFIX + p + '（' + MARKER_STATUS_OK + sourceTail + '）'
    }
    const status = options.ok === false
        ? MARKER_STATUS_FAILED
        : (typeof options.ok === 'string' && options.ok !== '' ? options.ok : MARKER_STATUS_UNREADABLE)
    const noteText = typeof options.note === 'string' && options.note !== '' ? '：' + options.note : ''
    return MARKER_PREFIX + p + '（' + status + noteText + '）'
}

/**
 * 从状态尾巴（如「完整内容见上方文件卡片，可点击展开；源文件：D:\x」）提取源文件绝对路径。
 * 没有「源文件：」则返回 undefined（客户端卡片/📂 按钮据此回指原始文件）。
 * @param statusTail - 括号内状态文本。
 * @returns 源文件绝对路径，未找到返回 undefined。
 */
export function sourcePathOf(statusTail: string | undefined): string | undefined {
    const at = String(statusTail || '').indexOf(MARKER_SOURCE_TAG)
    if (at < 0) return undefined
    const value = String(statusTail).slice(at + MARKER_SOURCE_TAG.length).trim()
    return value === '' ? undefined : value
}

/** 提取错误的可读消息（Promise reject / try-catch 通用）。 */
export function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}
