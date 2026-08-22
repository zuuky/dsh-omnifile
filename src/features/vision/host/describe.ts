/**
 * 多模态识图：provider 解析、OpenAI 兼容调用与内容哈希缓存。
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import { DEFAULT_DESCRIBE_PROMPT, DESCRIBE_SYSTEM, describeCacheLimit } from '../../../core/host/config.js'
import { mimeFor } from '../../../core/host/extensions.js'
import { resolveApiKey } from '../../../core/host/http.js'
import { resolveConfiguredProvider } from './models.js'

/* ═══════════════════════════════════════════════════════════════════
 * 多模态识别缓存：同一张图片（按内容哈希识别）+ 同一提示词 + 同一端点
 * 只调用一次多模态模型，后续（不同轮次、工具与变体提供商）直接复用结果。
 * 避免对话历史里同一图片每轮都被重复识别。
 * 缓存上限 describeCacheLimit() 由 apply() 按 cfg.describeCacheMax 覆盖。
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
    const cacheLimit = describeCacheLimit()
    if (imageHashCache.size > cacheLimit * 2) {
        for (const key of imageHashCache.keys()) {
            imageHashCache.delete(key)
            if (imageHashCache.size <= cacheLimit) break
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
    if (describeCache.size > describeCacheLimit()) {
        const oldest = describeCache.keys().next().value
        if (oldest !== undefined) describeCache.delete(oldest)
    }
}

/** mediaType → 文件扩展名（图片落盘用）。 */
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

/** 直接调用一次多模态模型（OpenAI 兼容 /chat/completions）。 */
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

export { imageHashCache, describeCache, effectivePrompt, extnameOfMedia, resolveProvider, describeImage, describeImageCached }
