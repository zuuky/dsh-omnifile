/**
 * 处理进度跟踪：客户端在处理文件（尤其多模态识别）期间轮询
 * /api/omnifile/status 获取实时阶段，避免长时间只有一句“解析中...”。
 */

const progressStore = new Map<string, { stage?: string; detail?: string; done?: number; total?: number; updatedAt: number }>()

function setProgress(token: string, patch: Record<string, any>): void {
    if (typeof token !== 'string' || token === '') return
    const prev = progressStore.get(token)
    progressStore.set(token, { ...(prev ?? {}), ...patch, updatedAt: Date.now() })
}

function clearProgress(token: string): void {
    if (typeof token !== 'string' || token === '') return
    progressStore.delete(token)
}

function getProgress(token: string): { stage?: string; detail?: string; done?: number; total?: number; updatedAt: number } | undefined {
    return progressStore.get(token)
}

export { progressStore, setProgress, clearProgress, getProgress }
