import { defineConfig } from 'vite'
import { CLIENT_EXTERNAL, moduleLoaderWrap, root, shared } from './build/shared.mjs'

export default defineConfig({
    ...shared,
    plugins: [moduleLoaderWrap('dsh-omnifile')],
    build: {
        emptyOutDir: false,
        minify: false,
        target: 'es2022',
        outDir: 'lib',
        lib: {
            entry: root + '/src/client/index.ts',
            formats: ['cjs'],
            fileName: () => 'client.js',
        },
        rollupOptions: {
            /* react / dsh-client-runtime 由 DSH ModuleLoader 的 require 解析；common.ts 构建期内联 */
            external: (id: string) => CLIENT_EXTERNAL.includes(id),
        },
    },
})
