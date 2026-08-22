/**
 * 工作区路径与会话工作目录解析 + 解析结果落盘。
 */
import fs from 'node:fs/promises'
import { basename, join, resolve, sep } from 'node:path'
import { messageOf } from '../index.js'
import { nameCharLimit } from './config.js'
import { debugLog } from './logger.js'

/** 无会话工作目录的错误文案（sessionCwd / agentCwd 共用）。 */
const ERR_NO_CWD = '当前会话没有工作目录'

/** 会话工作区 uploads 目录（文件落盘/图片落盘共用）。 */
function uploadsDir(cwd: string): string {
    return join(resolve(cwd), 'uploads')
}

/** 会话工作区 uploads/images 目录（文档内嵌图片/PDF 扫描页落盘共用）。 */
function uploadsImagesDir(cwd: string): string {
    return join(resolve(cwd), 'uploads', 'images')
}

async function sessionCwd(ctx: any, sessionId: string): Promise<string> {
    const session = typeof sessionId === 'string' && sessionId !== '' ? ctx.sessions.get(sessionId) : undefined
    const cwd = session?.header?.cwd
    if (typeof cwd !== 'string' || cwd === '') throw new Error(ERR_NO_CWD)
    return cwd
}

/**
 * 从工具执行上下文解析当前会话工作目录。
 * DSH 的工具运行时把所属 agent 放在 exec.agent（ToolRunContext），
 * 会话 cwd 位于 exec.agent.session.header.cwd —— 这是官方推荐的获取方式；
 * 较旧的运行时可能把 session 直接挂在 exec 上，这里做兼容兜底。
 * 取不到时抛「当前会话没有工作目录」（与 sessionCwd 一致）。
 */
function agentCwd(exec: any): string {
    const cwd = exec?.agent?.session?.header?.cwd
        ?? exec?.agent?.session?.cwd
        ?? exec?.session?.header?.cwd
        ?? exec?.cwd
    if (typeof cwd !== 'string' || cwd === '') throw new Error(ERR_NO_CWD)
    return cwd
}

function assertWorkspacePath(cwd: string, rawPath: unknown): string {
    if (typeof rawPath !== 'string' || rawPath === '') throw new Error('缺少文件路径')
    const target = resolve(rawPath)
    const root = resolve(cwd) + sep
    if (target !== resolve(cwd) && !target.startsWith(root)) throw new Error('路径不在会话工作区内')
    return target
}

/** 文件名清洗（与 /api/omnifile/save 落盘名一致）。 */
function sanitizeName(name: string): string {
    const base = String(name || '').split(/[\\/]/).pop() || ''
    const cleaned = base
        .replace(/[^\w\u4e00-\u9fa5.\- ]/gu, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/[. ]+$/, '')
    if (cleaned === '' || cleaned === '.' || cleaned === '..') return 'file'
    return cleaned.slice(0, nameCharLimit())
}

/**
 * 由源文件路径推导解析结果路径（<workspace>/uploads/<源文件名>.md）。
 * 源文件名默认取源文件 basename，也可显式传入原始文件名（./process 收到 body.name 时）。
 * 形态统一为「{源文件名}.md」，便于大模型直接对保存路径触发 read 工具。
 */
function parsedMarkdownPath(cwd: string, sourcePath: string, sourceName?: string): string {
    const name = sanitizeName(sourceName || basename(sourcePath)) || 'file'
    return join(resolve(cwd), 'uploads', name + '.md')
}

/** 把解析出的 Markdown 落盘到 <uploads>/<源文件名>.md，供折叠卡片懒加载与大模型 read。 */
async function writeParsedMarkdown(cwd: string, sourcePath: string, markdown: string, sourceName?: string): Promise<string | undefined> {
    try {
        const parsedPath = parsedMarkdownPath(cwd, sourcePath, sourceName)
        await fs.mkdir(uploadsDir(cwd), { recursive: true })
        await fs.writeFile(parsedPath, String(markdown ?? ''), 'utf8')
        return parsedPath
    } catch (error) {
        debugLog('写解析结果失败：' + messageOf(error))
        return undefined
    }
}

export { ERR_NO_CWD, uploadsDir, uploadsImagesDir, sessionCwd, agentCwd, assertWorkspacePath, sanitizeName, parsedMarkdownPath, writeParsedMarkdown }
