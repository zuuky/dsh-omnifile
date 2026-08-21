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
import z from '@deepseek-ai/schemastery';
export declare const name = "dsh-omnifile";
export declare const inject: string[];
export declare const Config: z<Schemastery.ObjectS<{
    providerRef: z<string, string>;
    reasoningEffort: z<string, string>;
    thinking: z<boolean, boolean>;
    describePrompt: z<string, string>;
    enableVariants: z<boolean, boolean>;
    timeoutMs: z<number, number>;
    maxFileBytes: z<number, number>;
    maxDocImages: z<number, number>;
    docMaxChars: z<number, number>;
    concurrency: z<number, number>;
    temperature: z<number, number>;
    topP: z<number, number>;
    maxTokens: z<number, number>;
    describeCacheMax: z<number, number>;
    listMaxFiles: z<number, number>;
    listMaxDepth: z<number, number>;
    maxNameChars: z<number, number>;
    maxBatchImages: z<number, number>;
    progressPollMs: z<number, number>;
}>, Schemastery.ObjectT<{
    providerRef: z<string, string>;
    reasoningEffort: z<string, string>;
    thinking: z<boolean, boolean>;
    describePrompt: z<string, string>;
    enableVariants: z<boolean, boolean>;
    timeoutMs: z<number, number>;
    maxFileBytes: z<number, number>;
    maxDocImages: z<number, number>;
    docMaxChars: z<number, number>;
    concurrency: z<number, number>;
    temperature: z<number, number>;
    topP: z<number, number>;
    maxTokens: z<number, number>;
    describeCacheMax: z<number, number>;
    listMaxFiles: z<number, number>;
    listMaxDepth: z<number, number>;
    maxNameChars: z<number, number>;
    maxBatchImages: z<number, number>;
    progressPollMs: z<number, number>;
}>>;
export declare function apply(ctx: any, config?: Record<string, any>): () => void;
