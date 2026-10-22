import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { bundleMetrics } from './scripts/bundle-metrics';
export default defineConfig({
  plugins: [bundleMetrics('content')],
  publicDir: false,
  build: {
    target: 'chrome116', emptyOutDir: false,
    lib: { entry: resolve('src/content.ts'), name: 'Kibitz', formats: ['iife'], fileName: () => 'content.js' },
  },
});
