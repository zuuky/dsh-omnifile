/**
 * dsh-omnifile — 文件适配插件（Host 端）
 *
 * 路由：/api/omnifile/{save,process,status,open,parsed,models,list,config} + common.js
 * 能力：文件接入/解析（anydoc＋纯文本）、多模态识图（内容哈希缓存）、
 *      文本-only 主模型的 omnifile-* 图像变体、omnifile 工具、@ 文件列表。
 *
 * 解析结果统一落盘为 <uploads>/<源文件名>.md，消息里只放一行「解析后保存路径」引用，
 * 大模型按该绝对路径用内置 read 工具读取内容。
 *
 * 构建：本文件由 Vite 编译为 lib/index.js（Node ESM，import './common.js' 保持外部）。
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import { formatFromPath, toDocument, toMarkdown, toMarkdownBytes } from '@firecrawl/anydoc'
import fs from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { basename, extname, join, resolve, sep } from 'node:path'
import { spawn } from 'node:child_process'
import { contentHasImage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { fileURLToPath } from 'node:url'
import {
    KIND_DOC, KIND_IMAGE, KIND_MEDIA, KIND_OTHER, KIND_TEXT,
    MARKER_UNKNOWN, markerText, messageOf, NAMESPACE,
} from './common.js'

export const name = 'dsh-omnifile'
export const inject = ['webServer', 'sessions', 'tools', 'settings', 'credentials', 'llm']

/* 消息标记 / 源文件名引用 / 组装 / messageOf 等双端共用元素统一来自 src/common.ts
 * （唯一来源：改动 MARKER_* 或 markerText 时只需改 common.ts，宿主与客户端自动一致）。
 * NAMESPACE 同样来自 common.ts，此处只保留宿主私有常量。 */
const VARIANT_PREFIX = 'omnifile-'
const VARIANT_SUFFIX = ' (Omnifile)'

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
    /* 上限类参数（可在设置界面配置） */
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

