/** 注册文件解析相关路由。getConfig 由组合根注入（每次请求读取当前生效配置）。 */
export declare function registerFileParsing(ctx: any, getConfig: () => Record<string, any>): void;
