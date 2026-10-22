import type { Plugin } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';

/** Build-only module attribution, kept outside the packaged extension. */
export function bundleMetrics(context: string): Plugin {
    return { name: 'kibitz-bundle-metrics', generateBundle(_options, bundle) {
        const modules = Object.values(bundle).flatMap(chunk => chunk.type === 'chunk'
            ? Object.entries(chunk.modules).map(([id, module]) => ({ id: id.replaceAll('\\', '/').replace(process.cwd().replaceAll('\\', '/') + '/', ''), chunk: chunk.fileName, renderedBytes: module.renderedLength })) : []);
        mkdirSync('.bundle', { recursive: true });
        writeFileSync(`.bundle/modules-${context}.json`, JSON.stringify(modules, null, 2) + '\n');
    } };
}
