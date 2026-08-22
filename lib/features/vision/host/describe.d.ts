/** 图片内容哈希缓存（path → size/mtime/hash）：文件被重写后 mtime 变化，用 stat 对不上，故缓存哈希避免反复读文件。 */
declare const imageHashCache: Map<string, {
    size: number;
    mtimeMs: number;
    hash: string;
}>;
/** 多模态描述结果缓存（key → 描述文本），LRU 淘汰。key = 图片内容哈希|最终提示词|端点|模型。 */
declare const describeCache: Map<string, {
    value: string;
}>;
/** 归一化发送给多模态模型的提示词：显式传入优先，否则用配置默认。 */
declare function effectivePrompt(cfg: Record<string, any>, prompt?: string): string;
/** mediaType → 文件扩展名（图片落盘用）。 */
declare function extnameOfMedia(mediaType: string): string;
/**
 * 解析当前生效的多模态提供商：只认「设置-模型」中选择的 providerRef（唯一来源）。
 * 未选择时抛错，提示去设置页选择（不保存多份模型配置，也没有手动备用方案）。
 */
declare function resolveProvider(ctx: any, cfg: Record<string, any>): Promise<any>;
/** 直接调用一次多模态模型（OpenAI 兼容 /chat/completions）。 */
declare function describeImage(ctx: any, cfg: Record<string, any>, imagePath: string, prompt: string): Promise<string>;
/**
 * 带缓存的多模态识别：同一图片内容（内容哈希相同）+ 相同提示词 + 相同端点时直接复用上次结果。
 * 这是“同一图片多次走多模态模型”的核心修复：对话历史中同一附件每轮都会被转换，
 * 缓存命中后不再发起模型请求，也消除了随之而来的重复“Deep diving...”等待。
 */
declare function describeImageCached(ctx: any, cfg: Record<string, any>, imagePath: string, prompt?: string): Promise<string>;
export { imageHashCache, describeCache, effectivePrompt, extnameOfMedia, resolveProvider, describeImage, describeImageCached };
