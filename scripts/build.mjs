/**
 * dsh-omnifile 构建入口：构建 host → common → client 三个目标并生成类型声明。
 * 用法：
 *   node scripts/build.mjs            （或 pnpm build）      一次性构建
 *   node scripts/build.mjs --watch    （或 pnpm build:watch）监视 src 增量重建
 */
import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const watch = process.argv.slice(2).includes('--watch')

const targets = [
    { name: 'host', config: 'vite.host.config.mts', watchable: true },
    { name: 'common', config: 'vite.common.config.mts', watchable: true },
    { name: 'client', config: 'vite.client.config.mts', watchable: true },
]

const viteCmd = (target, withWatch) => {
    const args = ['exec', 'vite', 'build', '--config', target.config]
    if (withWatch) args.push('--watch')
    return args
}

function runSync(target) {
    console.log('\n=== dsh-omnifile: build ' + target.name + ' ===')
    const result = spawnSync(pnpm, viteCmd(target, false), {
        cwd: rootDir,
        stdio: 'inherit',
        shell: process.platform === 'win32',
    })
    if (result.status !== 0) {
        console.error('dsh-omnifile: build ' + target.name + ' failed')
        process.exit(result.status === null ? 1 : result.status)
    }
}

function emitDeclarations() {
    console.log('\n=== dsh-omnifile: emit declarations (tsc) ===')
    const dts = spawnSync(pnpm, ['exec', 'tsc', '-p', 'tsconfig.build.json'], {
        cwd: rootDir,
        stdio: 'inherit',
        shell: process.platform === 'win32',
    })
    if (dts.status !== 0) {
        console.error('dsh-omnifile: declaration emit failed')
        process.exit(dts.status === null ? 1 : dts.status)
    }
}

if (watch) {
    /* watch 模式下三个 vite 进程并行监视，父进程常驻；Ctrl+C 统一结束。 */
    console.log('\n=== dsh-omnifile: watch mode (3 targets) ===')
    const children = targets.map((t) => spawn(pnpm, viteCmd(t, true), {
        cwd: rootDir,
        stdio: 'inherit',
        shell: process.platform === 'win32',
    }))
    let exiting = false
    const shutdown = (code) => {
        if (exiting) return
        exiting = true
        for (const child of children) {
            try { child.kill() } catch { /* ignore */ }
        }
        process.exit(code)
    }
    process.on('SIGINT', () => shutdown(0))
    process.on('SIGTERM', () => shutdown(0))
    /* 任一子进程异常退出（如配置错误）时结束整个 watch */
    for (const child of children) {
        child.on('exit', (code) => {
            if (code !== 0 && code !== null) shutdown(code)
        })
    }
} else {
    for (const target of targets) runSync(target)
    emitDeclarations()
    console.log('\ndsh-omnifile: 全部构建完成')
}
