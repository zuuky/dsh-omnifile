/** 注册 dshomnifile 工具。getConfig 由入口注入。 */
declare function registerTool(ctx: any, getConfig: () => Record<string, any>): void;
export { registerTool };
