/**
 * 文本-only 主模型的 omnifile-* 图像变体：发送时把 image 块改写为多模态模型生成的文字描述。
 */
import { contentHasImage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import { join } from 'node:path'
import { messageOf } from '../common/index.js'
import { VARIANT_PREFIX, VARIANT_SUFFIX, DEFAULT_DESCRIBE_PROMPT } from './config.js'
import { describeImageCached, extnameOfMedia } from './describe.js'
import { createLimiter } from './limiter.js'
import { LOG_PREFIX } from './logger.js'
import { uploadsImagesDir } from './paths.js'

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

    /** DSH dsh-llm >= 0.1.0-rc.8 要求每个注册的 adapter 先冻结一次调用（agent-loop 每轮必经）。
     *  返回与 stream 语义一致的绑定条目：model 交给 LlmRuntime 校验/解析，stream 复用本类实现。 */
    async prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<any> {
        const info = await this.resolveModel(provider, model, signal)
        const adapter = this
        return {
            model: info,
            stream: (options: any) => adapter.stream(options),
        }
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
                let evidencePath = ''
                try {
                    const attachment = this.ctx.get('attachments')
                    const cwd = typeof sessionId === 'string' && sessionId !== ''
                        ? this.ctx.sessions.get(sessionId)?.header?.cwd
                        : undefined
                    const pathEvidence = await this.materializeAsEvidence(block, attachment, cwd)
                    evidencePath = pathEvidence.path
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
                    /* 识图失败也要把已落盘的图片绝对路径传给模型，否则模型无法 read_image 回看原图。 */
                    const pathTail = evidencePath !== '' ? '（图片路径: ' + evidencePath + '）' : ''
                    return { type: 'text', text: '[dshomnifile 不可用] ' + messageOf(error).slice(0, 300) + pathTail }
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

/** 安装文本模型变体（监听 llm/adapters-updated 保持与当前 provider 目录同步）。 */
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

export { shouldWrapModel, lastUserQuestion, OmnifileVariantAdapter, installVariants }
