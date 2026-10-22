import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';

const walk = (directory, prefix = '') => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const name = `${prefix}${entry.name}`;
    return entry.isDirectory() ? walk(`${directory}/${entry.name}`, `${name}/`) : [name];
});
const files = walk('dist').map(file => { const bytes = readFileSync(`dist/${file}`); return { file, bytes: bytes.length, gzipBytes: gzipSync(bytes, { level: 9 }).length }; });
const baseline = JSON.parse(readFileSync('docs/bundle-baseline.json', 'utf8'));
const stableName = file => file.replace(/-[A-Za-z0-9_-]{8}(?=\.(?:js|css)$)/, '');
const report = { totalBytes: files.reduce((n, f) => n + f.bytes, 0), files };
console.table(files.filter(f => f.bytes > 10000).sort((a, b) => b.bytes - a.bytes).map(f => ({ file: f.file, bytes: f.bytes, gzip: f.gzipBytes, change: f.bytes - (baseline.files.find(b => stableName(b.file) === stableName(f.file))?.bytes ?? 0) })));
console.log(`Package: ${report.totalBytes.toLocaleString()} bytes (${(report.totalBytes - baseline.totalBytes).toLocaleString()} versus baseline).`);
const contexts = ['extension', 'content'].flatMap(context => existsSync(`.bundle/modules-${context}.json`) ? JSON.parse(readFileSync(`.bundle/modules-${context}.json`, 'utf8')).map(m => ({ ...m, context })) : []);
const duplicates = new Map();
for (const module of contexts) {
    const group = duplicates.get(module.id) ?? []; group.push(module); duplicates.set(module.id, group);
}
report.duplicatedModules = [...duplicates.entries()].filter(([, group]) => new Set(group.map(m => m.context)).size > 1 && group.some(m => m.renderedBytes)).map(([id, group]) => ({ id, copies: group.length, renderedBytes: group.reduce((n, m) => n + m.renderedBytes, 0) })).sort((a, b) => b.renderedBytes - a.renderedBytes);
console.log('Largest modules present in both isolated build contexts (rendered bytes before minification):');
console.table(report.duplicatedModules.slice(0, 6));
mkdirSync('.bundle', { recursive: true });
writeFileSync('.bundle/report.json', JSON.stringify(report, null, 2) + '\n');
if (process.argv.includes('--check')) {
    const budgets = JSON.parse(readFileSync('scripts/bundle-budgets.json', 'utf8'));
    for (const [name, maximum] of Object.entries(budgets.files)) assert.ok(files.find(f => f.file === name)?.bytes <= maximum, `${name} exceeds its ${maximum}-byte budget or is missing`);
    assert.ok(report.totalBytes <= budgets.totalBytes, 'Total extension size exceeds budget');
    const javascript = files.filter(f => f.file.endsWith('.js') && !f.file.startsWith('engine/'));
    assert.ok(javascript.reduce((n, f) => n + f.bytes, 0) <= budgets.javascriptBytes, 'Non-engine JavaScript exceeds budget');
    for (const f of javascript) assert.ok(!readFileSync(`dist/${f.file}`, 'utf8').includes('Amar Opening'), `Opening database embedded in ${f.file}`);
    assert.equal(files.filter(f => /openings.*\.json$/.test(f.file)).length, 1, 'Package exactly one opening database');
    assert.ok(!contexts.some(m => m.id.includes('/data/openings.json') && m.renderedBytes > 0), 'Opening data must not be compiled into JavaScript chunks');
    console.log('Bundle budgets and single-data-asset checks passed.');
}
