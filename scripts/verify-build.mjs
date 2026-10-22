import { readFileSync, existsSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const manifest = JSON.parse(readFileSync('dist/manifest.json', 'utf8'));
for (const file of [manifest.background.service_worker, manifest.side_panel.default_path, 'offscreen.html', ...manifest.content_scripts.flatMap(s => s.js)]) assert.ok(existsSync(`dist/${file}`), `Missing ${file}`);
for (const icons of [manifest.icons, manifest.action.default_icon]) {
    for (const size of [16, 32, 48, 128]) {
        assert.ok(icons?.[size], `Missing ${size}px icon registration`);
        const png = readFileSync(`dist/${icons[size]}`);
        assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'Icon must be a PNG');
        assert.equal(png.readUInt32BE(16), size, 'Icon width must match registration');
        assert.equal(png.readUInt32BE(20), size, 'Icon height must match registration');
    }
}
const content = readFileSync('dist/content.js', 'utf8');
assert.ok(!/\b(?:import|export)\s+(?:\{|\*|["'])/.test(content), 'Content script must not contain module imports');
for (const page of ['sidepanel.html', 'offscreen.html']) {
    for (const match of readFileSync(`dist/${page}`, 'utf8').matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)) assert.ok(existsSync(`dist/${match[1].replace(/^\//, '')}`), `Broken ${page}: ${match[1]}`);
}
assert.equal(readdirSync('dist/engine').filter(f => f.endsWith('.wasm')).length, 1);
assert.ok(existsSync('dist/engine/COPYING.txt'));
assert.ok(existsSync('dist/ENGINE-SOURCE.txt'));
assert.ok(existsSync('dist/OPENINGS-LICENSE.md'));
assert.equal(readFileSync('dist/data/openings.json', 'utf8'), readFileSync('src/data/openings.json', 'utf8'), 'Opening asset must match the pinned generated index');
assert.equal(readFileSync('dist/openings-revision.txt', 'utf8').trim(), readFileSync('src/data/openings-revision.txt', 'utf8').trim());
const engineScripts = readdirSync('dist/engine').filter(f => f.endsWith('.js'));
assert.equal(engineScripts.length, 1, 'Expected one pinned engine worker');
for (const directory of ['dist', 'dist/chunks']) {
    if (!existsSync(directory)) continue;
    for (const file of readdirSync(directory).filter(f => f.endsWith('.js'))) {
        const source = readFileSync(`${directory}/${file}`, 'utf8');
        for (const match of source.matchAll(/(?:from\s*|import\s*)["'](\.[^"']+)["']/g)) {
            assert.ok(existsSync(new URL(match[1], new URL(`${directory}/${file}`, `file://${process.cwd().replaceAll('\\', '/')}/`))), `Missing bundled import in ${file}: ${match[1]}`);
        }
        assert.ok(!/migration-sentinel|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{20,}/.test(source), 'Packaged scripts must contain no credentials or migration sentinels');
    }
}
console.log('Extension paths, bundled imports, credential-free assets, engine worker/WASM and licensing verified.');
