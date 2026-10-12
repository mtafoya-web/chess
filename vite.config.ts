import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        rollupOptions: {
            input: {
                background: resolve(__dirname, 'src/background.ts'),
                content: resolve(__dirname, 'src/content.ts'),
                sidepanel: resolve(__dirname, 'public/sidepanel.html'),
            },
            output: {
                // Enforces exact file names matching your manifest.json
                entryFileNames: '[name].js',
                chunkFileNames: 'chunks/[name]-[hash].js',
                assetFileNames: 'assets/[name]-[hash].[ext]',
            },
        },
    },
});