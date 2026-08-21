/**
 * dsh-omnifile — 构建共用配置（host/common/client 三个目标共享）。
 * 纯 JS（.mjs）：config 目标文件为 .mts，经 esbuild 转译后导入本模块。
 */
import { fileURLToPath } from 'node:url'
import path from 'node:path'

export const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

/* 宿主端外部化清单：Node 内置模块 + DSH peers + 真实依赖 + 兄弟 common.js */
export const HOST_EXTERNAL = [
    'node:fs/promises',
    'node:crypto',
    'node:path',
    'node:child_process',
    'node:url',
    '@deepseek-ai/dsh-tools',
    '@deepseek-ai/schemastery',
    '@deepseek-ai/dsh-llm',
    '@deepseek-ai/dsh-credentials',
    '@deepseek-ai/cordis',
    '@firecrawl/anydoc',
]

/** 客户端外部化清单：只在 DSH ModuleLoader 中 require 的模块 */
export const CLIENT_EXTERNAL = [
    'react',
    '@deepseek-ai/dsh-client-runtime',
]

/**
 * 把 Rollup 产出的 CJS bundle 包进 DSH ModuleLoader 的 load({id, factory}) 格式。
 * factory 内的 require 参数即模块加载器传入的 require（external 模块在 factory 内解析）。
 * 包装后的文件可被 DSH 客户端模块系统加载，也可被回归测试的 vm 桩直接执行。
 */
export function moduleLoaderWrap(id) {
    return {
        name: 'dsh-omnifile-module-loader',
        enforce: 'post',
        apply: 'build',
        generateBundle(_options, bundle) {
            const chunk = bundle['client.js']
            if (chunk === undefined || chunk.type !== 'chunk' || typeof chunk.code !== 'string') return
            const code = `window.__ModuleLoader__.load({
    id: ${JSON.stringify(id)},
    factory: (require) => {
        var module = { exports: {} };
        var exports = module.exports;
        Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
${chunk.code}
        return module.exports;
    }
});
`
            chunk.code = code
        },
    }
}

export const shared = { logLevel: 'warn' }
