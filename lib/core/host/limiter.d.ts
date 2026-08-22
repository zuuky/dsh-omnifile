/** 并发限制器：限制同时运行的任务数（多模态识别并发等）。 */
export declare function createLimiter(limit: number): <T>(task: () => Promise<T>) => Promise<T>;
