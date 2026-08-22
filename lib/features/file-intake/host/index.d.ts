/** 注册文件接入相关路由。getConfig 由组合根注入（每次请求读取当前生效配置）。 */
export declare function registerFileIntake(ctx: any, getConfig: () => Record<string, any>): void;
