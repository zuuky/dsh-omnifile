/**
 * dsh-omnifile — 文件适配插件（Host 端）
 *
 * 整合 dsh-file-upload / dsh-plugin-anydoc / dsh-vision-toolkit：
 * 1. POST  /api/omnifile/save     保存浏览器上传的本地文件到会话 uploads/，返回绝对路径
 * 2. POST  /api/omnifile/process  解析文件（anydoc 文档 / 纯文本直读 / 支持格式分类），并落盘解析结果（可选 token 上报进度）
 * 3. GET   /api/omnifile/status   按 token 查询处理实时进度（客户端轮询，多模态识别期间显示阶段）
 * 4. POST  /api/omnifile/open     用本地默认程序打开文件（预览）
 * 5. GET   /api/omnifile/parsed   按保存路径返回解析结果全文（<uploads>/<源文件名>.md，折叠卡片懒加载用）
 * 6. GET   /api/omnifile/models   枚举「设置-模型」已配置且支持 image 的提供商/模型（供设置页下拉点选）
 * 7. GET   /api/omnifile/list     递归列出会话工作区内文件（仅文件），供输入框 @ 文件选择器使用
 * 8. 变体提供商 omnifile-<upstream>：把文本-only 主模型的图片块改写为多模态模型生成的文字描述（wire-only）
 * 9. 注册 omnifile 工具：主模型可自行解析本地文件
 * 10. 解析结果统一落盘为 <uploads>/<源文件名>.md（保持原名+`.md`），消息标记的保存路径即该 md
 *     绝对路径，方便大模型直接对保存路径触发 read 工具获取解析内容。
 *
 * 同一张图片（内容哈希相同）+ 同一提示词 + 同一端点只调用一次多模态模型（内容哈希 LRU 缓存），
 * 避免对话历史每轮重放、工具重复识别造成的多次多模态调用。
 *
 * 多模态模型采用 OpenAI 兼容 chat/completions 协议，配置位于 settings 的 omnifile 命名空间。
 */

import {defineTool} from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import {formatFromPath, toDocument, toMarkdown, toMarkdownBytes} from '@firecrawl/anydoc'
import fs from 'node:fs/promises'
import {createHash, randomUUID} from 'node:crypto'
import {basename, extname, join, resolve, sep} from 'node:path'
import {spawn} from 'node:child_process'
import {contentHasImage, LlmAdapter} from '@deepseek-ai/dsh-llm'
import {credentialRef} from '@deepseek-ai/dsh-credentials'

export const name = 'dsh-omnifile'
export const inject = ['webServer', 'sessions', 'tools', 'settings', 'credentials', 'llm']

const NAMESPACE = 'omnifile'
const VARIANT_PREFIX = 'omnifile-'
const VARIANT_SUFFIX = ' (Omnifile)'

/* ════════════════════════════════════════════════════════════════════════
 * 统一常量与公共方法（Req4：公共字符串/中文文案/组装/渲染集中收拢，避免改不全）。
 * 注意：客户端 lib/client.js 无法 import 宿主模块，其中的「消息标记」与 UI 文案
 * 与这里各存一份，改动本块下方 MARKER_* 时需同步改 client.js 对应常量。
 * ════════════════════════════════════════════════════════════════════════ */
/** 日志前缀（所有 console / logger 输出统一前缀）。 */
const LOG_PREFIX = '[dsh-omnifile]'
/** 无会话工作目录的错误文案（sessionCwd / agentCwd 共用）。 */
const ERR_NO_CWD = '当前会话没有工作目录'
/** 请求 JSON body 上限（进程/状态/打开等小型请求用）；上传走 /save 按 maxFileBytes 单独放大。 */
const MAX_REQUEST_BODY_BYTES = 8 * 1024 * 1024
/** base64 相对原始字节的体积膨胀系数（base64 长度 ≈ 字节数 × 4/3）。 */
const BASE64_INFLATE = 4 / 3
/** /save 兜底的单文件上限（Config.maxFileBytes 缺省时使用）。 */
const MAX_SAVE_FALLBACK_BYTES = 50 * 1024 * 1024
/** 统一描述提示词兜底（describeImage / effectivePrompt / processDocument / convertBlocks 共用）。 */
const DEFAULT_DESCRIBE_PROMPT = '请按要求描述这张图片。'
/** 文件名清洗后的默认最大长度（sanitizeName 截断用，apply 时按 cfg.maxNameChars 覆盖）。 */
let MAX_NAME_CHARS = 120
/** 多模态识图缓存默认条数（apply 时按 cfg.describeCacheMax 覆盖）。 */
let DESCRIBE_CACHE_MAX = 300

/* 「解析后保存路径」消息标记（宿主工具 execute 与客户端 serialize 同形；客户端 PARSE_RE 解析）：
 *   成功：   解析后保存路径：<md绝对路径>（完整内容见上方文件卡片，可点击展开；源文件：<源绝对路径>）
 *   不可读： 解析后保存路径：<源路径>（无法按文本读取：<原因>）
 *   失败：   解析后保存路径：<源路径>（解析失败：<原因>）
 * 括号内的状态词必须与客户端 PARSE_RE 的状态分支完全一致，否则卡片会被漏抽。 */
const MARKER_PREFIX = '解析后保存路径：'
const MARKER_STATUS_OK = '完整内容见上方文件卡片，可点击展开'
const MARKER_STATUS_UNREADABLE = '无法按文本读取'
const MARKER_STATUS_FAILED = '解析失败'
const MARKER_UNKNOWN = '未知原因'
const MARKER_SOURCE_TAG = '源文件：'

/** 组装「解析后保存路径」标记（ok=true 成功 / false 失败 / 'unreadable' 不可读）。 */
function markerText({path, ok = 'unreadable', note, source}) {
    if (ok === true) {
        const sourceTail = typeof source === 'string' && source !== '' && source !== path
            ? '；' + MARKER_SOURCE_TAG + source
            : ''
        return MARKER_PREFIX + path + '（' + MARKER_STATUS_OK + sourceTail + '）'
    }
    if (ok === false) {
        return MARKER_PREFIX + path + '（' + MARKER_STATUS_FAILED + '：' + (note || MARKER_UNKNOWN) + '）'
    }
    return MARKER_PREFIX + path + '（' + MARKER_STATUS_UNREADABLE + '：' + (note || MARKER_UNKNOWN) + '）'
}

const DESCRIBE_SYSTEM = [
    '你是图像识别助手。用户消息包含一张图片，请客观、详尽地描述它的全部内容，供一个无法查看图片的 AI 助手使用。要求：',
    '1. 完整转写图片中出现的所有文字（代码、报错、日志、界面文案等按原样转写，保留换行与缩进）。',
    '2. 描述界面布局、图表结构、颜色和其他显著视觉元素。',
    '3. 只陈述图片中可见的信息，不要推测或评价。',
    '使用与图片中文字相同的语言作答；图片没有文字时使用中文。',
].join('\n')

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
    /* 限流/上限类参数（Req3：原为代码内硬编码常量，现可在设置界面配置） */
    describeCacheMax: z.number().default(300).description('多模态识图结果缓存条数上限（LRU，默认 300）'),
    listMaxFiles: z.number().default(2000).description('@ 文件选择器最多列出工作区文件数（默认 2000）'),
    listMaxDepth: z.number().default(12).description('@ 文件选择器递归遍历最大深度（默认 12）'),
    maxNameChars: z.number().default(120).description('文件名清洗后的最大长度，字符（默认 120）'),
    maxBatchImages: z.number().default(20).description('一次粘贴/拖拽最多放入原生附件的图片数（客户端，默认 20）'),
    progressPollMs: z.number().default(400).description('解析进度轮询间隔，毫秒（客户端，默认 400）'),
})

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.svg', '.avif'])
/* anydoc 支持格式（权威来源 = anydoc 的 formatFromPath）：
 * doc/docx/odt/pdf/ppt/pptx/rtf/epub/xlsx/ods/odp/csv 及其容器变体（docm/xlsm/ppsx...）。 */
const TEXT_EXTENSIONS = new Set(['.json', '.txt', '.md', '.html', '.shtml'])
const MEDIA_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac', '.wma', '.mp4', '.mkv', '.webm', '.mov', '.avi', '.flv', '.wmv', '.m4v', '.mpg', '.mpeg', '.3gp', '.ts'])
const MIME_BY_EXT = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
    '.gif': 'image/gif', '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.avif': 'image/avif',
}
/* 兜底扩展名集（仅当 formatFromPath 不可用时使用；与 anydoc Format 枚举一致） */
const DOC_EXTENSIONS_FALLBACK = new Set(['.doc', '.docx', '.docm', '.ppt', '.pps', '.pot', '.pptx', '.pptm', '.ppsx', '.ppsm', '.xls', '.xlsx', '.xlsm', '.xlsb', '.odt', '.ods', '.odp', '.rtf', '.epub', '.csv', '.pdf'])

