/**
 * dsh-omnifile 双端共用常量——唯一来源。
 * 改动消息标记（MARKER_*）/ 类别（KIND_*）时只改本文件，宿主与客户端自动一致。
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
