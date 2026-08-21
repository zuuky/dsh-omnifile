/** 日志：统一前缀与调试开关。 */

/** 日志前缀（所有 console / logger 输出统一前缀）。 */
export const LOG_PREFIX = '[dsh-omnifile]'

/** 调试日志：仅当 DSH_OMNIFILE_DEBUG=1 时输出，统一前缀 LOG_PREFIX。 */
export function debugLog(...args: unknown[]): void {
    if (process.env.DSH_OMNIFILE_DEBUG === '1') console.error(LOG_PREFIX, ...args)
}