function fileKind(name) {
    const ext = extname(name).toLowerCase()
    if (IMAGE_EXTENSIONS.has(ext)) return 'image'
    /* doc 判定以 anydoc 的 formatFromPath 为唯一权威：返回非 null 即 anydoc 支持 */
    if (typeof formatFromPath === 'function') {
        try {
            if (formatFromPath(name) !== null) return 'doc'
        } catch { /* 忽略，走其余分类 */
        }
    }
    if (DOC_EXTENSIONS_FALLBACK.has(ext)) return 'doc'
    if (TEXT_EXTENSIONS.has(ext)) return 'text'
    if (MEDIA_EXTENSIONS.has(ext)) return 'media'
    return 'other'
}


function mimeFor(path) {
    const ext = extname(path).toLowerCase()
    return MIME_BY_EXT[ext] ?? 'application/octet-stream'
}

function sanitizeName(name) {
    const base = String(name || '').split(/[\\/]/).pop() || ''
    const cleaned = base
        .replace(/[^\w\u4e00-\u9fa5.\- ]/gu, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/[. ]+$/, '')
    if (cleaned === '' || cleaned === '.' || cleaned === '..') return 'file'
    return cleaned.slice(0, MAX_NAME_CHARS)
}

/* ════════════════════════════════════════════════════════════════════════
 * 公共工具方法（Req4：多处共用的数据/字符串组装集中收拢）。
 * ════════════════════════════════════════════════════════════════════════ */
/** 调试日志：仅当 DSH_OMNIFILE_DEBUG=1 时输出，统一前缀 LOG_PREFIX。 */
function debugLog(...args) {
    if (process.env.DSH_OMNIFILE_DEBUG === '1') console.error(LOG_PREFIX, ...args)
}

/** 文档 Markdown 保留字符上限（cfg.docMaxChars 缺省 120000）。 */
function docChars(cfg) {
    return Math.max(1, Number(cfg?.docMaxChars) || 120000)
}

/** 单个文档交给多模态识别的内嵌图片/扫描页预算（显式传入优先，否则取 cfg.maxDocImages）。 */
function imageBudget(cfg, override) {
    return typeof override === 'number' ? Math.max(0, override) : (cfg?.maxDocImages || 8)
}

/** 截断长文本：超出 maxChars 时追加可读提示，返回 {body, truncated}。 */
function truncateLong(raw, maxChars) {
    const text = String(raw ?? '')
    const max = Math.max(1, Number(maxChars) || 120000)
    if (text.length <= max) return {body: text, truncated: false}
    return {
        body: text.slice(0, max) + '\n\n...（内容过长，已截断，原文共 ' + text.length + ' 字符）',
        truncated: true,
    }
}

/** 会话工作区 uploads 目录（文件落盘/图片落盘共用）。 */
function uploadsDir(cwd) {
    return join(resolve(cwd), 'uploads')
}

/** 会话工作区 uploads/images 目录（文档内嵌图片/PDF 扫描页落盘共用）。 */
function uploadsImagesDir(cwd) {
    return join(resolve(cwd), 'uploads', 'images')
}

async function sessionCwd(ctx, sessionId) {
    const session = typeof sessionId === 'string' && sessionId !== '' ? ctx.sessions.get(sessionId) : undefined
    const cwd = session?.header?.cwd
    if (typeof cwd !== 'string' || cwd === '') throw new Error(ERR_NO_CWD)
    return cwd
}

/**
 * 从工具执行上下文解析当前会话工作目录。
 * DSH 的工具运行时把所属 agent 放在 exec.agent（ToolRunContext），
 * 会话 cwd 位于 exec.agent.session.header.cwd —— 这是官方推荐的获取方式；
 * 较旧的运行时可能把 session 直接挂在 exec 上，这里做兼容兜底。
 * 取不到时抛「当前会话没有工作目录」（与 sessionCwd 一致）。
 */
function agentCwd(exec) {
    const cwd = exec?.agent?.session?.header?.cwd
        ?? exec?.agent?.session?.cwd
        ?? exec?.session?.header?.cwd
        ?? exec?.cwd
    if (typeof cwd !== 'string' || cwd === '') throw new Error(ERR_NO_CWD)
    return cwd
}

function assertWorkspacePath(cwd, rawPath) {
    if (typeof rawPath !== 'string' || rawPath === '') throw new Error('缺少文件路径')
    const target = resolve(rawPath)
    const root = resolve(cwd) + sep
    if (target !== resolve(cwd) && !target.startsWith(root)) throw new Error('路径不在会话工作区内')
    return target
}

function readBody(req, maxBytes) {
    return new Promise((resolveBody, reject) => {
        const chunks = []
        let total = 0
        let aborted = false
        req.on('data', (chunk) => {
            total += chunk.length
            if (total > maxBytes) {
                aborted = true
                req.destroy()
                reject(new Error('request body too large'))
                return
            }
            chunks.push(chunk)
        })
        req.on('end', () => {
            if (aborted) return
            try {
                resolveBody(Buffer.concat(chunks))
            } catch (error) {
                reject(error)
            }
        })
        req.on('error', reject)
    })
}

function writeJson(res, status, body) {
    res.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'})
    res.end(JSON.stringify(body))
}

async function readJsonBody(req, maxBytes = MAX_REQUEST_BODY_BYTES) {
    const buf = await readBody(req, maxBytes)
    try {
        return buf.length === 0 ? {} : JSON.parse(buf.toString('utf8'))
    } catch {
        throw new Error('请求体不是有效 JSON')
    }
}

function messageOf(error) {
    return error instanceof Error ? error.message : String(error)
}

async function resolveApiKey(ctx, credential) {
    try {
        const ref = credentialRef(String(credential || '').trim())
        const resolved = await ctx.credentials.resolve(ref)
        const key = resolved?.key
        return typeof key === 'string' ? key : ''
    } catch {
        return ''
    }
}

/**
 * 从「设置-模型」已配置模型目录解析 providerRef（格式 <设置命名空间>/<提供商>/<模型id>）。
 * 解析成功返回 { baseUrl, credential(apiKeyEnv), model }；失败返回 null（reasoningEffort 由 resolveProvider 补）。
 */
async function resolveConfiguredProvider(ctx, providerRef) {
    if (typeof providerRef !== 'string' || providerRef === '') return null
    const parts = providerRef.split('/')
    if (parts.length < 3) return null
    const ns = parts[0]
    const route = parts[1]
    const modelId = parts.slice(2).join('/')
    const llm = ctx.get('llm')
    if (llm === undefined || typeof llm.listConfigurableProviders !== 'function') return null
    let directory = []
    try { directory = llm.listConfigurableProviders() } catch { return null }
    const entry = directory.find((e) => e && e.settingsNs === ns && ((e.settingsPath?.[1] === route) || (e.provider === route)))
    if (entry === undefined) return null
    let raw
    try { raw = ctx.settings?.get ? ctx.settings.get(ns) : undefined } catch { raw = undefined }
    let profile = raw
    try {
        for (const seg of (entry.settingsPath ?? [])) profile = profile === undefined || profile === null ? undefined : profile[seg]
    } catch { profile = undefined }
    if (profile === undefined || profile === null || typeof profile !== 'object') return null
    const baseUrl = profile.baseURL ?? profile.baseUrl
    if (typeof baseUrl !== 'string' || baseUrl === '') return null
    return {
        baseUrl,
        credential: typeof profile.apiKeyEnv === 'string' ? profile.apiKeyEnv : '',
        model: modelId,
    }
}

/**
 * 解析当前生效的多模态提供商：只认「设置-模型」中选择的 providerRef（唯一来源）。
 * 未选择时抛错，提示去设置页选择（不保存多份模型配置，也没有手动备用方案）。
 */
async function resolveProvider(ctx, cfg) {
    const ref = await resolveConfiguredProvider(ctx, cfg.providerRef)
    if (ref !== null) {
        ref.reasoningEffort = ref.reasoningEffort || cfg.reasoningEffort || 'medium'
        return ref
    }
    if (cfg.providerRef !== undefined && cfg.providerRef !== '') {
        throw new Error('多模态模型配置无效：providerRef="' + cfg.providerRef + '" 在「设置-模型」中不存在，请重新选择')
    }
    throw new Error('未配置多模态模型：请在设置 → DshOmniFile → 从「设置-模型」中选择一个多模态模型')
}

