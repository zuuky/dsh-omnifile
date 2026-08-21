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
            entry: root + '/src/index.ts',
            formats: ['es'],
            fileName: () => 'index.js',
        },
        rollupOptions: {
            external: (id: string) => HOST_EXTERNAL.includes(id) || id === './common.js',
            output: {
                preserveModules: false,
            },
        },
    },
})
