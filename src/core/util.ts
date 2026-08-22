/** 通用工具函数（双端共用）。 */

/** 提取错误的可读消息（Promise reject / try-catch 通用）。 */
export function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}