function sanitizeName(name: string): string {
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
 * 公共工具方法（多处共用的数据/字符串组装集中收拢）。
 * ════════════════════════════════════════════════════════════════════════ */
/** 调试日志：仅当 DSH_OMNIFILE_DEBUG=1 时输出，统一前缀 LOG_PREFIX。 */
function debugLog(...args: unknown[]): void {
    if (process.env.DSH_OMNIFILE_DEBUG === '1') console.error(LOG_PREFIX, ...args)
}

/** 文档 Markdown 保留字符上限（cfg.docMaxChars 缺省 120000）。 */
function docChars(cfg: Record<string, any>): number {
    return Math.max(1, Number(cfg?.docMaxChars) || 120000)
}

/** 单个文档交给多模态识别的内嵌图片/扫描页预算（显式传入优先，否则取 cfg.maxDocImages）。 */
function imageBudget(cfg: Record<string, any>, override?: number): number {
    return typeof override === 'number' ? Math.max(0, override) : (cfg?.maxDocImages || 8)
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

/** 会话工作区 uploads 目录（文件落盘/图片落盘共用）。 */
function uploadsDir(cwd: string): string {
    return join(resolve(cwd), 'uploads')
}

/** 会话工作区 uploads/images 目录（文档内嵌图片/PDF 扫描页落盘共用）。 */
function uploadsImagesDir(cwd: string): string {
    return join(resolve(cwd), 'uploads', 'images')
}

async function sessionCwd(ctx: any, sessionId: string): Promise<string> {
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
function agentCwd(exec: any): string {
    const cwd = exec?.agent?.session?.header?.cwd
        ?? exec?.agent?.session?.cwd
        ?? exec?.session?.header?.cwd
        ?? exec?.cwd
    if (typeof cwd !== 'string' || cwd === '') throw new Error(ERR_NO_CWD)
    return cwd
}

function assertWorkspacePath(cwd: string, rawPath: unknown): string {
    if (typeof rawPath !== 'string' || rawPath === '') throw new Error('缺少文件路径')
    const target = resolve(rawPath)
    const root = resolve(cwd) + sep
    if (target !== resolve(cwd) && !target.startsWith(root)) throw new Error('路径不在会话工作区内')
    return target
}

function readBody(req: any, maxBytes: number): Promise<Buffer> {
    return new Promise((resolveBody, reject) => {
        const chunks: Buffer[] = []
        let total = 0
        let aborted = false
        req.on('data', (chunk: Buffer) => {
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

function writeJson(res: any, status: number, body: unknown): void {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(body))
}

async function readJsonBody(req: any, maxBytes: number = MAX_REQUEST_BODY_BYTES): Promise<Record<string, any>> {
    const buf = await readBody(req, maxBytes)
    try {
        return buf.length === 0 ? {} : JSON.parse(buf.toString('utf8'))
    } catch {
        throw new Error('请求体不是有效 JSON')
    }
}

async function resolveApiKey(ctx: any, credential: string): Promise<string> {
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
 *
 * 兼容两类提供商：
 *  - 自定义提供商（settingsPath 非空，如 llm-pi-ai/providers/<route>）：从 settings profile 取 baseURL/apiKeyEnv；
 *  - DSH 内置提供商（settingsPath 为空，如 llm-deepseek/deepseek-official）：settings 里没有 profile 时，
 *    回退到该 provider 的默认端点/凭据（环境变量与已知官方默认），保证「设置-模型」中默认可见的内置
 *    模型也可以被选中使用。
 */
async function resolveConfiguredProvider(
    ctx: any,
    providerRef: string,
): Promise<{ baseUrl: string; credential: string; model: string } | null> {
    if (typeof providerRef !== 'string' || providerRef === '') return null
    const parts = providerRef.split('/')
    if (parts.length < 3) return null
    const ns = parts[0]
    const route = parts[1]
    const modelId = parts.slice(2).join('/')
    const llm = ctx.get('llm')
    if (llm === undefined || typeof llm.listConfigurableProviders !== 'function') return null
    let directory: any[] = []
    try { directory = llm.listConfigurableProviders() } catch { return null }
    const entry = directory.find((e) => e && e.settingsNs === ns && ((e.settingsPath?.[1] === route) || (e.provider === route)))
    if (entry === undefined) return null
    const settingsPath = Array.isArray(entry.settingsPath) ? entry.settingsPath : []
    let raw: any
    try { raw = ctx.settings?.get ? ctx.settings.get(ns) : undefined } catch { raw = undefined }
    let profile: any = raw
    try {
        for (const seg of settingsPath) profile = profile === undefined || profile === null ? undefined : profile[seg]
    } catch { profile = undefined }
    /* 自定义提供商：必须有 baseURL；apiKeyEnv 可选（部分端点无需 key）。 */
    if (profile !== undefined && profile !== null && typeof profile === 'object') {
        const baseUrl = profile.baseURL ?? profile.baseUrl
        if (typeof baseUrl === 'string' && baseUrl !== '') {
            return {
                baseUrl,
                credential: typeof profile.apiKeyEnv === 'string' ? profile.apiKeyEnv : '',
                model: modelId,
            }
        }
    }
    /* 内置提供商（settingsPath 为空，无 profile）：回退默认端点/凭据。 */
    if (settingsPath.length === 0) {
        const fallback = builtinProviderDefaults(route, ns)
        if (fallback !== null) {
            /* 环境变量优先（DSH 允许以环境变量覆盖内置 provider 的端点），否则用已知官方默认；
             * credential 即该 provider 的凭据引用（cref），resolveApiKey 会从凭据服务/环境解析。 */
            const envBase = process.env[fallback.baseUrlEnv]
            const baseUrl = typeof envBase === 'string' && envBase !== '' ? envBase : fallback.baseUrl
            return { baseUrl, credential: fallback.credentialEnv, model: modelId }
        }
    }
    return null
}

/** DSH 内置提供商（dsh-llm-* adapter 注册、settingsPath 为空）的默认端点/凭据回退。 */
function builtinProviderDefaults(provider: string, settingsNs: string): { baseUrl: string; credentialEnv: string; baseUrlEnv: string } | null {
    if (provider === 'deepseek-official' || settingsNs === 'llm-deepseek') {
        return {
            baseUrl: 'https://api.deepseek.com',
            credentialEnv: 'DEEPSEEK_API_KEY',
            baseUrlEnv: 'DEEPSEEK_BASE_URL',
        }
    }
    return null
}

/** 模型 id/name 中常见的“视觉/多模态”特征关键字（用于 adapter 未声明能力时推断）。 */
const VISION_HINT_RE = /(^|[-_.\s])(vision|vl|visual|omni|image|img|vlm|multimodal)([-_.\s]|$)/i

/**
 * 推断一个用户显式配置的模型是否为视觉模型：
 *  - adapter 已声明支持 image（modalities 含 image）→ 直接返回 true；
 *  - 设置 profile 里显式声明了该模型（dir.profile.models 命中），且模型 id/name 含视觉关键字 →
 *    推断为视觉模型（覆盖 DSH adapter 对内置模型一律报 text-only 的局限，如 deepseek-v4-flash-vision-exp）。
 */
function inferModelImage(modalities: string[], dir: any, modelId: string): boolean {
    if (Array.isArray(modalities) && modalities.includes('image')) return true
    const profileModels = Array.isArray(dir?.profile?.models) ? dir.profile.models : []
    const declared = profileModels.find((m: any) => m !== null && typeof m === 'object' && String(m.id ?? '') === modelId)
    if (declared === undefined) return false
    const modelInput = Array.isArray(declared.input) ? declared.input.map(String) : []
    if (modelInput.includes('image') || (Array.isArray(dir?.defaultInput) && dir.defaultInput.includes('image'))) return true
    const haystack = String(declared.name ?? '') + ' ' + String(declared.id ?? '')
    return VISION_HINT_RE.test(haystack)
}

/**
 * 全面枚举当前生效的多模态候选模型（供 /api/omnifile/models 与设置页点选）。
 * 数据源（按权威性）：
 *  1) llm.listProviders() + llm.listModels(provider)：已注册 adapter 实时公布的模型（含 DSH 内置
 *     DeepSeek、用户配置的 pi-ai 等），inputModalities 是模型能力的权威来源；
 *  2) 可配置提供商目录（listConfigurableProviders）的 settings profile：补充 displayName/baseURL/apiKeyEnv
 *     展示信息，以及「adapter 未公布但用户在设置里显式声明」的模型（回退）。
 * - 跳过本插件注册的 omnifile-* 变体提供商（它们是给文本主模型转述用的包装，不能作为识图模型）。
 * - 每一项标注 image（是否支持图片输入），客户端据此提示用户；纯文本模型也可列出、可选择，
 *   但识图调用会失败——由 UI 提示避免误用。
 * - ref 与 resolveConfiguredProvider 解析规则一致：<settingsNs>/<settingsPath[1] | provider>/<modelId>。
 */
async function enumerateModels(ctx: any): Promise<any[]> {
    const llm = ctx.get('llm')
    const providers: any[] = []
    const seen = new Set<string>()
    const push = (item: any) => {
        const key = item.provider + '/' + item.modelId
        const dedupe = item.settingsNs + '/' + item.provider + '/' + item.modelId
        if (seen.has(dedupe)) return
        seen.add(dedupe)
        providers.push(item)
    }
    if (llm === undefined) return providers

    /* ── 目录 + settings profile（展示信息 + profile 显式模型的回退源） ── */
    let directory: any[] = []
    try { directory = typeof llm.listConfigurableProviders === 'function' ? llm.listConfigurableProviders() : [] } catch { /* ignore */ }
    interface DirInfo {
        provider: string
        displayName: string
        settingsNs: string
        settingsPath: string[]
        route: string
        baseURL: string
        apiKeyEnv: string
        defaultInput: string[]
        profile?: Record<string, any>
    }
    const dirByRoute = new Map<string, DirInfo>()
    for (const entry of directory) {
        if (entry === null || typeof entry !== 'object') continue
        const settingsNs = String(entry.settingsNs ?? '')
        const provider = String(entry.provider ?? '')
        const settingsPath = Array.isArray(entry.settingsPath) ? entry.settingsPath.map(String) : []
        if (settingsNs === '' || provider === '') continue
        const route = settingsPath[1] ?? provider
        let raw: any
        try { raw = ctx.settings?.get ? ctx.settings.get(settingsNs) : undefined } catch { raw = undefined }
        let profile: any = raw
        try {
            for (const seg of settingsPath) profile = profile === undefined || profile === null ? undefined : profile[seg]
        } catch { profile = undefined }
        const baseURL = (typeof (profile?.baseURL) === 'string' ? profile.baseURL : undefined)
            ?? (typeof (profile?.baseUrl) === 'string' ? profile.baseUrl : '')
        const dir: DirInfo = {
            provider,
            displayName: String(entry.displayName ?? provider),
            settingsNs,
            settingsPath,
            route,
            baseURL: baseURL || '',
            apiKeyEnv: typeof (profile?.apiKeyEnv) === 'string' ? profile.apiKeyEnv : '',
            defaultInput: Array.isArray(profile?.defaultInput) ? profile.defaultInput.map(String) : [],
        }
        if (profile !== undefined && profile !== null && typeof profile === 'object' && Array.isArray(profile.models)) {
            dir.profile = profile
        }
        const slot = settingsNs + '/' + route
        if (!dirByRoute.has(slot) || dir.baseURL !== '' || (dirByRoute.get(slot) as DirInfo).baseURL === '') {
            dirByRoute.set(slot, dir)
        } else {
            const prev = dirByRoute.get(slot) as DirInfo
            if (dir.baseURL !== '') prev.baseURL = dir.baseURL
            if (dir.apiKeyEnv !== '') prev.apiKeyEnv = dir.apiKeyEnv
            if (dir.defaultInput.length > 0) prev.defaultInput = dir.defaultInput
        }
    }

    /* ── 1) adapter 实时目录：所有已注册 provider 的模型 ── */
    const liveByProvider = new Map<string, string[]>()
    for (const providerInfo of (() => { try { return typeof llm.listProviders === 'function' ? llm.listProviders() : [] } catch { return [] } })()) {
        const providerId = String(providerInfo?.id ?? '')
        if (providerId === '' || providerId.startsWith('omnifile-')) continue
        let models: any[] = []
        try {
            models = typeof llm.listModels === 'function' ? await llm.listModels(providerId) : []
        } catch { /* 该 provider 模型目录不可用，尝试 profile 回退 */ }
        if (Array.isArray(models) && models.length > 0) liveByProvider.set(providerId, models.map((m) => String(m?.id ?? '')).filter((id) => id !== ''))
        for (const model of (Array.isArray(models) ? models : [])) {
            if (model === null || typeof model !== 'object') continue
            const modelId = String(model.id ?? '')
            if (modelId === '') continue
            const modalities = Array.isArray(model.inputModalities) ? model.inputModalities.map(String) : []
            /* 匹配目录条目：entry.provider 或 settingsPath[1] 等于该 adapter provider id */
            let dir: DirInfo | undefined
            for (const d of dirByRoute.values()) {
                if (d.provider === providerId || d.route === providerId) { dir = d; break }
            }
            /* adapter 一律报 text-only 的内置模型（如 deepseek-v4-flash-vision-exp），
             * 若用户在设置里显式声明且名字带视觉关键字，推断为视觉模型。 */
            const image = inferModelImage(modalities, dir, modelId)
            const settingsNs = dir?.settingsNs ?? ''
            const route = dir?.route ?? providerId
            push({
                ref: settingsNs + '/' + route + '/' + modelId,
                provider: route,
                providerDisplay: dir?.displayName ?? providerId,
                settingsNs,
                modelId,
                modelName: typeof model.name === 'string' && model.name !== '' ? model.name : modelId,
                baseURL: dir?.baseURL ?? '',
                apiKeyEnv: dir?.apiKeyEnv ?? '',
                image,
                modalities: image ? ['text', 'image'] : modalities,
                source: 'adapter',
            })
        }
    }

    /* ── 2) profile 显式声明但 adapter 未公布的模型（回退，覆盖旧逻辑） ── */
    for (const dir of dirByRoute.values()) {
        if (dir.profile === undefined || dir.route.startsWith('omnifile-')) continue
        const defaultInput = dir.defaultInput
        const models = Array.isArray(dir.profile.models) ? dir.profile.models : []
        for (const model of models) {
            if (model === null || typeof model !== 'object') continue
            const modelId = String(model.id ?? '')
            if (modelId === '') continue
            /* adapter 已公布则跳过（去重仍按 settingsNs+route+modelId） */
            const dupKey = dir.settingsNs + '/' + dir.route + '/' + modelId
            if (seen.has(dupKey)) continue
            const modelInput = Array.isArray(model.input) ? model.input.map(String) : defaultInput
            const image = defaultInput.includes('image') || modelInput.includes('image')
                || inferModelImage([], dir, modelId)
            push({
                ref: dupKey,
                provider: dir.route,
                providerDisplay: dir.displayName,
                settingsNs: dir.settingsNs,
                modelId,
                modelName: typeof model.name === 'string' && model.name !== '' ? model.name : modelId,
                baseURL: dir.baseURL,
                apiKeyEnv: dir.apiKeyEnv,
                image,
                modalities: image ? ['text', 'image'] : ['text'],
                source: 'profile',
            })
        }
    }

    providers.sort((a, b) =>
        String(a.providerDisplay ?? '').localeCompare(String(b.providerDisplay ?? ''))
        || String(a.modelId ?? '').localeCompare(String(b.modelId ?? '')))
    return providers
}



/**
 * 解析当前生效的多模态提供商：只认「设置-模型」中选择的 providerRef（唯一来源）。
 * 未选择时抛错，提示去设置页选择（不保存多份模型配置，也没有手动备用方案）。
 */
async function resolveProvider(ctx: any, cfg: Record<string, any>): Promise<any> {
    const ref = await resolveConfiguredProvider(ctx, cfg.providerRef)
    if (ref !== null) {
        ;(ref as any).reasoningEffort = (ref as any).reasoningEffort || cfg.reasoningEffort || 'medium'
        return ref
    }
    if (cfg.providerRef !== undefined && cfg.providerRef !== '') {
        throw new Error('多模态模型配置无效：providerRef="' + cfg.providerRef + '" 在「设置-模型」中不存在，请重新选择')
    }
    throw new Error('未配置多模态模型：请在设置 → DshOmniFile → 从「设置-模型」中选择一个多模态模型')
}

async function describeImage(ctx: any, cfg: Record<string, any>, imagePath: string, prompt: string): Promise<string> {
    const provider = await resolveProvider(ctx, cfg)
    const apiKey = await resolveApiKey(ctx, provider.credential)
    const baseUrl = String(provider.baseUrl || '').replace(/\/+$/, '')
    const data = await fs.readFile(imagePath)
    const mime = mimeFor(imagePath)
    const body: Record<string, any> = {
        model: provider.model,
        messages: [
            { role: 'system', content: DESCRIBE_SYSTEM },
            {
                role: 'user',
                content: [
                    { type: 'image_url', image_url: { url: 'data:' + mime + ';base64,' + data.toString('base64') } },
                    { type: 'text', text: prompt || cfg.describePrompt || DEFAULT_DESCRIBE_PROMPT },
                ],
            },
        ],
        stream: false,
        max_tokens: cfg.maxTokens >= 1 ? cfg.maxTokens : 8192,
    }
    /* 常规采样参数：temperature / top_p 由配置下发（默认 0.7 / 1，等价于确定性采样）。 */
    if (typeof cfg.temperature === 'number' && Number.isFinite(cfg.temperature)) body.temperature = cfg.temperature
    if (typeof cfg.topP === 'number' && Number.isFinite(cfg.topP)) body.top_p = cfg.topP
    const thinking = cfg.thinking === true
    body.reasoning_effort = thinking ? (provider.reasoningEffort || 'medium') : 'none'
    body.chat_template_kwargs = { enable_thinking: thinking }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs || 60000)
    try {
        const response = await fetch(baseUrl + '/chat/completions', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                ...(apiKey !== '' ? { authorization: 'Bearer ' + apiKey } : {}),
            },
            body: JSON.stringify(body),
            signal: controller.signal,
        })
        if (!response.ok) {
            const detail = (await response.text().catch(() => '')).slice(0, 500)
            throw new Error('多模态模型请求失败 HTTP ' + response.status + ': ' + detail)
        }
        const json: any = await response.json()
        const contentValue = json?.choices?.[0]?.message?.content
        const text = Array.isArray(contentValue) ? contentValue.map((part: any) => part?.text ?? '').join('') : contentValue
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
 * 避免对话历史里同一图片每轮都被重复识别。
 * 缓存上限 DESCRIBE_CACHE_MAX 在文件顶部声明，apply() 时按 cfg.describeCacheMax 覆盖。
 * ═══════════════════════════════════════════════════════════════════ */

/** 图片内容哈希缓存（path → size/mtime/hash）：文件被重写后 mtime 变化，用 stat 对不上，故缓存哈希避免反复读文件。 */
const imageHashCache = new Map<string, { size: number; mtimeMs: number; hash: string }>()
/** 多模态描述结果缓存（key → 描述文本），LRU 淘汰。key = 图片内容哈希|最终提示词|端点|模型。 */
const describeCache = new Map<string, { value: string }>()

/** 归一化发送给多模态模型的提示词：显式传入优先，否则用配置默认。 */
function effectivePrompt(cfg: Record<string, any>, prompt?: string): string {
    return typeof prompt === 'string' && prompt !== '' ? prompt : (cfg.describePrompt || DEFAULT_DESCRIBE_PROMPT)
}

/** 计算图片内容哈希（带 stat 命中缓存，避免反复读文件）。 */
async function imageHash(imagePath: string): Promise<string | null> {
    const stat = await fs.stat(imagePath).catch(() => undefined)
    if (stat === undefined) return null
    const cached = imageHashCache.get(imagePath)
    if (cached !== undefined && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) return cached.hash
    const data = await fs.readFile(imagePath)
    const hash = createHash('sha256').update(data).digest('hex')
    imageHashCache.set(imagePath, { size: stat.size, mtimeMs: stat.mtimeMs, hash })
    if (imageHashCache.size > DESCRIBE_CACHE_MAX * 2) {
        for (const key of imageHashCache.keys()) {
            imageHashCache.delete(key)
            if (imageHashCache.size <= DESCRIBE_CACHE_MAX) break
        }
    }
    return hash
}

function describeCacheGet(key: string): string | undefined {
    const entry = describeCache.get(key)
    if (entry === undefined) return undefined
    describeCache.delete(key)
    describeCache.set(key, entry) // 命中即视为最近使用
    return entry.value
}

function describeCacheSet(key: string, value: string): void {
    describeCache.delete(key)
    describeCache.set(key, { value })
    if (describeCache.size > DESCRIBE_CACHE_MAX) {
        const oldest = describeCache.keys().next().value
        if (oldest !== undefined) describeCache.delete(oldest)
    }
}

/**
 * 带缓存的多模态识别：同一图片内容（内容哈希相同）+ 相同提示词 + 相同端点时直接复用上次结果。
 * 这是“同一图片多次走多模态模型”的核心修复：对话历史中同一附件每轮都会被转换，
 * 缓存命中后不再发起模型请求，也消除了随之而来的重复“Deep diving...”等待。
 */
async function describeImageCached(ctx: any, cfg: Record<string, any>, imagePath: string, prompt?: string): Promise<string> {
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
const progressStore = new Map<string, { stage?: string; detail?: string; done?: number; total?: number; updatedAt: number }>()

function setProgress(token: string, patch: Record<string, any>): void {
    if (typeof token !== 'string' || token === '') return
    const prev = progressStore.get(token)
    progressStore.set(token, { ...(prev ?? {}), ...patch, updatedAt: Date.now() })
}

function clearProgress(token: string): void {
    if (typeof token !== 'string' || token === '') return
    progressStore.delete(token)
}

function createLimiter(limit: number): <T>(task: () => Promise<T>) => Promise<T> {
    const max = Math.max(1, Math.floor(Number(limit) || 1))
    let active = 0
    const waiting: Array<() => void> = []
    const acquire = () => new Promise<void>((resolveAcquire) => {
        if (active < max) {
            active += 1
            resolveAcquire()
            return
        }
        waiting.push(resolveAcquire)
    })
    const release = () => {
        const next = waiting.shift()
        if (next !== undefined) {
            next()
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

function extnameOfMedia(mediaType: string): string {
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
async function renderPdfPagesWithPymupdf(filePath: string): Promise<Array<{ data: Buffer; mediaType: string; page: number }>> {
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
    let output: string | Buffer = ''
    let meta = ''
    await new Promise<void>((resolveRun, rejectRun) => {
        const child = spawn('python', ['-c', script, filePath], { stdio: ['ignore', 'pipe', 'pipe'] })
        const outBuf: Buffer[] = []
        child.stdout.on('data', (chunk: Buffer) => {
            outBuf.push(chunk)
        })
        child.stderr.on('data', (chunk: Buffer) => {
            meta += chunk.toString('utf8')
        })
        child.on('error', rejectRun)
        child.on('close', () => {
            output = Buffer.concat(outBuf)
            resolveRun()
        })
    })
    if (meta.includes('__PYMUPDF_MISSING__')) throw new Error('pymupdf 未安装')
    const pages: Array<{ data: Buffer; mediaType: string; page: number }> = []
    const body = Buffer.from(output)
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
        if (png.length > 0) pages.push({ data: Buffer.from(png), mediaType: 'image/png', page: pages.length + 1 })
        idx = end
    }
    return pages
}

/**
 * 纯扫描/纯图片 PDF 的多模态兜底：anydoc 转不出文本时，用 PyMuPDF 把每页渲染为 PNG，
 * 交给多模态模型逐页识别（不依赖任何 PDF 解析库的图片提取，PyMuPDF 是唯一兜底通道）。
 */
async function describePdfFallback(cfg: Record<string, any>, filePath: string): Promise<{ images: Array<{ data: Buffer; mediaType: string; page: number }>; errors: string[]; source?: string }> {
    const errors: string[] = []
    try {
        const pages = await renderPdfPagesWithPymupdf(filePath)
        if (pages.length > 0) return { images: pages, errors: [], source: 'pymupdf' as string }
        errors.push('pymupdf 未渲染出页面')
    } catch (error) {
        errors.push('pymupdf 渲染失败：' + messageOf(error))
    }
    return { images: [], errors }
}

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
 * 由源文件路径推导解析结果路径（<workspace>/uploads/<源文件名>.md）。
 * 源文件名默认取源文件 basename，也可显式传入原始文件名（./process 收到 body.name 时）。
 * 形态统一为「{源文件名}.md」，便于大模型直接对保存路径触发 read 工具。
 */
function parsedMarkdownPath(cwd: string, sourcePath: string, sourceName?: string): string {
    const name = sanitizeName(sourceName || basename(sourcePath)) || 'file'
    return join(resolve(cwd), 'uploads', name + '.md')
}

/** 把解析出的 Markdown 落盘到 <uploads>/<源文件名>.md，供折叠卡片懒加载与大模型 read。 */
async function writeParsedMarkdown(cwd: string, sourcePath: string, markdown: string, sourceName?: string): Promise<string | undefined> {
    try {
        const parsedPath = parsedMarkdownPath(cwd, sourcePath, sourceName)
        await fs.mkdir(uploadsDir(cwd), { recursive: true })
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
async function processDocument(
    ctx: any,
    cfg: Record<string, any>,
    cwd: string,
    filePath: string,
    fileName: string,
    limitImages?: number,
    onProgress?: (patch: { stage: string; detail: string; done: number; total: number }) => void,
): Promise<{ markdown: string; images: Array<Record<string, any>>; truncated: boolean; textError?: string }> {
    const imagesDir = uploadsImagesDir(cwd)
    const bytes = await fs.readFile(filePath)
    const fmt = typeof formatFromPath === 'function' ? formatFromPath(filePath) : undefined
    const isPdf = fmt === 'pdf'
    onProgress?.({ stage: 'doc', detail: '正在解析文档...', done: 0, total: 1 })

    // 1) 文档模型 + 内嵌图片（PDF 无文档模型，跳过）
    let assets: any[] = []
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
    let mdError: unknown = undefined
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
    const savedImages: Array<Record<string, any>> = []

    // 2.5) anydoc 支持格式解析失败时的多模态兜底：
    //      - PDF：Markdown 失败/空文本时用 PyMuPDF 逐页渲染 PNG 识别；
    //      - 非 PDF：文档 Markdown 失败时，下方第 3 步会把 toDocument 的图片交给多模态识别。
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
                        await fs.mkdir(imagesDir, { recursive: true })
                        await fs.writeFile(assetPath, img.data)
                        onProgress?.({ stage: 'image', detail: '识别扫描页 ' + (index + 1) + '/' + chosen.length, done: index + 1, total: chosen.length })
                        const description = await limitPdf(() => describeImageCached(ctx, cfg, assetPath, cfg.describePrompt || DEFAULT_DESCRIBE_PROMPT))
                        pdfResults[index] = {
                            path: assetPath,
                            name: basename(assetPath),
                            mediaType: img.mediaType,
                            description,
                            pdfPage: img.page,
                        }
                    } catch (error) {
                        pdfResults[index] = {
                            path: undefined,
                            name: 'pdf-page-' + (index + 1),
                            mediaType: img.mediaType,
                            error: messageOf(error),
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
    const candidates = assets.filter((asset: any) => {
        const mt = String(asset.mediaType || '').toLowerCase()
        return mt.startsWith('image/') && Buffer.isBuffer(asset.data) && asset.data.length > 0
    })
    const chosen = candidates.slice(0, budget)
    /* 保持文档内嵌图片原有顺序：并行识别后按索引对齐再拼装。 */
    const imageResults = new Array(chosen.length)
    await Promise.all(chosen.map(async (asset: any, index: number) => {
        try {
            const ext = extnameOfMedia(asset.mediaType)
            const stamp = randomUUID().slice(0, 8)
            const base = sanitizeName(fileName).replace(/\.[^.]+$/, '')
            const assetPath = join(imagesDir, base + '-' + stamp + '-' + (index + 1) + ext)
            await fs.mkdir(imagesDir, { recursive: true })
            await fs.writeFile(assetPath, asset.data)
            onProgress?.({ stage: 'image', detail: '识别内嵌图片 ' + (index + 1) + '/' + chosen.length, done: index + 1, total: chosen.length })
            const description = await limit(() => describeImageCached(ctx, cfg, assetPath, cfg.describePrompt || DEFAULT_DESCRIBE_PROMPT))
            imageResults[index] = { path: assetPath, name: basename(assetPath), mediaType: asset.mediaType, description }
        } catch (error) {
            imageResults[index] = {
                path: undefined,
                name: 'image-' + (index + 1),
                mediaType: asset.mediaType,
                error: messageOf(error),
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
    return { markdown: body, images: savedImages, truncated: markdownRaw.length > maxChars, textError }
}

function shouldWrapModel(info: any): boolean {
    return Array.isArray(info?.inputModalities) && !info.inputModalities.includes('image')
}

/** 取消息列表里最新的用户文本问题（供识图提示词上下文使用）。 */
function lastUserQuestion(messages: any[] | undefined): string {
    if (!Array.isArray(messages)) return ''
    for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i]
        if (message?.role !== 'user') continue
        const content = message.content
        const text = Array.isArray(content)
            ? content.filter((block: any) => block?.type === 'text').map((block: any) => String(block.text ?? '')).join('\n')
            : (typeof content === 'string' ? content : '')
        const trimmed = text.trim()
        if (trimmed !== '') return trimmed
    }
    return ''
}

class OmnifileVariantAdapter extends LlmAdapter {
    private ctx: any
    private llm: any
    private upstream: string
    private upstreamName: string
    private getConfig: () => Record<string, any>

    constructor(ctx: any, llm: any, upstream: string, upstreamName: string, getConfig: () => Record<string, any>) {
        super()
        this.ctx = ctx
        this.llm = llm
        this.upstream = upstream
        this.upstreamName = upstreamName
        this.getConfig = getConfig
    }

    providerInfo(provider: string): { id: string; name: string } {
        return { id: provider, name: this.upstreamName + VARIANT_SUFFIX }
    }

    async listModels(provider: string, signal?: AbortSignal): Promise<any[]> {
        const models = await this.llm.listModels(this.upstream, signal)
        return models
            .filter((m: any) => shouldWrapModel(m))
            .map((m: any) => ({
                provider,
                id: m.id,
                name: m.name + VARIANT_SUFFIX,
                inputModalities: ['text', 'image'],
                ...(m.description !== undefined ? { description: m.description } : {}),
            }))
    }

    async resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<any> {
        const info = await this.llm.resolveModelInfo(this.upstream, model, signal)
        if (!shouldWrapModel(info)) throw new Error('model "' + model + '" is not text-only; no omnifile variant needed')
        return {
            provider,
            id: model,
            name: info.name + VARIANT_SUFFIX,
            inputModalities: ['text', 'image'],
            ...(info.description !== undefined ? { description: info.description } : {}),
            ...(info.context !== undefined ? { context: info.context } : {}),
            ...(info.defaultMaxTokens !== undefined ? { defaultMaxTokens: info.defaultMaxTokens } : {}),
            ...(info.reasoning !== undefined ? { reasoning: info.reasoning } : {}),
        }
    }

    async *stream(options: any): AsyncGenerator<any> {
        const cfg = this.getConfig()
        const messages = await this.rewriteMessages(cfg, options.messages, options.signal, options.sessionId)
        yield* this.llm.stream({ ...options, provider: this.upstream, messages })
    }

    async rewriteMessages(cfg: Record<string, any>, messages: any[], signal: AbortSignal | undefined, sessionId: string | undefined): Promise<any[]> {
        if (!messages.some((message) => contentHasImage(message.content))) return messages
        const limit = createLimiter(cfg.concurrency || 1)
        /* 发送时取最新用户问题，让多模态识图围绕问题生成描述（与问题匹配）。 */
        const question = lastUserQuestion(messages)
        const out: any[] = []
        for (const message of messages) {
            if (!contentHasImage(message.content)) {
                out.push(message)
                continue
            }
            const content = await this.convertBlocks(cfg, message.content, limit, signal, sessionId, question)
            out.push({ ...message, content })
        }
        return out
    }

    async convertBlocks(cfg: Record<string, any>, blocks: any[], limit: ReturnType<typeof createLimiter>, signal: AbortSignal | undefined, sessionId: string | undefined, question: string): Promise<any[]> {
        const result: any[] = []
        let channelInserted = false
        for (const block of blocks) {
            if (block.type === 'tool-result' && contentHasImage(block.content)) {
                const nested = await this.convertBlocks(cfg, block.content, limit, signal, sessionId, question)
                result.push({ ...block, content: nested })
                continue
            }
            if (block.type !== 'image') {
                result.push(block)
                continue
            }
            if (!channelInserted) {
                result.push({
                    type: 'text',
                    text: '[dshomnifile] 这里的图片已经由多模态模型转换成文字说明，你只收到描述文本，不包含视觉 Token；图片绝对路径一并附上，需要更多视觉证据时可读该路径。',
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
                    const basePrompt = cfg.describePrompt || DEFAULT_DESCRIBE_PROMPT
                    const questionText = typeof question === 'string' ? question.trim().slice(0, 600) : ''
                    /* 发送时带上用户问题：识别描述围绕问题生成，避免“识别结果与问题不匹配”。 */
                    const describePrompt = questionText !== ''
                        ? basePrompt + '\n\n用户的问题是：「' + questionText + '」。请围绕该问题重点描述图片中相关的关键细节（文字、数据、界面元素等），以供一个无法看到图片的模型回答问题。'
                        : basePrompt
                    const description = await describeImageCached(this.ctx, cfg, pathEvidence.path, describePrompt)
                    return {
                        type: 'text',
                        text: '图片绝对路径: ' + JSON.stringify(pathEvidence.path) + '\n多模态模型描述： ' + description,
                    }
                } catch (error) {
                    return { type: 'text', text: '[dshomnifile 不可用] ' + messageOf(error).slice(0, 300) }
                }
            })
            result.push(replacement)
        }
        return result
    }

    async materializeAsEvidence(block: any, attachmentService: any, cwd: string | undefined): Promise<{ path: string }> {
        if (attachmentService === undefined) throw new Error('附件服务不可用')
        const stored = await attachmentService.readImage(block.attachment)
        const data = stored?.data
        if (!(data instanceof Uint8Array) && !Buffer.isBuffer(data)) throw new Error('无法读取附件图片字节')
        const ext = extnameOfMedia(block.attachment?.mediaType || '')
        const hash = createHash('sha256').update(String(block.attachment?.attachmentId ?? '')).digest('hex').slice(0, 16)
        if (typeof cwd === 'string' && cwd !== '') {
            const imagesDir = uploadsImagesDir(cwd)
            await fs.mkdir(imagesDir, { recursive: true })
            const path = join(imagesDir, 'attachment-' + hash + ext)
            await fs.writeFile(path, Buffer.from(data))
            return { path }
        }
        const tmp = process.env.TEMP || process.env.TMP || '/tmp'
        const path = join(tmp, 'omnifile-' + hash + ext)
        await fs.writeFile(path, Buffer.from(data))
        return { path }
    }
}

function installVariants(ctx: any, getConfig: () => Record<string, any>): () => void {
    const registrations = new Map<string, () => void>()
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
            let providers: any[]
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
                let models: any[]
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

function openLocally(path: string): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolveOpen) => {
        let child: any
        try {
            if (process.platform === 'win32') {
                child = spawn('cmd', ['/c', 'start', '', path], { detached: true, stdio: 'ignore' })
            } else if (process.platform === 'darwin') {
                child = spawn('open', [path], { detached: true, stdio: 'ignore' })
            } else {
                child = spawn('xdg-open', [path], { detached: true, stdio: 'ignore' })
            }
        } catch (error) {
            resolveOpen({ ok: false, error: messageOf(error) })
            return
        }
        child?.unref?.()
        resolveOpen({ ok: true })
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

async function walkWorkspaceFiles(cwd: string, options: { maxFiles?: number; maxDepth?: number } = {}): Promise<Array<{ name: string; path: string; rel: string; kind: string; size: number }>> {
    const maxFiles = options.maxFiles || 2000
    const maxDepth = options.maxDepth || 12
    const files: Array<{ name: string; path: string; rel: string; kind: string; size: number }> = []
    const seen = new Set<string>()
    const walk = async (dir: string, rel: string, depth: number): Promise<void> => {
        if (files.length >= maxFiles) return
        if (depth > maxDepth) return
        let entries: any[]
        try {
            entries = await fs.readdir(dir, { withFileTypes: true })
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
                files.push({ name, path: abs, rel: relPath, kind: fileKind(name), size })
            }
        }
    }
    await walk(resolve(cwd), '', 0)
    files.sort((a, b) => a.rel.localeCompare(b.rel))
    return files
}

function loadConfig(ctx: any): Record<string, any> {
    let stored: any
    try {
        stored = ctx.settings ? ctx.settings.get(NAMESPACE) : undefined
    } catch {
        stored = undefined
    }
    return stored !== undefined && stored !== null && typeof stored === 'object' ? stored : {}
}

export function apply(ctx: any, config: Record<string, any> = {}): () => void {
    const forced = { ...config }
    if (typeof ctx.settings?.register === 'function') {
        ctx.settings.register(NAMESPACE, Config, { base: forced, applies: 'live' })
    }
    const getConfig = (): Record<string, any> => {
        const stored = loadConfig(ctx)
        if (Object.keys(stored).length > 0) {
            return { ...forced, ...stored }
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
        /* 把 lib/common.js 原文按 ESM 提供给浏览器端 client（dynamic import 用）：
         * DSH 只把一个客户端 bundle 交给浏览器，无法 require 兄弟文件，故由宿主挂这个
         * 路由返回 common.js 源码；改动共用的常量/字符串/函数只需改 src/common.ts 一处。 */
        ctx.effect(() => webServer.register({
            kind: 'exact',
            path: '/api/omnifile/common.js',
            handler: async (req: any, res: any) => {
                try {
                    const commonPath = fileURLToPath(new URL('./common.js', import.meta.url))
                    const data = await fs.readFile(commonPath)
                    res.writeHead(200, {
                        'content-type': 'application/javascript; charset=utf-8',
                        'content-length': data.length,
                        'cache-control': 'no-store',
                    })
                    res.end(data)
                } catch (error) {
                    writeJson(res, 500, { ok: false, error: messageOf(error) })
                }
            },
        }), 'dsh-omnifile.common-js')

        ctx.effect(() => webServer.register({
            kind: 'exact',
            path: '/api/omnifile/save',
            handler: async (req: any, res: any) => {
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
                        return writeJson(res, 400, { ok: false, error: '参数不完整（sessionId/name/base64）' })
                    }
                    if (base64.length > maxBase64Chars) {
                        return writeJson(res, 400, { ok: false, error: '文件过大（超过上传上限）' })
                    }
                    let bytes: Buffer
                    try {
                        bytes = Buffer.from(base64, 'base64')
                    } catch {
                        return writeJson(res, 400, { ok: false, error: '文件内容无效' })
                    }
                    if (bytes.length > maxFileBytes) {
                        return writeJson(res, 400, {
                            ok: false,
                            error: '文件超过大小上限 ' + Math.round(maxFileBytes / 1024 / 1024) + 'MB',
                        })
                    }
                    const cwd = await sessionCwd(ctx, sessionId)
                    const fileName = Date.now() + '-' + sanitizeName(name)
                    const dir = uploadsDir(cwd)
                    await fs.mkdir(dir, { recursive: true })
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
                    return writeJson(res, 500, { ok: false, error: '保存失败：' + messageOf(error) })
                }
            },
        }), 'dsh-omnifile.save')

        ctx.effect(() => webServer.register({
            kind: 'exact',
            path: '/api/omnifile/process',
            handler: async (req: any, res: any) => {
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
                        setProgress(token, { stage: 'image', detail: '正在调用多模态模型识别图片...', done: 0, total: 1 })
                        const text = await describeImageCached(ctx, cfg, target, undefined)
                        /* 图片描述同样落盘为 <uploads>/<源文件名>.md，消息里只放一行可读引用 */
                        const parsedPath = await writeParsedMarkdown(cwd, target, text, srcName)
                        setProgress(token, { stage: 'image', detail: '识别完成', done: 1, total: 1 })
                        return writeJson(res, 200, { ok: true, kind: 'image', text, parsedPath, path: target })
                    }
                    if (kind === 'text') {
                        setProgress(token, { stage: 'text', detail: '正在读取文本文件...', done: 0, total: 1 })
                        const result = await processText(ctx, cfg, cwd, target, basename(target))
                        const parsedPath = await writeParsedMarkdown(cwd, target, result.markdown, srcName)
                        setProgress(token, { stage: 'text', detail: '读取完成', done: 1, total: 1 })
                        return writeJson(res, 200, { ok: true, kind: 'text', parsedPath, ...result, path: target })
                    }
                    if (kind === 'doc') {
                        setProgress(token, { stage: 'doc', detail: '正在解析文件...', done: 0, total: 1 })
                        const result = await processDocument(ctx, cfg, cwd, target, basename(target), undefined, (patch) => setProgress(token, patch))
                        // 解析结果落盘为 <uploads>/<源文件名>.md，折叠卡片懒加载与大模型 read 用同一路径
                        const parsedPath = await writeParsedMarkdown(cwd, target, result.markdown, srcName)
                        setProgress(token, { stage: 'doc', detail: '解析完成', done: 1, total: 1 })
                        return writeJson(res, 200, { ok: true, kind: 'doc', parsedPath, ...result, path: target })
                    }
                    // 未识别的格式（如 .js/.ts/...）若可按文本读取则按文本处理，读不了就提示并保留路径
                    try {
                        setProgress(token, { stage: 'text', detail: '正在解析文件...', done: 0, total: 1 })
                        const result = await processText(ctx, cfg, cwd, target, basename(target))
                        const parsedPath = await writeParsedMarkdown(cwd, target, result.markdown, srcName)
                        setProgress(token, { stage: 'text', detail: '解析完成', done: 1, total: 1 })
                        return writeJson(res, 200, { ok: true, kind: 'text', parsedPath, ...result, path: target, note: '未知格式，已按文本读取。' })
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
                    return writeJson(res, 500, { ok: false, error: messageOf(error) || '解析失败' })
                } finally {
                    clearProgress(token)
                }
            },
        }), 'dsh-omnifile.process')

        ctx.effect(() => webServer.register({
            kind: 'exact',
            path: '/api/omnifile/status',
            handler: async (req: any, res: any) => {
                try {
                    const url = new URL(req.url, 'http://localhost')
                    const token = url.searchParams.get('token') ?? ''
                    const entry = typeof token === 'string' && token !== '' ? progressStore.get(token) : undefined
                    return writeJson(res, 200, { ok: true, progress: entry ?? null })
                } catch (error) {
                    return writeJson(res, 500, { ok: false, error: messageOf(error) })
                }
            },
        }), 'dsh-omnifile.status')

        ctx.effect(() => webServer.register({
            kind: 'exact',
            path: '/api/omnifile/parsed',
            handler: async (req: any, res: any) => {
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
                    writeJson(res, 404, { ok: false, error: messageOf(error) })
                }
            },
        }), 'dsh-omnifile.parsed')

        ctx.effect(() => webServer.register({
            kind: 'exact',
            path: '/api/omnifile/models',
            handler: async (req: any, res: any) => {
                try {
                    /* 全面枚举当前生效的多模态候选模型（见 enumerateModels）：
                     * adapter 实时目录（含 DSH 内置 DeepSeek 等）+ 可配置提供商设置回退，
                     * 每项带 image 能力标注，客户端据此提示用户选择。 */
                    const providers = await enumerateModels(ctx)
                    return writeJson(res, 200, { ok: true, providers })
                } catch (error) {
                    return writeJson(res, 500, { ok: false, error: messageOf(error) })
                }
            },
        }), 'dsh-omnifile.models')

        ctx.effect(() => webServer.register({
            kind: 'exact',
            path: '/api/omnifile/open',
            handler: async (req: any, res: any) => {
                try {
                    const body = await readJsonBody(req)
                    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
                    const cwd = await sessionCwd(ctx, sessionId)
                    const target = assertWorkspacePath(cwd, body.path)
                    const result = await openLocally(target)
                    return writeJson(res, result.ok ? 200 : 500, { ok: result.ok, error: result.error })
                } catch (error) {
                    return writeJson(res, 500, { ok: false, error: messageOf(error) })
                }
            },
        }), 'dsh-omnifile.open')

        ctx.effect(() => webServer.register({
            kind: 'exact',
            path: '/api/omnifile/list',
            handler: async (req: any, res: any) => {
                try {
                    const url = new URL(req.url, 'http://localhost')
                    const sessionId = url.searchParams.get('sessionId') ?? ''
                    const cwd = await sessionCwd(ctx, sessionId)
                    const cfg = getConfig()
                    const files = await walkWorkspaceFiles(cwd, {
                        maxFiles: cfg.listMaxFiles,
                        maxDepth: cfg.listMaxDepth,
                    })
                    return writeJson(res, 200, { ok: true, files })
                } catch (error) {
                    return writeJson(res, 500, { ok: false, error: messageOf(error) })
                }
            },
        }), 'dsh-omnifile.list')

        /* 返回当前生效配置与客户端限额。 */
        ctx.effect(() => webServer.register({
            kind: 'exact',
            path: '/api/omnifile/config',
            handler: async (req: any, res: any) => {
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
                    return writeJson(res, 500, { ok: false, error: messageOf(error) })
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
                filePath: { type: 'string', required: true, description: '要分析的文件的绝对路径' },
                prompt: { type: 'string', description: '可选，指定识图时的关注点（仅图片与文档内嵌图片生效）' },
                kind: { type: 'string', description: '可选，显式指定类别（image/doc/text/media/other）；缺省按扩展名推断' },
            },
            output: {
                schema: { type: 'string' },
                render: (_args: any, value: string) => [{ type: 'text', text: value }],
            },
            isConcurrencySafe: () => true,
            /* 工具与聊天卡片同一套「解析→落盘 {源文件名}.md→给一行可读路径引用」：不把解析全文塞进模型上下文，
             * 模型拿到 md 绝对路径后用内置 read 工具即可读到内容。返回统一为：
             *   解析后保存路径：<md 或源路径>（完整内容见上方文件卡片，可点击展开；源文件：<源路径> | 无法按文本读取：… | 解析失败：…）
             */
            async execute(args: any, exec: any) {
                const path = String(args?.filePath ?? '').trim()
                if (path === '') throw new Error('filePath 不能为空')
                const cfg = getConfig()
                const kind = String(args?.kind ?? '').trim() || fileKind(path)
                const prompt = typeof args?.prompt === 'string' && args.prompt !== '' ? args.prompt : undefined
                let cwd = ''
                try { cwd = agentCwd(exec) } catch (error) { cwd = '' }
                const saveMarkdown = async (markdown: string) => {
                    if (cwd === '') return undefined
                    try { return await writeParsedMarkdown(cwd, path, markdown) } catch (error) { return undefined }
                }
                const ok = async (markdown: string) => {
                    const mdPath = await saveMarkdown(markdown)
                    /* 成功标记携带源文件绝对路径，客户端卡片据此打开源文件。 */
                    return markerText(mdPath || path, { ok: true, source: path })
                }
                const unreadable = (note: string) => markerText(path, { note })
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
                    return markerText(path, { ok: false, note: messageOf(error) || MARKER_UNKNOWN })
                }
            },
        })), 'dsh-omnifile.tool')
    }

    return () => {
        disposeVariants()
    }
}
