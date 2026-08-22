/** 并发限制器：限制同时运行的任务数（多模态识别并发等）。 */

export function createLimiter(limit: number): <T>(task: () => Promise<T>) => Promise<T> {
    const max = Math.max(1, Math.floor(Number(limit) || 1))
    let active = 0
    const waiting: Array<() => void> = []
    const acquire = () => new Promise<void>((resolveAcquire) => {
        if (active < max) {
            active += 1
            resolveAcquire()
            return
        }
        waiting.push(resolveAcquire)
    })
    const release = () => {
        const next = waiting.shift()
        if (next !== undefined) {
            next()
            return
        }
        active -= 1
    }
    return async (task) => {
        await acquire()
        try {
            return await task()
        } finally {
            release()
        }
    }
}