async function describeImage(ctx, cfg, imagePath, prompt) {
    const provider = await resolveProvider(ctx, cfg)
    const apiKey = await resolveApiKey(ctx, provider.credential)
    const baseUrl = String(provider.baseUrl || '').replace(/\/+$/, '')
    const data = await fs.readFile(imagePath)
    const mime = mimeFor(imagePath)
    const body = {
        model: provider.model,
        messages: [
            {role: 'system', content: DESCRIBE_SYSTEM},
            {
                role: 'user',
                content: [
                    {type: 'image_url', image_url: {url: 'data:' + mime + ';base64,' + data.toString('base64')}},
                    {type: 'text', text: prompt || cfg.describePrompt || DEFAULT_DESCRIBE_PROMPT},
                ],
            },
        ],
        stream: false,
        max_tokens: cfg.maxTokens >= 1 ? cfg.maxTokens : 2048,
    }
    /* 常规采样参数：temperature / top_p 由配置下发（默认 0 / 1，等价于确定性采样）。 */
    if (typeof cfg.temperature === 'number' && Number.isFinite(cfg.temperature)) body.temperature = cfg.temperature
    if (typeof cfg.topP === 'number' && Number.isFinite(cfg.topP)) body.top_p = cfg.topP
    const thinking = cfg.thinking === true
    body.reasoning_effort = thinking ? (provider.reasoningEffort || 'medium') : 'none'
    body.chat_template_kwargs = {enable_thinking: thinking}
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs || 60000)
    try {
        const response = await fetch(baseUrl + '/chat/completions', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                ...(apiKey !== '' ? {authorization: 'Bearer ' + apiKey} : {}),
            },
            body: JSON.stringify(body),
            signal: controller.signal,
        })
        if (!response.ok) {
            const detail = (await response.text().catch(() => '')).slice(0, 500)
            throw new Error('多模态模型请求失败 HTTP ' + response.status + ': ' + detail)
        }
        const json = await response.json()
        const contentValue = json?.choices?.[0]?.message?.content
        const text = Array.isArray(contentValue) ? contentValue.map((part) => part?.text ?? '').join('') : contentValue
        const trimmed = String(text ?? '').trim()
        if (trimmed === '') throw new Error('多模态模型返回空内容')
        return trimmed
    } finally {
        clearTimeout(timer)
    }
}

/* ═══════════════════════════════════════════════════════════════════
 * 多模态识别缓存：同一张图片（按内容哈希识别）+ 同一提示词 + 同一端点
 * 只调用一次多模态模型，后续（不同轮次、工具与变体提供商）直接复用结果。
 * 避免对话历史里同一图片每轮都被重复识别（用户反馈的“每次走多次多模态”）。
 * 缓存上限 DESCRIBE_CACHE_MAX 在文件顶部声明，apply() 时按 cfg.describeCacheMax 覆盖（Req3）。
 * ═══════════════════════════════════════════════════════════════════ */

/** 图片内容哈希缓存（path → size/mtime/hash）：文件被重写后 mtime 变化，用 stat 对不上，故缓存哈希避免反复读文件。 */
const imageHashCache = new Map()
/** 多模态描述结果缓存（key → 描述文本），LRU 淘汰。key = 图片内容哈希|最终提示词|端点|模型。 */
const describeCache = new Map()

/** 归一化发送给多模态模型的提示词：显式传入优先，否则用配置默认。 */
function effectivePrompt(cfg, prompt) {
    return typeof prompt === 'string' && prompt !== '' ? prompt : (cfg.describePrompt || DEFAULT_DESCRIBE_PROMPT)
}

/** 计算图片内容哈希（带 stat 命中缓存，避免反复读文件）。 */
async function imageHash(imagePath) {
    const stat = await fs.stat(imagePath).catch(() => undefined)
    if (stat === undefined) return null
    const cached = imageHashCache.get(imagePath)
    if (cached !== undefined && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) return cached.hash
    const data = await fs.readFile(imagePath)
    const hash = createHash('sha256').update(data).digest('hex')
    imageHashCache.set(imagePath, {size: stat.size, mtimeMs: stat.mtimeMs, hash})
    if (imageHashCache.size > DESCRIBE_CACHE_MAX * 2) {
        for (const key of imageHashCache.keys()) {
            imageHashCache.delete(key)
            if (imageHashCache.size <= DESCRIBE_CACHE_MAX) break
        }
    }
    return hash
}

function describeCacheGet(key) {
    const entry = describeCache.get(key)
    if (entry === undefined) return undefined
    describeCache.delete(key)
    describeCache.set(key, entry) // 命中即视为最近使用
    return entry.value
}

function describeCacheSet(key, value) {
    describeCache.delete(key)
    describeCache.set(key, {value})
    if (describeCache.size > DESCRIBE_CACHE_MAX) {
        const oldest = describeCache.keys().next().value
        describeCache.delete(oldest)
    }
}

/**
 * 带缓存的多模态识别：同一图片内容（内容哈希相同）+ 相同提示词 + 相同端点时直接复用上次结果。
 * 这是“同一图片多次走多模态模型”的核心修复：对话历史中同一附件每轮都会被转换，
 * 缓存命中后不再发起模型请求，也消除了随之而来的重复“Deep diving...”等待。
 */
async function describeImageCached(ctx, cfg, imagePath, prompt) {
    const finalPrompt = effectivePrompt(cfg, prompt)
    const provider = await resolveProvider(ctx, cfg)
    const baseUrl = String(provider.baseUrl || '').replace(/\/+$/, '')
    const model = provider.model
    const hash = await imageHash(imagePath)
    const key = hash === null ? imagePath : hash + '|' + finalPrompt + '|' + baseUrl + '|' + model
    const cached = describeCacheGet(key)
    if (cached !== undefined) return cached
    const text = await describeImage(ctx, cfg, imagePath, finalPrompt)
    describeCacheSet(key, text)
    return text
}

/* ═══════════════════════════════════════════════════════════════════
 * 处理进度跟踪：客户端在处理文件（尤其多模态识别）期间轮询
 * /api/omnifile/status 获取实时阶段，避免长时间只有一句“解析中...”。
 * ═══════════════════════════════════════════════════════════════════ */
const progressStore = new Map() // token -> {stage, detail, done, total, updatedAt}

function setProgress(token, patch) {
    if (typeof token !== 'string' || token === '') return
    const prev = progressStore.get(token)
    progressStore.set(token, {...(prev ?? {}), ...patch, updatedAt: Date.now()})
}

function clearProgress(token) {
    if (typeof token !== 'string' || token === '') return
    progressStore.delete(token)
}

function createLimiter(limit) {
    const max = Math.max(1, Math.floor(Number(limit) || 1))
    let active = 0
    const waiting = []
    const acquire = () => new Promise((resolveAcquire) => {
        if (active < max) {
            active += 1;
            resolveAcquire();
            return
        }
        waiting.push(resolveAcquire)
    })
    const release = () => {
        const next = waiting.shift()
        if (next !== undefined) {
            next();
            return
        }
        active -= 1
    }
    return async (task) => {
        await acquire()
        try {
            return await task()
        } finally {
            release()
        }
    }
}

function extnameOfMedia(mediaType) {
    switch (String(mediaType).toLowerCase()) {
        case 'image/png':
            return '.png'
        case 'image/jpeg':
            return '.jpg'
        case 'image/webp':
            return '.webp'
        case 'image/gif':
            return '.gif'
        case 'image/bmp':
            return '.bmp'
        case 'image/avif':
            return '.avif'
        default:
            return '.img'
    }
}

/* ═══════════════════════════════════════════════════════════════════
 * 纯扫描/纯图片 PDF 兜底：anydoc 转不出文本时，用 Python(PyMuPDF) 把每页
 * 渲染为 PNG，交给多模态模型逐页识别（纯 JS 提取器已弃用，PyMuPDF 为唯一兜底）。
 * ═══════════════════════════════════════════════════════════════════ */
