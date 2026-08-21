import { defineConfig } from 'vite'
import { HOST_EXTERNAL, root, shared } from './build/shared.mjs'

export default defineConfig({
    ...shared,
    build: {
        emptyOutDir: false,
        minify: false,
        target: 'node18',
        outDir: 'lib',
        lib: {
            entry: root + '/src/host/index.ts',
            formats: ['es'],
            fileName: () => 'index.js',
        },
        rollupOptions: {
            /* 宿主依赖外部化；common 模块（src/common）由构建期内联，lib/common.js 仍单独构建供旧客户端 */
            external: (id: string) => HOST_EXTERNAL.includes(id),
            output: {
                preserveModules: false,
            },
        },
    },
})
