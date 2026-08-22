/** 用系统默认程序在本地打开路径。 */
export declare function openLocally(path: string): Promise<{
    ok: boolean;
    error?: string;
}>;
/** 注册聊天卡片相关路由。 */
export declare function registerChatCard(ctx: any, _getConfig: () => Record<string, any>): void;
