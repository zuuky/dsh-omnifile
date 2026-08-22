declare function readBody(req: any, maxBytes: number): Promise<Buffer>;
declare function writeJson(res: any, status: number, body: unknown): void;
declare function readJsonBody(req: any, maxBytes?: number): Promise<Record<string, any>>;
/** 通过凭据服务解析 API Key（解析不到返回空串，由调用方决定是否报错）。 */
declare function resolveApiKey(ctx: any, credential: string): Promise<string>;
export { readBody, writeJson, readJsonBody, resolveApiKey };
