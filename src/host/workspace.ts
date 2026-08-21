/**
 * 递归列出会话工作区内的文件（仅文件，不列出目录本体），供输入框 @ 文件选择器使用。
 */
import fs from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileKind } from './extensions.js'

/* - 跳过常见噪声目录（node_modules/.git/dist 等）与插件自身 uploads 暂存目录，
 *   避免把大目录/重复附件灌进选择菜单；
 * - 限制最大文件数与遍历深度，防止大目录拉爆响应；
 * - 返回 { name, path(绝对), rel(相对, 正斜杠), kind, size }。 */
const WALK_SKIP_DIRS = new Set(['node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', 'target', '.next', '.nuxt', '.vite', '.turbo', '.cache', '__pycache__', 'coverage', '.idea', '.vscode', '.venv', 'venv', 'uploads'])

async function walkWorkspaceFiles(cwd: string, options: { maxFiles?: number; maxDepth?: number } = {}): Promise<Array<{ name: string; path: string; rel: string; kind: string; size: number }>> {
    const maxFiles = options.maxFiles || 2000
    const maxDepth = options.maxDepth || 12
    const files: Array<{ name: string; path: string; rel: string; kind: string; size: number }> = []
    const seen = new Set<string>()
    const walk = async (dir: string, rel: string, depth: number): Promise<void> => {
        if (files.length >= maxFiles) return
        if (depth > maxDepth) return
        let entries: any[]
        try {
            entries = await fs.readdir(dir, { withFileTypes: true })
        } catch {
            return
        }
        entries.sort((a, b) => a.name.localeCompare(b.name))
        for (const entry of entries) {
            if (files.length >= maxFiles) return
            const name = entry.name
            const abs = join(dir, name)
            const relPath = rel === '' ? name : rel + '/' + name
            if (entry.isDirectory()) {
                if (WALK_SKIP_DIRS.has(name)) continue
                if (seen.has(abs)) continue
                seen.add(abs)
                await walk(abs, relPath, depth + 1)
            } else if (entry.isFile() || entry.isSymbolicLink()) {
                let size = 0
                try {
                    const stat = await fs.stat(abs)
                    if (!stat.isFile()) continue
                    size = stat.size
                } catch {
                    continue
                }
                files.push({ name, path: abs, rel: relPath, kind: fileKind(name), size })
            }
        }
    }
    await walk(resolve(cwd), '', 0)
    files.sort((a, b) => a.rel.localeCompare(b.rel))
    return files
}

export { WALK_SKIP_DIRS, walkWorkspaceFiles }
