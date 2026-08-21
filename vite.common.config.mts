import { defineConfig } from 'vite'
import { root, shared } from './build/shared.mjs'

export default defineConfig({
    ...shared,
    build: {
        emptyOutDir: false,
        minify: false,
        target: 'es2022',
        outDir: 'lib',
        lib: {
            entry: root + '/src/common.ts',
            formats: ['es'],
            fileName: () => 'common.js',
        },
        rollupOptions: {
            external: [],
        },
    },
})
