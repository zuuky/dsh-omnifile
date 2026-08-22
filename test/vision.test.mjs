/**
 * dsh-omnifile 多模态识图（vision）功能块回归测试（node:test）
 * 运行：node --test test/vision.test.mjs
 *
 * 覆盖：多模态候选模型枚举（全面列出已注册 provider 的模型，含 image 标注、
 *       omnifile-* 变体跳过、profile 回退）与 providerRef 解析（内置 DeepSeek 回退 /
 *       自定义提供商）。实现位于 features/vision/host/{models,describe}.ts。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadModelUtils, makeModelCtx } from './helpers.mjs'

/* ============ 1. 多模态模型枚举（#4）：全面列出已注册 provider 的模型 ============ */
test('模型枚举：全面列出已注册 provider 的模型（DSH 内置 DeepSeek + 自定义 pi-ai，含 image 标注）', async () => {
    const { enumerateModels } = loadModelUtils()
    const ctx = makeModelCtx({
        settings: {
            'llm-deepseek': {
                models: [
                    { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', contextWindow: 1000000 },
                    { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', contextWindow: 1000000 },
                    { id: 'deepseek-v4-flash-vision-exp', name: 'DeepSeek-V4-Vision', contextWindow: 1000000 },
                ],
            },
            'llm-pi-ai': {
                providers: {
                    vllm: { displayName: 'local-ds-v4', apiKeyEnv: 'VLLM_API_KEY', baseURL: 'http://a/v1', defaultInput: ['text'], models: [{ id: 'general-model', name: 'local-ds-v4' }] },
                    vision: { displayName: 'local-vision', apiKeyEnv: 'VISION_API_KEY', baseURL: 'http://b/v1', defaultInput: ['text', 'image'], models: [{ id: 'general-model', name: 'local-vision' }] },
                },
            },
        },
        llm: {
            directory: [
                { provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [] },
                { provider: 'vllm', displayName: 'local-ds-v4', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'vllm'] },
                { provider: 'vision', displayName: 'local-vision', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'vision'] },
            ],
            providers: [
                { id: 'deepseek-official', name: 'DeepSeek' },
                { id: 'vllm', name: 'local-ds-v4' },
                { id: 'vision', name: 'local-vision' },
                { id: 'omnifile-vllm', name: 'local-ds-v4 (Omnifile)' }, /* 本插件变体，应被跳过 */
            ],
            providerModels: {
                'deepseek-official': [
                    { provider: 'deepseek-official', id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', inputModalities: ['text'] },
                    { provider: 'deepseek-official', id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', inputModalities: ['text'] },
                    { provider: 'deepseek-official', id: 'deepseek-v4-flash-vision-exp', name: 'DeepSeek-V4-Vision', inputModalities: ['text'] },
                ],
                vllm: [{ provider: 'vllm', id: 'general-model', name: 'local-ds-v4', inputModalities: ['text'] }],
                vision: [{ provider: 'vision', id: 'general-model', name: 'local-vision', inputModalities: ['text', 'image'] }],
                'omnifile-vllm': [{ provider: 'omnifile-vllm', id: 'general-model', name: 'local-ds-v4 (Omnifile)', inputModalities: ['text', 'image'] }],
            },
        },
    })
    const list = await enumerateModels(ctx)
    const ids = list.map((m) => m.ref)
    const byRef = Object.fromEntries(list.map((m) => [m.ref, m]))

    /* DSH 内置 DeepSeek 模型必须出现 */
    assert.ok(ids.includes('llm-deepseek/deepseek-official/deepseek-v4-flash'), 'DeepSeek v4-flash 出现')
    assert.ok(ids.includes('llm-deepseek/deepseek-official/deepseek-v4-pro'), 'DeepSeek v4-pro 出现')
    assert.ok(ids.includes('llm-deepseek/deepseek-official/deepseek-v4-flash-vision-exp'), 'DeepSeek v4-flash-vision-exp 出现')
    assert.equal(byRef['llm-deepseek/deepseek-official/deepseek-v4-flash'].image, false, 'DeepSeek 纯文本 → image=false')
    assert.equal(byRef['llm-deepseek/deepseek-official/deepseek-v4-flash'].providerDisplay, 'DeepSeek', 'DeepSeek 显示名')
    /* 用户在设置里显式声明的视觉模型（adapter 报 text-only）→ 按名称/ID 视觉关键字推断为 image=true */
    assert.equal(byRef['llm-deepseek/deepseek-official/deepseek-v4-flash-vision-exp'].image, true, 'deepseek-v4-flash-vision-exp 推断为视觉模型')

    /* 自定义 pi-ai 的 vllm（文本）与 vision（图片）都出现 */
    assert.ok(ids.includes('llm-pi-ai/vllm/general-model'), 'pi-ai vllm 出现')
    assert.ok(ids.includes('llm-pi-ai/vision/general-model'), 'pi-ai vision 出现')
    assert.equal(byRef['llm-pi-ai/vllm/general-model'].image, false, 'vllm 纯文本 → image=false')
    assert.equal(byRef['llm-pi-ai/vision/general-model'].image, true, 'vision 支持图片 → image=true')
    assert.equal(byRef['llm-pi-ai/vision/general-model'].baseURL, 'http://b/v1', 'baseURL 从 profile 关联')

    /* 本插件 omnifile-* 变体必须被跳过 */
    assert.ok(!ids.some((ref) => ref.includes('/omnifile-')), 'omnifile-* 变体不出现')
})

test('模型枚举：adapter 未公布时回退 settings profile 显式模型；provider 目录为空时不崩溃', async () => {
    const { enumerateModels } = loadModelUtils()
    /* 只有 settings profile 显式声明模型、adapter 目录不可用（llm 服务缺失） */
    const ctxNoLlm = {
        settings: { get: (ns) => (ns === 'llm-pi-ai' ? { providers: { vision: { displayName: 'v', baseURL: 'http://x', defaultInput: ['text', 'image'], models: [{ id: 'm1', name: 'M1' }] } } } : undefined) },
        get: () => undefined,
    }
    const list1 = await enumerateModels(ctxNoLlm)
    assert.equal(list1.length, 0, 'llm 服务缺失时返回空（不崩溃）')

    /* adapter 有目录但某个 provider 的 listModels 抛错 → 回退 profile 显式模型 */
    const ctx = makeModelCtx({
        settings: {
            'llm-pi-ai': { providers: { vision: { displayName: 'v', baseURL: 'http://x', defaultInput: ['text', 'image'], models: [{ id: 'm1', name: 'M1' }] } } },
        },
        llm: {
            directory: [{ provider: 'vision', displayName: 'v', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'vision'] }],
            providers: [],
            providerModels: {},
        },
    })
    /* 让 listProviders 返回空，但 settings profile 里有显式模型（profile 回退仍应列出、去重） */
    const list2 = await enumerateModels(ctx)
    assert.ok(list2.some((m) => m.ref === 'llm-pi-ai/vision/m1'), 'profile 显式模型被枚举')
    assert.equal(list2.find((m) => m.ref === 'llm-pi-ai/vision/m1').image, true, 'profile 模型 image 标注来自 defaultInput')
})

test('providerRef 解析：DSH 内置 DeepSeek 无 settings profile 时回退默认端点/凭据；自定义 provider 正常解析', async () => {
    const { resolveConfiguredProvider } = loadModelUtils()
    /* 内置 DeepSeek：settings 无 llm-deepseek 小节 → 回退官方默认 */
    const ctxDeep = makeModelCtx({
        settings: {},
        llm: { directory: [{ provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [] }] },
    })
    const r1 = await resolveConfiguredProvider(ctxDeep, 'llm-deepseek/deepseek-official/deepseek-v4-flash')
    assert.ok(r1, '内置 provider 可解析')
    assert.equal(r1.baseUrl, 'https://api.deepseek.com', '默认端点')
    assert.equal(r1.credential, 'DEEPSEEK_API_KEY', '默认凭据引用')
    assert.equal(r1.model, 'deepseek-v4-flash', '模型透传')

    /* 内置 DeepSeek：settings 显式配置 baseURL → 优先用配置 */
    const ctxDeep2 = makeModelCtx({
        settings: { 'llm-deepseek': { baseURL: 'http://gw/deepseek', apiKeyEnv: 'MY_KEY' } },
        llm: { directory: [{ provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [] }] },
    })
    const r2 = await resolveConfiguredProvider(ctxDeep2, 'llm-deepseek/deepseek-official/deepseek-v4-pro')
    assert.ok(r2)
    assert.equal(r2.baseUrl, 'http://gw/deepseek', '优先 settings baseURL')
    assert.equal(r2.credential, 'MY_KEY', '优先 settings apiKeyEnv')

    /* 自定义 pi-ai vision：从 providers.vision profile 解析 */
    const ctxPi = makeModelCtx({
        settings: { 'llm-pi-ai': { providers: { vision: { displayName: 'v', baseURL: 'http://b/v1', apiKeyEnv: 'VISION_API_KEY' } } } },
        llm: { directory: [{ provider: 'vision', displayName: 'v', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'vision'] }] },
    })
    const r3 = await resolveConfiguredProvider(ctxPi, 'llm-pi-ai/vision/general-model')
    assert.ok(r3)
    assert.equal(r3.baseUrl, 'http://b/v1', 'pi-ai baseURL')
    assert.equal(r3.credential, 'VISION_API_KEY', 'pi-ai apiKeyEnv')
    assert.equal(r3.model, 'general-model', 'pi-ai 模型透传')

    /* 无效目录：无匹配 entry → null */
    const r4 = await resolveConfiguredProvider(ctxPi, 'unknown/ns/model')
    assert.equal(r4, null, '无法解析返回 null')
})
