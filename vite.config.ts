import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { bundleMetrics } from './scripts/bundle-metrics';

export default defineConfig({
    plugins: [bundleMetrics('extension'), { name: 'local-stockfish', closeBundle() {
        const source = resolve('node_modules/stockfish');
        const target = resolve('dist/engine');
        mkdirSync(target, { recursive: true });
        const files = readdirSync(resolve(source, 'src')).filter(f => /^stockfish-17\.1-lite-single.*\.(js|wasm)$/.test(f));
        if (files.length !== 2) throw new Error('Expected pinned Stockfish JS/WASM pair');
        for (const file of files) copyFileSync(resolve(source, 'src', file), resolve(target, file));
        copyFileSync(resolve(source, 'Copying.txt'), resolve(target, 'COPYING.txt'));
        copyFileSync(resolve('src/data/OPENINGS-LICENSE.md'), resolve('dist/OPENINGS-LICENSE.md'));
        copyFileSync(resolve('src/data/openings-revision.txt'), resolve('dist/openings-revision.txt'));
        mkdirSync(resolve('dist/data'), { recursive: true });
        copyFileSync(resolve('src/data/openings.json'), resolve('dist/data/openings.json'));
    } }],
    build: {
        target: 'chrome116',
        modulePreload: { polyfill: false },
        outDir: 'dist',
        emptyOutDir: true,
        rollupOptions: {
            input: {
                background: resolve(__dirname, 'src/background.ts'),
                sidepanel: resolve(__dirname, 'sidepanel.html'),
                offscreen: resolve(__dirname, 'offscreen.html'),
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