/** 用 Python(PyMuPDF) 把 PDF 每页渲染为 PNG——当 anydoc 转不出文本时的兜底。 */
async function renderPdfPagesWithPymupdf(filePath) {
    const script = [
        'import sys',
        'try:',
        '    import pymupdf as fitz',
        'except Exception:',
        '    try:',
        '        import fitz',
        '    except Exception:',
        '        print("__PYMUPDF_MISSING__", file=sys.stderr)',
        '        sys.exit(3)',
        'doc = fitz.open(sys.argv[1])',
        'for i, page in enumerate(doc):',
        '    pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))',
        '    print("__PAGE__%d__" % i, file=sys.stderr)',  // 页面标记只走 stderr，避免污染二进制 stdout
        '    sys.stdout.buffer.write(b"PDFIMG:" + pix.tobytes("png"))',
        '    sys.stdout.buffer.flush()',
        'sys.stdout.buffer.flush()',
    ].join('\n')
    let output = ''
    let meta = ''
    await new Promise((resolveRun, rejectRun) => {
        const child = spawn('python', ['-c', script, filePath], {stdio: ['ignore', 'pipe', 'pipe']})
        let outBuf = []
        child.stdout.on('data', (chunk) => {
            outBuf.push(chunk)
        })
        child.stderr.on('data', (chunk) => {
            meta += chunk.toString('utf8')
        })
        child.on('error', rejectRun)
        child.on('close', () => {
            output = Buffer.concat(outBuf)
            resolveRun()
        })
    })
    if (meta.includes('__PYMUPDF_MISSING__')) throw new Error('pymupdf 未安装')
    const pages = []
    const body = output.subarray(0, output.length)
    // 解析 "PDFIMG:" 分隔
    const marker = 'PDFIMG:'
    const markerBuf = Buffer.from(marker, 'latin1')
    let idx = 0
    while (idx < body.length) {
        const pos = body.indexOf(markerBuf, idx)
        if (pos < 0) break
        const start = pos + markerBuf.length
        const next = body.indexOf(markerBuf, start)
        const end = next < 0 ? body.length : next
        const png = body.subarray(start, end)
        if (png.length > 0) pages.push({data: Buffer.from(png), mediaType: 'image/png', page: pages.length + 1})
        idx = end
    }
    return pages
}

/**
 * 纯扫描/纯图片 PDF 的多模态兜底：anydoc 转不出文本时，用 PyMuPDF 把每页渲染为 PNG，
 * 交给多模态模型逐页识别（不依赖任何 PDF 解析库的图片提取，PyMuPDF 是唯一兜底通道）。
 */
async function describePdfFallback(cfg, filePath) {
    const errors = []
    try {
        const pages = await renderPdfPagesWithPymupdf(filePath)
        if (pages.length > 0) return {images: pages, source: 'pymupdf'}
        errors.push('pymupdf 未渲染出页面')
    } catch (error) {
        errors.push('pymupdf 渲染失败：' + messageOf(error))
    }
    return {images: [], errors}
}

/**
 * 将文件字节解码为文本：UTF-8（含 BOM）优先，替换字符过多时回退 GB18030。
 * 纯文本文件可能是 GBK/GB18030 编码（中文 Windows 常见），TextDecoder('gb18030') 是 Node 内置能力。
 */
function decodeText(bytes) {
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
        return Buffer.from(bytes.subarray(3)).toString('utf8')
    }
    const utf8 = Buffer.from(bytes).toString('utf8')
    const badCount = (utf8.match(/\uFFFD/g) || []).length
    if (badCount === 0) return utf8
    try {
        const gbk = new TextDecoder('gb18030').decode(bytes)
        const gbkBad = (gbk.match(/\uFFFD/g) || []).length
        if (gbkBad < badCount) return gbk
    } catch { /* TextDecoder 不可用时保留 UTF-8 结果 */
    }
    return utf8
}

