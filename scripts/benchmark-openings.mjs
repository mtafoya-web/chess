// Compare lossless JSON layouts; the shipped format stays simple unless savings justify a change.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';

const original = readFileSync('src/data/openings.json', 'utf8');
const rows = JSON.parse(original);
const nodes = [[-1, '']], prefixes = new Map([['', 0]]);
const packedRows = rows.map(([eco, name, moves, fen]) => {
    let parent = 0, prefix = '';
    for (const move of moves.split(' ')) {
        prefix = prefix ? `${prefix} ${move}` : move;
        if (!prefixes.has(prefix)) { prefixes.set(prefix, nodes.length); nodes.push([parent, move]); }
        parent = prefixes.get(prefix);
    }
    return [eco, name, parent, fen];
});
const packed = JSON.stringify({ version: 1, prefixes: nodes, rows: packedRows });
const decode = value => {
    const paths = [''];
    for (let i = 1; i < value.prefixes.length; i++) {
        const [parent, move] = value.prefixes[i]; paths.push(paths[parent] ? `${paths[parent]} ${move}` : move);
    }
    return value.rows.map(([eco, name, path, fen]) => [eco, name, paths[path], fen]);
};
assert.deepEqual(decode(JSON.parse(packed)), rows, 'Compaction must retain every exact sequence and FEN');
const timing = (text, transform = value => value) => {
    const samples = [];
    for (let i = 0; i < 30; i++) { const start = performance.now(); transform(JSON.parse(text)); samples.push(performance.now() - start); }
    return Number(samples.sort((a,b)=>a-b)[15].toFixed(3));
};
const results = [
    { format: 'existing rows', bytes: Buffer.byteLength(original), gzipBytes: gzipSync(original, {level:9}).length, medianDecodeMs: timing(original) },
    { format: 'shared prefixes', bytes: Buffer.byteLength(packed), gzipBytes: gzipSync(packed, {level:9}).length, medianDecodeMs: timing(packed, decode) },
];
console.table(results);
mkdirSync('.bundle', {recursive:true});
writeFileSync('.bundle/opening-formats.json', JSON.stringify({rows: rows.length, results}, null, 2)+'\n');
