/**
 * 多模态候选模型的全面枚举与 providerRef 解析。
 * - enumerateModels：adapter 实时目录 + 可配置提供商设置回退，带 image 能力标注；
 * - resolveConfiguredProvider：依据 ref（<settingsNs>/<route>/<modelId>）解析端点与凭据；
 * - 视觉模型推断：DSH 内置 adapter 对内置模型一律报 text-only 时，按用户显式声明的模型名的
 *   视觉关键字推断 image 能力（如 deepseek-v4-flash-vision-exp）。
 */

/** 模型 id/name 中常见的“视觉/多模态”特征关键字（用于 adapter 未声明能力时推断）。 */
const VISION_HINT_RE = /(^|[-_.\s])(vision|vl|visual|omni|image|img|vlm|multimodal)([-_.\s]|$)/i

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
    for (const providerInfo of (() => { try { return typeof llm.listProviders === 'function' ? llm.listProviders() : [] } catch { return [] } })()) {
        const providerId = String(providerInfo?.id ?? '')
        if (providerId === '' || providerId.startsWith('omnifile-')) continue
        let models: any[] = []
        try {
            models = typeof llm.listModels === 'function' ? await llm.listModels(providerId) : []
        } catch { /* 该 provider 模型目录不可用，尝试 profile 回退 */ }
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

export { VISION_HINT_RE, builtinProviderDefaults, inferModelImage, resolveConfiguredProvider, enumerateModels }
