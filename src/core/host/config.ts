/**
 * 宿主配置：settings schema（Config）、默认常量与运行期可变限额。
 */
import z from '@deepseek-ai/schemastery'

/* 消息标记 / 源文件名引用 / 组装等双端共用元素统一来自 src/core
 * （唯一来源：改动 MARKER_* 或 markerText 时只需改 core，宿主与客户端自动一致）。 */
export const VARIANT_PREFIX = 'omnifile-'
export const VARIANT_SUFFIX = ' (Omnifile)'

/** 统一描述提示词兜底（describeImage / effectivePrompt / processDocument / convertBlocks 共用）。 */
export const DEFAULT_DESCRIBE_PROMPT = '请按要求描述这张图片。'

export const DESCRIBE_SYSTEM = [
    '你是图像识别助手。用户消息包含一张图片，请客观、详尽地描述它的全部内容，供一个无法查看图片的 AI 助手使用。要求：',
    '1. 完整转写图片中出现的所有文字（代码、报错、日志、界面文案等按原样转写，保留换行与缩进）。',
    '2. 描述界面布局、图表结构、颜色和其他显著视觉元素。',
    '3. 只陈述图片中可见的信息，不要推测或评价。',
    '使用与图片中文字相同的语言作答；图片没有文字时使用中文。',
].join('\n')

/** 请求 JSON body 上限（进程/状态/打开等小型请求用）；上传走 /save 按 maxFileBytes 单独放大。 */
export const MAX_REQUEST_BODY_BYTES = 8 * 1024 * 1024
/** base64 相对原始字节的体积膨胀系数（base64 长度 ≈ 字节数 × 4/3）。 */
export const BASE64_INFLATE = 4 / 3
/** /save 兜底的单文件上限（Config.maxFileBytes 缺省时使用）。 */
export const MAX_SAVE_FALLBACK_BYTES = 50 * 1024 * 1024

/** 文件名清洗后的默认最大长度（sanitizeName 截断用，apply 时按 cfg.maxNameChars 覆盖）。 */
let maxNameChars = 120
/** 多模态识图缓存默认条数（apply 时按 cfg.describeCacheMax 覆盖）。 */
let describeCacheMax = 300

/** 当前生效的文件名最大长度（字符）。 */
export function nameCharLimit(): number {
    return maxNameChars
}

/** 当前生效的识图缓存条数上限（LRU）。 */
export function describeCacheLimit(): number {
    return describeCacheMax
}

/** 把可配置上限同步到模块级可变常量（sanitizeName 与识图缓存宽度在配置变更后即时生效）。 */
export function syncRunLimits(cfg: Record<string, any>): void {
    maxNameChars = Math.max(8, Number(cfg.maxNameChars) || 120)
    describeCacheMax = Math.max(16, Number(cfg.describeCacheMax) || 300)
}

/* 多模态模型配置：仅供「设置-模型」（模型配置页面）选择，不保存多份模型配置。
 * providerRef 是所选模型的唯一引用，格式为 <设置命名空间>/<提供商>/<模型id>（与 /api/omnifile/models 返回的 ref 一致）； */
export const Config = z.object({
    providerRef: z.string().default('').description('「设置-模型」中选择的多模态模型引用（<命名空间>/<提供商>/<模型id>）'),
    reasoningEffort: z.string().default('medium').description('启用思考模式时发送的 reasoning_effort 值'),
    thinking: z.boolean().default(false).description('是否启用多模态模型的思考模式（默认禁止）'),
    describePrompt: z.string().default(DEFAULT_DESCRIBE_PROMPT).description('发送给多模态模型识图时的固定提问'),
    enableVariants: z.boolean().default(true).description('为文本-only 主模型注册 omnifile-* 图像变体提供商'),
    timeoutMs: z.number().default(60000).description('单次多模态调用的超时（毫秒）'),
    maxFileBytes: z.number().default(50 * 1024 * 1024).description('单个上传文件大小上限'),
    maxDocImages: z.number().default(8).description('单个文档最多交给多模态识别的内嵌图片数'),
    docMaxChars: z.number().default(120000).description('文档转 Markdown 后保留的最大字符数（超出部分截断）'),
    concurrency: z.number().default(1).description('调用多模态模型的并发数（默认 1）'),
    temperature: z.number().default(0.7).description('多模态模型采样温度（0-2，默认 0.7）'),
    topP: z.number().default(1).description('多模态模型 nucleus 采样 top_p（0-1）'),
    maxTokens: z.number().default(8192).description('多模态模型单次输出最大 token 数（默认 8192）'),
    /* 上限类参数（可在设置界面配置） */
    describeCacheMax: z.number().default(300).description('多模态识图结果缓存条数上限（LRU，默认 300）'),
    listMaxFiles: z.number().default(2000).description('@ 文件选择器最多列出工作区文件数（默认 2000）'),
    listMaxDepth: z.number().default(12).description('@ 文件选择器递归遍历最大深度（默认 12）'),
    maxNameChars: z.number().default(120).description('文件名清洗后的最大长度，字符（默认 120）'),
    maxBatchImages: z.number().default(20).description('一次粘贴/拖拽最多放入原生附件的图片数（客户端，默认 20）'),
    progressPollMs: z.number().default(400).description('解析进度轮询间隔，毫秒（客户端，默认 400）'),
})

/** 文档 Markdown 保留字符上限（cfg.docMaxChars 缺省 120000）。 */
export function docChars(cfg: Record<string, any>): number {
    return Math.max(1, Number(cfg?.docMaxChars) || 120000)
}

/** 单个文档交给多模态识别的内嵌图片/扫描页预算（显式传入优先，否则取 cfg.maxDocImages）。 */
export function imageBudget(cfg: Record<string, any>, override?: number): number {
    return typeof override === 'number' ? Math.max(0, override) : (cfg?.maxDocImages || 8)
}
