/** 用系统默认程序在本地打开路径。 */
declare function openLocally(path: string): Promise<{
    ok: boolean;
    error?: string;
}>;
/** 注册全部 /api/omnifile/* 路由。getConfig 由入口注入（读取当前生效配置）。 */
declare function registerRoutes(ctx: any, getConfig: () => Record<string, any>): void;
export { openLocally, registerRoutes };
