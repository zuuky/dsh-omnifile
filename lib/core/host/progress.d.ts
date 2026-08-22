/**
 * 处理进度跟踪：客户端在处理文件（尤其多模态识别）期间轮询
 * /api/omnifile/status 获取实时阶段，避免长时间只有一句“解析中...”。
 */
declare const progressStore: Map<string, {
    stage?: string;
    detail?: string;
    done?: number;
    total?: number;
    updatedAt: number;
}>;
declare function setProgress(token: string, patch: Record<string, any>): void;
declare function clearProgress(token: string): void;
declare function getProgress(token: string): {
    stage?: string;
    detail?: string;
    done?: number;
    total?: number;
    updatedAt: number;
} | undefined;
export { progressStore, setProgress, clearProgress, getProgress };
