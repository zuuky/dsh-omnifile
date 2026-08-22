/**
 * 宿主配置：settings schema（Config）、默认常量与运行期可变限额。
 */
import z from '@deepseek-ai/schemastery';
export declare const VARIANT_PREFIX = "omnifile-";
export declare const VARIANT_SUFFIX = " (Omnifile)";
/** 统一描述提示词兜底（describeImage / effectivePrompt / processDocument / convertBlocks 共用）。 */
export declare const DEFAULT_DESCRIBE_PROMPT = "\u8BF7\u6309\u8981\u6C42\u63CF\u8FF0\u8FD9\u5F20\u56FE\u7247\u3002";
export declare const DESCRIBE_SYSTEM: string;
/** 请求 JSON body 上限（进程/状态/打开等小型请求用）；上传走 /save 按 maxFileBytes 单独放大。 */
export declare const MAX_REQUEST_BODY_BYTES: number;
/** base64 相对原始字节的体积膨胀系数（base64 长度 ≈ 字节数 × 4/3）。 */
export declare const BASE64_INFLATE: number;
/** /save 兜底的单文件上限（Config.maxFileBytes 缺省时使用）。 */
export declare const MAX_SAVE_FALLBACK_BYTES: number;
/** 当前生效的文件名最大长度（字符）。 */
export declare function nameCharLimit(): number;
/** 当前生效的识图缓存条数上限（LRU）。 */
export declare function describeCacheLimit(): number;
/** 把可配置上限同步到模块级可变常量（sanitizeName 与识图缓存宽度在配置变更后即时生效）。 */
export declare function syncRunLimits(cfg: Record<string, any>): void;
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
/** 文档 Markdown 保留字符上限（cfg.docMaxChars 缺省 120000）。 */
export declare function docChars(cfg: Record<string, any>): number;
/** 单个文档交给多模态识别的内嵌图片/扫描页预算（显式传入优先，否则取 cfg.maxDocImages）。 */
export declare function imageBudget(cfg: Record<string, any>, override?: number): number;