/** 极简 HTML → 可读文本：去掉 script/style，剥标签，还原常用实体并收拢空白。 */
function htmlToText(raw) {
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

/**
 * 解析纯文本格式（json/txt/md/html/shtml）：直接解码为文字，不经过 anydoc。
 * JSON 尝试美化（未压缩时更易读）；HTML 剥标签。
 */
async function processText(ctx, cfg, cwd, filePath, fileName) {
    const bytes = await fs.readFile(filePath)
    const ext = extname(fileName || filePath).toLowerCase()
    let raw = decodeText(bytes)
    // 二进制检测：NUL 字节或不可打印控制字符占比过高 → 不是文本文件
    if (isBinaryish(bytes, raw)) {
        throw new Error('该文件不是文本文件（检测到二进制内容）')
    }
    if (ext === '.json') {
        try {
            const parsed = JSON.parse(raw)
            raw = JSON.stringify(parsed, null, 2)
        } catch { /* 非严格 JSON 保持原样 */
        }
    } else if (ext === '.html' || ext === '.shtml') {
        raw = htmlToText(raw)
        if (raw === '') raw = decodeText(bytes)
    }
    const {body, truncated} = truncateLong(raw, docChars(cfg))
    return {markdown: body, images: [], truncated}
}

/** 判断字节内容是否更像二进制而非文本。 */
function isBinaryish(bytes, decoded) {
    if (bytes.length === 0) return false
    if (bytes.includes(0)) return true
    let control = 0
    const sample = bytes.subarray(0, Math.min(bytes.length, 8192))
    for (const byte of sample) {
        if ((byte < 0x09) || (byte > 0x0d && byte < 0x20) || (byte > 0x7e && byte < 0xa0)) control += 1
    }
    if (sample.length > 0 && control / sample.length > 0.3) return true
    if (typeof decoded === 'string') {
        const bad = (decoded.match(/\uFFFD/g) || []).length
        if (decoded.length > 0 && bad / decoded.length > 0.1) return true
    }
    return false
}

/**
 * 由源文件路径推导解析结果路径（<workspace>/uploads/<源文件名>.md）。
 * 源文件名默认取源文件 basename，也可显式传入原始文件名（./process 收到 body.name 时）。
 * 形态统一为「{源文件名}.md」，便于大模型直接对保存路径触发 read 工具。
 */
function parsedMarkdownPath(cwd, sourcePath, sourceName) {
    const name = sanitizeName(sourceName || basename(sourcePath)) || 'file'
    return join(resolve(cwd), 'uploads', name + '.md')
}

/** 把解析出的 Markdown 落盘到 <uploads>/<源文件名>.md，供折叠卡片懒加载与大模型 read。 */
async function writeParsedMarkdown(cwd, sourcePath, markdown, sourceName) {
    try {
        const parsedPath = parsedMarkdownPath(cwd, sourcePath, sourceName)
        await fs.mkdir(uploadsDir(cwd), {recursive: true})
        await fs.writeFile(parsedPath, String(markdown ?? ''), 'utf8')
        return parsedPath
    } catch (error) {
        debugLog('写解析结果失败：' + messageOf(error))
        return undefined
    }
}

/**
 * 用 @firecrawl/anydoc 解析文档。要点（对照 anydoc 0.1.9 API）：
 * - toMarkdownBytes(bytes, format) 对所有格式（含 PDF）都能转 Markdown；
 * - toDocument(bytes, format) 返回 Document.assets（内嵌图片字节），但 PDF 不支持（仅 Markdown 直出）；
 * - formatFromPath 识别格式并显式传给上面两个函数（CSV 等无签名的格式必须显式命名）；
 * - 任一步失败都容错降级，绝不因"含图片/无法转换"而整体报错：文本拿不到就只描述内嵌图片，
 *   图片描述失败只记录该图片错误，都不会中断整份文档的解析。
 */
async function processDocument(ctx, cfg, cwd, filePath, fileName, limitImages, onProgress) {
    const imagesDir = uploadsImagesDir(cwd)
    const bytes = await fs.readFile(filePath)
    const fmt = typeof formatFromPath === 'function' ? formatFromPath(filePath) : undefined
    const isPdf = fmt === 'pdf'
    onProgress?.({stage: 'doc', detail: '正在解析文档...', done: 0, total: 1})

    // 1) 文档模型 + 内嵌图片（PDF 无文档模型，跳过）
    let assets = []
    if (!isPdf) {
        try {
            const document = await toDocument(bytes, fmt ?? undefined)
            assets = Array.isArray(document?.assets) ? document.assets : []
        } catch (error) {
            debugLog('toDocument failed for', filePath, messageOf(error))
        }
    }

    // 2) Markdown：优先 toMarkdownBytes（字节 → Markdown，含 PDF），失败回退 toMarkdown(path)
    let markdownRaw = ''
    let mdError = undefined
    try {
        markdownRaw = await toMarkdownBytes(bytes, fmt ?? undefined)
    } catch (error) {
        mdError = error
    }
    if (typeof markdownRaw !== 'string' || markdownRaw === '') {
        try {
            markdownRaw = await toMarkdown(filePath)
        } catch (error) {
            mdError = mdError ?? error
        }
    }
    markdownRaw = String(markdownRaw || '')

    // 图片识别结果统一收集（PDF 兜底图片 + anydoc 内嵌图片）
    const savedImages = []

    // 2.5) 【规则2】仅当 firecrawl/anydoc【支持】的格式解析失败时才走多模态兜底。
    //      - 本函数只处理 kind==='doc'（任何 doc 的扩展名都落在 anydoc 支持集内）；
    //      - PDF 是 anydoc 支持的格式：anydoc 转 Markdown 失败 / 报 unsupported /
    //        返回空文本时，用 PyMuPDF 把每页渲染为 PNG，交给多模态模型逐页识别；
    //      - 非 PDF 文档（docx/pptx/xlsx 等）：若 Markdown 失败，下方第 3 步仍会
    //        把 toDocument 拿到的 assets（图片）交给多模态识别（用 anydoc 自身能力，不自研解压）。
    const mdLooksUnsupported = markdownRaw === ''
        || mdError !== undefined
        || /unsupported|OCR|no extractable text|scanned/i.test(markdownRaw)
    if (isPdf && mdLooksUnsupported) {
        try {
            const fallback = await describePdfFallback(cfg, filePath)
            if (fallback.images.length > 0) {
                const budget = imageBudget(cfg, limitImages)
                const chosen = fallback.images.slice(0, budget)
                const limitPdf = createLimiter(cfg.concurrency || 1)
                /* 并行识别完成顺序不定，必须按 index（=页码顺序）对齐收集后再拼装，保证扫描件页序不乱。 */
                const pdfResults = new Array(chosen.length)
                await Promise.all(chosen.map(async (img, index) => {
                    try {
                        const ext = img.mediaType === 'image/jpeg' ? '.jpg' : '.png'
                        const stamp = randomUUID().slice(0, 8)
                        const base = sanitizeName(fileName).replace(/\.[^.]+$/, '')
                        const assetPath = join(imagesDir, base + '-pdf-' + stamp + '-' + (index + 1) + ext)
                        await fs.mkdir(imagesDir, {recursive: true})
                        await fs.writeFile(assetPath, img.data)
                        onProgress?.({stage: 'image', detail: '识别扫描页 ' + (index + 1) + '/' + chosen.length, done: index + 1, total: chosen.length})
                        const description = await limitPdf(() => describeImageCached(ctx, cfg, assetPath, cfg.describePrompt || DEFAULT_DESCRIBE_PROMPT))
                        pdfResults[index] = {
                            path: assetPath,
                            name: basename(assetPath),
                            mediaType: img.mediaType,
                            description,
                            pdfPage: img.page
                        }
                    } catch (error) {
                        pdfResults[index] = {
                            path: undefined,
                            name: 'pdf-page-' + (index + 1),
                            mediaType: img.mediaType,
                            error: messageOf(error)
                        }
                    }
                }))
                for (const entry of pdfResults) savedImages.push(entry)
            }
        } catch (error) {
            debugLog('PDF 图片兜底失败：' + messageOf(error))
        }
    }

    // 3) 提取并识别内嵌图片（单独保存到 uploads/images/，交给多模态模型）
    const limit = createLimiter(cfg.concurrency || 1)
    const budget = imageBudget(cfg, limitImages)
    const candidates = assets.filter((asset) => {
        const mt = String(asset.mediaType || '').toLowerCase()
        return mt.startsWith('image/') && Buffer.isBuffer(asset.data) && asset.data.length > 0
    })
    const chosen = candidates.slice(0, budget)
    /* 保持文档内嵌图片原有顺序：并行识别后按索引对齐再拼装。 */
    const imageResults = new Array(chosen.length)
    await Promise.all(chosen.map(async (asset, index) => {
        try {
            const ext = extnameOfMedia(asset.mediaType)
            const stamp = randomUUID().slice(0, 8)
            const base = sanitizeName(fileName).replace(/\.[^.]+$/, '')
            const assetPath = join(imagesDir, base + '-' + stamp + '-' + (index + 1) + ext)
            await fs.mkdir(imagesDir, {recursive: true})
            await fs.writeFile(assetPath, asset.data)
            onProgress?.({stage: 'image', detail: '识别内嵌图片 ' + (index + 1) + '/' + chosen.length, done: index + 1, total: chosen.length})
            const description = await limit(() => describeImageCached(ctx, cfg, assetPath, cfg.describePrompt || DEFAULT_DESCRIBE_PROMPT))
            imageResults[index] = {path: assetPath, name: basename(assetPath), mediaType: asset.mediaType, description}
        } catch (error) {
            imageResults[index] = {
                path: undefined,
                name: 'image-' + (index + 1),
                mediaType: asset.mediaType,
                error: messageOf(error)
            }
        }
    }))
    for (const entry of imageResults) savedImages.push(entry)

    // 4) 组装最终文本：Markdown（失败则说明原因）+ 内嵌图片识别结果
    const maxChars = docChars(cfg)
    let body = ''
    if (markdownRaw !== '') {
        body = truncateLong(markdownRaw, maxChars).body
    } else if (savedImages.length > 0) {
        body = '（该文档文本内容无法提取，已提取其中 ' + savedImages.length + ' 张图片并识别如下；文件绝对路径：' + filePath + '）'
    } else {
        body = '（该文档无法解析出文本内容，文件已保存，绝对路径：' + filePath + '）'
    }
    const textError = mdError !== undefined ? messageOf(mdError).slice(0, 300) : undefined
    if (textError !== undefined) {
        body += '\n\n【解析提示】文本转换未成功：' + textError + '（内容可能仍包含图片，见下方识别结果）'
    }
    if (savedImages.length > 0) {
        const imageSection = savedImages.map((img, i) => {
            if (img.error !== undefined) return '- 图片 ' + (i + 1) + '：识别失败（' + img.error + '）'
            const pageTag = img.pdfPage !== undefined ? '（PDF 第 ' + img.pdfPage + ' 页）' : ''
            return '- 图片 ' + (i + 1) + pageTag + '（' + img.name + '）：' + img.description
        }).join('\n')
        body += '\n\n【文档内嵌图片识别结果】\n' + imageSection
    }
    return {markdown: body, images: savedImages, truncated: markdownRaw.length > maxChars, textError}
}

function shouldWrapModel(info) {
    return Array.isArray(info?.inputModalities) && !info.inputModalities.includes('image')
}

class OmnifileVariantAdapter extends LlmAdapter {
    constructor(ctx, llm, upstream, upstreamName, getConfig) {
        super()
        this.ctx = ctx
        this.llm = llm
        this.upstream = upstream
        this.upstreamName = upstreamName
        this.getConfig = getConfig
    }

    providerInfo(provider) {
        return {id: provider, name: this.upstreamName + VARIANT_SUFFIX}
    }

    async listModels(provider, signal) {
        const models = await this.llm.listModels(this.upstream, signal)
        return models
            .filter((m) => shouldWrapModel(m))
            .map((m) => ({
                provider,
                id: m.id,
                name: m.name + VARIANT_SUFFIX,
                inputModalities: ['text', 'image'],
                ...(m.description !== undefined ? {description: m.description} : {}),
            }))
    }

    async resolveModel(provider, model, signal) {
        const info = await this.llm.resolveModelInfo(this.upstream, model, signal)
        if (!shouldWrapModel(info)) throw new Error('model "' + model + '" is not text-only; no omnifile variant needed')
        return {
            provider,
            id: model,
            name: info.name + VARIANT_SUFFIX,
            inputModalities: ['text', 'image'],
            ...(info.description !== undefined ? {description: info.description} : {}),
            ...(info.context !== undefined ? {context: info.context} : {}),
            ...(info.defaultMaxTokens !== undefined ? {defaultMaxTokens: info.defaultMaxTokens} : {}),
            ...(info.reasoning !== undefined ? {reasoning: info.reasoning} : {}),
        }
    }

    async* stream(options) {
        const cfg = this.getConfig()
        const messages = await this.rewriteMessages(cfg, options.messages, options.signal, options.sessionId)
        yield* this.llm.stream({...options, provider: this.upstream, messages})
    }

    async rewriteMessages(cfg, messages, signal, sessionId) {
        if (!messages.some((message) => contentHasImage(message.content))) return messages
        const limit = createLimiter(cfg.concurrency || 1)
        const out = []
        for (const message of messages) {
            if (!contentHasImage(message.content)) {
                out.push(message)
                continue
            }
            const content = await this.convertBlocks(cfg, message.content, limit, signal, sessionId)
            out.push({...message, content})
        }
        return out
    }

    async convertBlocks(cfg, blocks, limit, signal, sessionId) {
        const result = []
        let channelInserted = false
        for (const block of blocks) {
            if (block.type === 'tool-result' && contentHasImage(block.content)) {
                const nested = await this.convertBlocks(cfg, block.content, limit, signal, sessionId)
                result.push({...block, content: nested})
                continue
            }
            if (block.type !== 'image') {
                result.push(block)
                continue
            }
            if (!channelInserted) {
                result.push({
                    type: 'text',
                    text: '[omnifile] 这里的图片已经由多模态模型转换成文字说明，你只收到描述文本，不包含视觉 Token；图片绝对路径一并附上，需要更多视觉证据时可读该路径。',
                })
                channelInserted = true
            }
            signal?.throwIfAborted()
            const replacement = await limit(async () => {
                try {
                    const attachment = this.ctx.get('attachments')
                    const cwd = typeof sessionId === 'string' && sessionId !== ''
                        ? this.ctx.sessions.get(sessionId)?.header?.cwd
                        : undefined
                    const pathEvidence = await this.materializeAsEvidence(block, attachment, cwd)
                    // 内容哈希缓存：对话历史里同一附件每轮都会被转换，缓存命中后不再重复调用多模态模型
                    const description = await describeImageCached(this.ctx, cfg, pathEvidence.path, cfg.describePrompt || DEFAULT_DESCRIBE_PROMPT)
                    return {
                        type: 'text',
                        text: '[图片绝对路径: ' + JSON.stringify(pathEvidence.path) + ']\n[多模态模型描述] ' + description
                    }
                } catch (error) {
                    return {type: 'text', text: '[omnifile 不可用] ' + messageOf(error).slice(0, 300)}
                }
            })
            result.push(replacement)
        }
        return result
    }

    async materializeAsEvidence(block, attachmentService, cwd) {
        if (attachmentService === undefined) throw new Error('附件服务不可用')
        const stored = await attachmentService.readImage(block.attachment)
        const data = stored?.data
        if (!(data instanceof Uint8Array) && !Buffer.isBuffer(data)) throw new Error('无法读取附件图片字节')
        const ext = extnameOfMedia(block.attachment?.mediaType || '')
        const hash = createHash('sha256').update(String(block.attachment?.attachmentId ?? '')).digest('hex').slice(0, 16)
        if (typeof cwd === 'string' && cwd !== '') {
            const imagesDir = uploadsImagesDir(cwd)
            await fs.mkdir(imagesDir, {recursive: true})
            const path = join(imagesDir, 'attachment-' + hash + ext)
            await fs.writeFile(path, Buffer.from(data))
            return {path}
        }
        const tmp = process.env.TEMP || process.env.TMP || '/tmp'
        const path = join(tmp, 'omnifile-' + hash + ext)
        await fs.writeFile(path, Buffer.from(data))
        return {path}
    }
}

function installVariants(ctx, getConfig) {
    const registrations = new Map()
    let disposed = false
    let sweeping = Promise.resolve()
    let sweepQueued = false
    const releaseAll = () => {
        for (const dispose of [...registrations.values()]) dispose()
        registrations.clear()
    }
    const sweep = () => {
        if (sweepQueued) return
        sweepQueued = true
        queueMicrotask(() => {
            sweepQueued = false
            sweeping = sweeping.then(sweepOnce, sweepOnce)
        })
    }
    const sweepOnce = async () => {
        if (disposed) return
        try {
            const cfg = getConfig()
            if (cfg.enableVariants !== true) {
                releaseAll()
                return
            }
            const llm = ctx.get('llm')
            if (llm === undefined) return
            let providers
            try {
                providers = llm.listProviders()
            } catch {
                return
            }
            const live = new Set(providers.map((provider) => provider.id))
            for (const upstream of [...registrations.keys()]) {
                if (!live.has(upstream)) {
                    registrations.get(upstream)?.()
                    registrations.delete(upstream)
                }
            }
            for (const provider of providers) {
                const upstream = provider.id
                if (upstream.startsWith(VARIANT_PREFIX)) continue
                if (registrations.has(upstream)) continue
                let models
                try {
                    models = await llm.listModels(upstream)
                } catch {
                    continue
                }
                if (!models.some((model) => shouldWrapModel(model))) continue
                if (disposed) return
                try {
                    const dispose = llm.registerAdapter(
                        [VARIANT_PREFIX + upstream],
                        new OmnifileVariantAdapter(ctx, llm, upstream, provider.name, getConfig),
                    )
                    registrations.set(upstream, dispose)
                } catch (error) {
                    ctx.logger?.warn?.(LOG_PREFIX + ' variant registration skipped for "' + upstream + '": ' + messageOf(error))
                }
            }
        } catch (error) {
            ctx.logger?.warn?.(LOG_PREFIX + ' variant sweep failed: ' + messageOf(error))
        }
    }
    if (typeof ctx.on === 'function') ctx.on('llm/adapters-updated', () => sweep())
    sweep()
    return () => {
        disposed = true
        releaseAll()
    }
}

function openLocally(path) {
    return new Promise((resolveOpen) => {
        let child
        try {
            if (process.platform === 'win32') {
                child = spawn('cmd', ['/c', 'start', '', path], {detached: true, stdio: 'ignore'})
            } else if (process.platform === 'darwin') {
                child = spawn('open', [path], {detached: true, stdio: 'ignore'})
            } else {
                child = spawn('xdg-open', [path], {detached: true, stdio: 'ignore'})
            }
        } catch (error) {
            resolveOpen({ok: false, error: messageOf(error)})
            return
        }
        child?.unref?.()
        resolveOpen({ok: true})
    })
}

/* ═══════════════════════════════════════════════════════════════════
 * 递归列出会话工作区内的文件（仅文件，不列出目录本体），供输入框 @ 文件选择器使用。
 * - 跳过常见噪声目录（node_modules/.git/dist 等）与插件自身 uploads 暂存目录，
 *   避免把大目录/重复附件灌进选择菜单；
 * - 限制最大文件数与遍历深度，防止大目录拉爆响应；
 * - 返回 { name, path(绝对), rel(相对, 正斜杠), kind, size }。
 * ═══════════════════════════════════════════════════════════════════ */
const WALK_SKIP_DIRS = new Set(['node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', 'target', '.next', '.nuxt', '.vite', '.turbo', '.cache', '__pycache__', 'coverage', '.idea', '.vscode', '.venv', 'venv', 'uploads'])

async function walkWorkspaceFiles(cwd, options = {}) {
    const maxFiles = options.maxFiles || 2000
    const maxDepth = options.maxDepth || 12
    const files = []
    const seen = new Set()
    const walk = async (dir, rel, depth) => {
        if (files.length >= maxFiles) return
        if (depth > maxDepth) return
        let entries
        try {
            entries = await fs.readdir(dir, {withFileTypes: true})
        } catch {
            return
        }
        entries.sort((a, b) => a.name.localeCompare(b.name))
        for (const entry of entries) {
            if (files.length >= maxFiles) return
            const name = entry.name
            const abs = join(dir, name)
            const relPath = rel === '' ? name : rel + '/' + name
            if (entry.isDirectory()) {
                if (WALK_SKIP_DIRS.has(name)) continue
                if (seen.has(abs)) continue
                seen.add(abs)
                await walk(abs, relPath, depth + 1)
            } else if (entry.isFile() || entry.isSymbolicLink()) {
                let size = 0
                try {
                    const stat = await fs.stat(abs)
                    if (!stat.isFile()) continue
                    size = stat.size
                } catch {
                    continue
                }
                files.push({name, path: abs, rel: relPath, kind: fileKind(name), size})
            }
        }
    }
    await walk(resolve(cwd), '', 0)
    files.sort((a, b) => a.rel.localeCompare(b.rel))
    return files
}

function loadConfig(ctx) {
    let stored
    try {
        stored = ctx.settings ? ctx.settings.get(NAMESPACE) : undefined
    } catch {
        stored = undefined
    }
    return stored !== undefined && stored !== null && typeof stored === 'object' ? stored : {}
}

export function apply(ctx, config = {}) {
    const forced = {...config}
    if (typeof ctx.settings?.register === 'function') {
        ctx.settings.register(NAMESPACE, Config, {base: forced, applies: 'live'})
    }
    const getConfig = () => {
        const stored = loadConfig(ctx)
        if (Object.keys(stored).length > 0) {
            return {...forced, ...stored}
        }
        return forced
    }
    /* 把可配置上限同步到模块级可变常量（sanitizeName 与识图缓存宽度在配置变更后即时生效）。 */
    const cfgSnapshot = getConfig()
    MAX_NAME_CHARS = Math.max(8, Number(cfgSnapshot.maxNameChars) || 120)
    DESCRIBE_CACHE_MAX = Math.max(16, Number(cfgSnapshot.describeCacheMax) || 300)

    const webServer = ctx.get('webServer')
    let disposeVariants = () => {
    }
    try {
        if (ctx.get('llm') !== undefined) disposeVariants = installVariants(ctx, getConfig)
    } catch (error) {
        ctx.logger?.warn?.(LOG_PREFIX + ' variants skipped: ' + messageOf(error))
    }

    if (webServer !== undefined) {
        ctx.effect(() => webServer.register({
            kind: 'exact',
            path: '/api/omnifile/save',
            handler: async (req, res) => {
                try {
                    const cfg = getConfig()
                    /* 上限统一由 cfg.maxFileBytes 派生：base64 字符数 ≈ 字节数×4/3，JSON 外壳再加余量。 */
                    const maxFileBytes = Math.max(1, Number(cfg.maxFileBytes) || MAX_SAVE_FALLBACK_BYTES)
                    const maxBase64Chars = Math.ceil(maxFileBytes * BASE64_INFLATE) + 1024
                    const maxBodyBytes = Math.ceil(maxBase64Chars) + 1024 * 1024
                    const body = await readJsonBody(req, maxBodyBytes)
                    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
                    const name = typeof body.name === 'string' ? body.name : ''
                    const base64 = typeof body.base64 === 'string' ? body.base64 : ''
                    if (sessionId === '' || name === '' || base64 === '') {
                        return writeJson(res, 400, {ok: false, error: '参数不完整（sessionId/name/base64）'})
                    }
                    if (base64.length > maxBase64Chars) {
                        return writeJson(res, 400, {ok: false, error: '文件过大（超过上传上限）'})
                    }
                    let bytes
                    try {
                        bytes = Buffer.from(base64, 'base64')
                    } catch {
                        return writeJson(res, 400, {ok: false, error: '文件内容无效'})
                    }
                    if (bytes.length > maxFileBytes) {
                        return writeJson(res, 400, {
                            ok: false,
                            error: '文件超过大小上限 ' + Math.round(maxFileBytes / 1024 / 1024) + 'MB'
                        })
                    }
                    const cwd = await sessionCwd(ctx, sessionId)
                    const fileName = Date.now() + '-' + sanitizeName(name)
                    const dir = uploadsDir(cwd)
                    await fs.mkdir(dir, {recursive: true})
                    const path = join(dir, fileName)
                    await fs.writeFile(path, bytes)
                    return writeJson(res, 200, {
                        ok: true,
                        path,
                        name: fileName,
                        mime: mimeFor(name),
                        size: bytes.length,
                        kind: fileKind(name),
                    })
                } catch (error) {
                    debugLog('save failed:', error)
                    return writeJson(res, 500, {ok: false, error: '保存失败：' + messageOf(error)})
                }
            },
        }), 'dsh-omnifile.save')

        ctx.effect(() => webServer.register({
            kind: 'exact',
            path: '/api/omnifile/process',
            handler: async (req, res) => {
                let token = ''
                try {
                    const body = await readJsonBody(req)
                    token = typeof body.token === 'string' ? body.token : ''
                    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
                    const cwd = await sessionCwd(ctx, sessionId)
                    const target = assertWorkspacePath(cwd, body.path)
                    const cfg = getConfig()
                    const kind = typeof body.kind === 'string' && body.kind !== '' ? body.kind : fileKind(target)
                    /* 原始文件名（上传时用用户原名；@ 选中时用源文件 basename），决定解析 md 的落盘名 {源文件名}.md */
                    const srcName = typeof body.name === 'string' && body.name !== '' ? body.name : basename(target)
                    if (kind === 'image') {
                        setProgress(token, {stage: 'image', detail: '正在调用多模态模型识别图片...', done: 0, total: 1})
                        const text = await describeImageCached(ctx, cfg, target, undefined)
                        /* 图片描述同样落盘为 <uploads>/<源文件名>.md，消息里只放一行可读引用 */
                        const parsedPath = await writeParsedMarkdown(cwd, target, text, srcName)
                        return writeJson(res, 200, {ok: true, kind: 'image', text, parsedPath, path: target})
                    }
                    if (kind === 'text') {
                        setProgress(token, {stage: 'text', detail: '正在读取文本文件...', done: 0, total: 1})
                        const result = await processText(ctx, cfg, cwd, target, basename(target))
                        const parsedPath = await writeParsedMarkdown(cwd, target, result.markdown, srcName)
                        return writeJson(res, 200, {ok: true, kind: 'text', parsedPath, ...result, path: target})
                    }
                    if (kind === 'doc') {
                        const result = await processDocument(ctx, cfg, cwd, target, basename(target), undefined, (patch) => setProgress(token, patch))
                        // 解析结果落盘为 <uploads>/<源文件名>.md，折叠卡片懒加载与大模型 read 用同一路径
                        const parsedPath = await writeParsedMarkdown(cwd, target, result.markdown, srcName)
                        setProgress(token, {stage: 'doc', detail: '解析完成', done: 1, total: 1})
                        return writeJson(res, 200, {ok: true, kind: 'doc', parsedPath, ...result, path: target})
                    }
                    // 未识别的格式（如 .js/.ts/...）若可按文本读取则按文本处理，读不了就提示并保留路径
                    try {
                        const result = await processText(ctx, cfg, cwd, target, basename(target))
                        const parsedPath = await writeParsedMarkdown(cwd, target, result.markdown, srcName)
                        setProgress(token, {stage: 'text', detail: '解析完成', done: 1, total: 1})
                        return writeJson(res, 200, {ok: true, kind: 'text', parsedPath, ...result, path: target, note: '未知格式，已按文本读取。'})
                    } catch (error) {
                        const stat = await fs.stat(target).catch(() => undefined)
                        return writeJson(res, 200, {
                            ok: true,
                            kind: 'other',
                            path: target,
                            size: stat?.size,
                            note: messageOf(error) || '无法解析该文件',
                        })
                    }
                } catch (error) {
                    return writeJson(res, 500, {ok: false, error: messageOf(error) || '解析失败'})
                } finally {
                    clearProgress(token)
                }
            },
        }), 'dsh-omnifile.process')

        ctx.effect(() => webServer.register({
            kind: 'exact',
            path: '/api/omnifile/status',
            handler: async (req, res) => {
                try {
                    const url = new URL(req.url, 'http://localhost')
                    const token = url.searchParams.get('token') ?? ''
                    const entry = typeof token === 'string' && token !== '' ? progressStore.get(token) : undefined
                    return writeJson(res, 200, {ok: true, progress: entry ?? null})
                } catch (error) {
                    return writeJson(res, 500, {ok: false, error: messageOf(error)})
                }
            },
        }), 'dsh-omnifile.status')

        ctx.effect(() => webServer.register({
            kind: 'exact',
            path: '/api/omnifile/parsed',
            handler: async (req, res) => {
                try {
                    const url = new URL(req.url, 'http://localhost')
                    const sessionId = url.searchParams.get('sessionId') ?? ''
                    const cwd = await sessionCwd(ctx, sessionId)
                    const rawPath = url.searchParams.get('path') ?? ''
                    const target = assertWorkspacePath(cwd, rawPath)
                    /* 新标记的保存路径即 {源文件名}.md → 直接读；旧标记（源文件路径）则按规则推导同名 .md。 */
                    const parsedPath = target.toLowerCase().endsWith('.md') ? target : parsedMarkdownPath(cwd, target)
                    const data = await fs.readFile(parsedPath)
                    res.writeHead(200, {
                        'content-type': 'text/markdown; charset=utf-8',
                        'content-length': data.length,
                        'cache-control': 'no-store',
                    })
                    res.end(data)
                } catch (error) {
                    writeJson(res, 404, {ok: false, error: messageOf(error)})
                }
            },
        }), 'dsh-omnifile.parsed')

        ctx.effect(() => webServer.register({
            kind: 'exact',
            path: '/api/omnifile/models',
            handler: async (req, res) => {
                try {
                    /* 枚举「设置-模型」里已配置、且支持 image 输入的提供商/模型，供本插件设置页点选。
                     * 数据来自 llm 可配置提供商目录（settingsNs/settingsPath）+ 该命名空间的配置。 */
                    const llm = ctx.get('llm')
                    const providers = []
                    const seen = new Set()
                    if (llm !== undefined) {
                        let directory = []
                        try {
                            directory = typeof llm.listConfigurableProviders === 'function' ? llm.listConfigurableProviders() : []
                        } catch { /* 目录不可用则返回空 */ }
                        for (const entry of directory) {
                            let raw
                            try { raw = ctx.settings?.get ? ctx.settings.get(entry.settingsNs) : undefined } catch { raw = undefined }
                            let profile = raw
                            try {
                                for (const seg of (entry.settingsPath ?? [])) profile = profile === undefined || profile === null ? undefined : profile[seg]
                            } catch { profile = undefined }
                            if (profile === undefined || profile === null || typeof profile !== 'object') continue
                            const baseURL = profile.baseURL ?? profile.baseUrl
                            const apiKeyEnv = typeof profile.apiKeyEnv === 'string' ? profile.apiKeyEnv : ''
                            if (typeof baseURL !== 'string' || baseURL === '') continue
                            const defaultInput = Array.isArray(profile.defaultInput) ? profile.defaultInput : []
                            const providerImage = defaultInput.includes('image')
                            const providerKey = entry.settingsNs + '/' + (entry.settingsPath?.[1] ?? entry.provider)
                            const models = Array.isArray(profile.models) ? profile.models : []
                            for (const model of models) {
                                if (model === null || typeof model !== 'object' || typeof model.id !== 'string' || model.id === '') continue
                                const modelInput = Array.isArray(model.input) ? model.input : defaultInput
                                const isImage = providerImage || modelInput.includes('image')
                                if (!isImage) continue
                                const key = providerKey + '/' + model.id
                                if (seen.has(key)) continue
                                seen.add(key)
                                providers.push({
                                    ref: key,
                                    provider: providerKey,
                                    displayName: entry.displayName || entry.provider || providerKey,
                                    modelId: model.id,
                                    modelName: typeof model.name === 'string' && model.name !== '' ? model.name : model.id,
                                    baseURL,
                                    apiKeyEnv,
                                })
                            }
                        }
                    }
                    providers.sort((a, b) => a.displayName.localeCompare(b.displayName) || a.modelId.localeCompare(b.modelId))
                    return writeJson(res, 200, {ok: true, providers})
                } catch (error) {
                    return writeJson(res, 500, {ok: false, error: messageOf(error)})
                }
            },
        }), 'dsh-omnifile.models')

        ctx.effect(() => webServer.register({
            kind: 'exact',
            path: '/api/omnifile/open',
            handler: async (req, res) => {
                try {
                    const body = await readJsonBody(req)
                    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
                    const cwd = await sessionCwd(ctx, sessionId)
                    const target = assertWorkspacePath(cwd, body.path)
                    const result = await openLocally(target)
                    return writeJson(res, result.ok ? 200 : 500, {ok: result.ok, error: result.error})
                } catch (error) {
                    return writeJson(res, 500, {ok: false, error: messageOf(error)})
                }
            },
        }), 'dsh-omnifile.open')

        ctx.effect(() => webServer.register({
            kind: 'exact',
            path: '/api/omnifile/list',
            handler: async (req, res) => {
                try {
                    const url = new URL(req.url, 'http://localhost')
                    const sessionId = url.searchParams.get('sessionId') ?? ''
                    const cwd = await sessionCwd(ctx, sessionId)
                    const cfg = getConfig()
                    const files = await walkWorkspaceFiles(cwd, {
                        maxFiles: cfg.listMaxFiles,
                        maxDepth: cfg.listMaxDepth,
                    })
                    return writeJson(res, 200, {ok: true, files})
                } catch (error) {
                    return writeJson(res, 500, {ok: false, error: messageOf(error)})
                }
            },
        }), 'dsh-omnifile.list')

        /* 返回当前生效配置与客户端限额（Req3：客户端缓存的硬编码限额改为从宿主读取）。 */
        ctx.effect(() => webServer.register({
            kind: 'exact',
            path: '/api/omnifile/config',
            handler: async (req, res) => {
                try {
                    const cfg = getConfig()
                    return writeJson(res, 200, {
                        ok: true,
                        config: cfg,
                        limits: {
                            maxFileBytes: Math.max(1, Number(cfg.maxFileBytes) || MAX_SAVE_FALLBACK_BYTES),
                            maxBatchImages: Math.max(1, Number(cfg.maxBatchImages) || 20),
                            progressPollMs: Math.max(50, Number(cfg.progressPollMs) || 400),
                            listMaxFiles: Math.max(1, Number(cfg.listMaxFiles) || 2000),
                            listMaxDepth: Math.max(1, Number(cfg.listMaxDepth) || 12),
                        },
                    })
                } catch (error) {
                    return writeJson(res, 500, {ok: false, error: messageOf(error)})
                }
            },
        }), 'dsh-omnifile.config')
    }

    const tools = ctx.get('tools')
    if (tools !== undefined) {
        ctx.effect(() => tools.register(defineTool({
            name: 'dshomnifile',
            description: "分析本地文件并把解析结果落盘为 {源文件名}.md，返回一行可读路径引用（解析后保存路径：<md绝对路径>（完整内容见上方文件卡片，可点击展开；源文件：<源文件绝对路径>））；如解析失败/无法读取则返回「解析后保存路径：<源路径>（解析失败/无法按文本读取：原因）」。拿到 md 路径后用内置 read 工具即可读取完整内容。支持的类型与行为：\n" +
                "1）图片（.png/.jpg/.jpeg/.webp/.gif/.bmp/.svg/.avif）：交给配置的多模态模型识别为文字描述并写入 md；同一张图片的结果按内容哈希缓存，不会重复调用多模态服务。若当前模型本身支持 image 输入，直接用 read_image 查看原图更合适（避免重复处理），dshomnifile 的图片模式适合文本-only 模型或需逐字转写的场景。\n" +
                "2）文档（.doc/.docx/.docm/.odt/.pdf/.ppt/.pptx/.rtf/.epub/.xlsx/.ods/.odp/.csv 及 .pps/.pot/.pptm/.ppsx/.ppsm/.xls/.xlsm/.xlsb 等变体）：用 @firecrawl/anydoc 转为 GitHub-Flavored Markdown 并识别内嵌图片，写入 md；纯扫描/图像型 PDF 会用 PyMuPDF 逐页渲染识别并按页序拼装。\n" +
                "3）文本（.json/.txt/.md/.html/.shtml）：直接以 UTF-8/GB18030 解码为文字（JSON 美化、HTML 剥标签），写入 md。\n" +
                "4）其它（音视频等二进制）：无法按文本读取时返回路径与原因（保留大小等元信息）。\n" +
                "5）说明：需先通过「设置-模型」配置一个支持 image 输入的多模态模型并在此插件设置里选择它，否则图片/文档内嵌图片识别会报错。",
            parameters: {
                filePath: {type: 'string', required: true, description: '要分析的文件的绝对路径'},
                prompt: {type: 'string', description: '可选，指定识图时的关注点（仅图片与文档内嵌图片生效）'},
                kind: {type: 'string', description: '可选，显式指定类别（image/doc/text/media/other）；缺省按扩展名推断'},
            },
            output: {
                schema: {type: 'string'},
                render: (_args, value) => [{type: 'text', text: value}],
            },
            isConcurrencySafe: () => true,
            /* 工具与聊天卡片同一套「解析→落盘 {源文件名}.md→给一行可读路径引用」：不把解析全文塞进模型上下文，
             * 模型拿到 md 绝对路径后用内置 read 工具即可读到内容。返回统一为：
             *   解析后保存路径：<md 或源路径>（完整内容见上方文件卡片，可点击展开；源文件：<源路径> | 无法按文本读取：… | 解析失败：…）
             */
            async execute(args, exec) {
                const path = String(args?.filePath ?? '').trim()
                if (path === '') throw new Error('filePath 不能为空')
                const cfg = getConfig()
                const kind = String(args?.kind ?? '').trim() || fileKind(path)
                const prompt = typeof args?.prompt === 'string' && args.prompt !== '' ? args.prompt : undefined
                let cwd = ''
                try { cwd = agentCwd(exec) } catch (error) { cwd = '' }
                const saveMarkdown = async (markdown) => {
                    if (cwd === '') return undefined
                    try { return await writeParsedMarkdown(cwd, path, markdown) } catch (error) { return undefined }
                }
                const ok = async (markdown) => {
                    const mdPath = await saveMarkdown(markdown)
                    /* 成功标记携带源文件绝对路径，客户端卡片据此打开「原始文件」（Req1）。 */
                    return markerText({path: mdPath || path, ok: true, source: path})
                }
                const unreadable = (note) => markerText({path, note})
                try {
                    const stat = await fs.stat(path)
                    if (!stat.isFile()) throw new Error('不是有效文件')
                    if (kind === 'image') {
                        const text = await describeImageCached(ctx, cfg, path, prompt)
                        return await ok(text)
                    }
                    if (kind === 'text') {
                        const result = await processText(ctx, cfg, cwd, path, basename(path))
                        return await ok(result.markdown)
                    }
                    if (kind === 'doc') {
                        const result = await processDocument(ctx, cfg, cwd, path, basename(path))
                        const full = result.markdown + (result.images.length > 0
                            ? '\n\n【文档内嵌图片识别结果】\n' + result.images.map((img) => img.error !== undefined
                                ? '- 图片 ' + img.name + '：识别失败（' + img.error + '）'
                                : '- 图片 ' + img.name + '：' + img.description).join('\n')
                            : '')
                        return await ok(full)
                    }
                    // 未识别的格式：默认按文本读取；读不了返回路径与原因（保留大小等元信息）
                    try {
                        const result = await processText(ctx, cfg, cwd, path, basename(path))
                        return await ok(result.markdown)
                    } catch (error) {
                        const statInfo = await fs.stat(path).catch(() => undefined)
                        return unreadable(messageOf(error) + (statInfo ? '（' + statInfo.size + ' 字节）' : ''))
                    }
                } catch (error) {
                    return markerText({path, ok: false, note: messageOf(error) || MARKER_UNKNOWN})
                }
            },
        })), 'dsh-omnifile.tool')
    }

    return () => {
        disposeVariants()
    }
}
