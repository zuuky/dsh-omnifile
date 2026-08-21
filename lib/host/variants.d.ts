/**
 * 文本-only 主模型的 omnifile-* 图像变体：发送时把 image 块改写为多模态模型生成的文字描述。
 */
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import { createLimiter } from './limiter.js';
declare function shouldWrapModel(info: any): boolean;
/** 取消息列表里最新的用户文本问题（供识图提示词上下文使用）。 */
declare function lastUserQuestion(messages: any[] | undefined): string;
declare class OmnifileVariantAdapter extends LlmAdapter {
    private ctx;
    private llm;
    private upstream;
    private upstreamName;
    private getConfig;
    constructor(ctx: any, llm: any, upstream: string, upstreamName: string, getConfig: () => Record<string, any>);
    providerInfo(provider: string): {
        id: string;
        name: string;
    };
    listModels(provider: string, signal?: AbortSignal): Promise<any[]>;
    resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<any>;
    stream(options: any): AsyncGenerator<any>;
    rewriteMessages(cfg: Record<string, any>, messages: any[], signal: AbortSignal | undefined, sessionId: string | undefined): Promise<any[]>;
    convertBlocks(cfg: Record<string, any>, blocks: any[], limit: ReturnType<typeof createLimiter>, signal: AbortSignal | undefined, sessionId: string | undefined, question: string): Promise<any[]>;
    materializeAsEvidence(block: any, attachmentService: any, cwd: string | undefined): Promise<{
        path: string;
    }>;
}
/** 安装文本模型变体（监听 llm/adapters-updated 保持与当前 provider 目录同步）。 */
declare function installVariants(ctx: any, getConfig: () => Record<string, any>): () => void;
export { shouldWrapModel, lastUserQuestion, OmnifileVariantAdapter, installVariants };
