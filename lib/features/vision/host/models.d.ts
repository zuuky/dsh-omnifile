/**
 * 多模态候选模型的全面枚举与 providerRef 解析。
 * - enumerateModels：adapter 实时目录 + 可配置提供商设置回退，带 image 能力标注；
 * - resolveConfiguredProvider：依据 ref（<settingsNs>/<route>/<modelId>）解析端点与凭据；
 * - 视觉模型推断：DSH 内置 adapter 对内置模型一律报 text-only 时，按用户显式声明的模型名的
 *   视觉关键字推断 image 能力（如 deepseek-v4-flash-vision-exp）。
 */
/** 模型 id/name 中常见的“视觉/多模态”特征关键字（用于 adapter 未声明能力时推断）。 */
declare const VISION_HINT_RE: RegExp;
/** DSH 内置提供商（dsh-llm-* adapter 注册、settingsPath 为空）的默认端点/凭据回退。 */
declare function builtinProviderDefaults(provider: string, settingsNs: string): {
    baseUrl: string;
    credentialEnv: string;
    baseUrlEnv: string;
} | null;
/**
 * 推断一个用户显式配置的模型是否为视觉模型：
 *  - adapter 已声明支持 image（modalities 含 image）→ 直接返回 true；
 *  - 设置 profile 里显式声明了该模型（dir.profile.models 命中），且模型 id/name 含视觉关键字 →
 *    推断为视觉模型（覆盖 DSH adapter 对内置模型一律报 text-only 的局限，如 deepseek-v4-flash-vision-exp）。
 */
declare function inferModelImage(modalities: string[], dir: any, modelId: string): boolean;
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
declare function resolveConfiguredProvider(ctx: any, providerRef: string): Promise<{
    baseUrl: string;
    credential: string;
    model: string;
} | null>;
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
declare function enumerateModels(ctx: any): Promise<any[]>;
export { VISION_HINT_RE, builtinProviderDefaults, inferModelImage, resolveConfiguredProvider, enumerateModels };
