import { readFileSync, writeFileSync } from 'node:fs';
import { Chess } from 'chess.js';

// Rebuild from the checked-in, pinned upstream TSVs. No network required.
const rows = [];
for (const part of ['a', 'b', 'c', 'd', 'e']) {
    const lines = readFileSync(`src/data/openings-${part}.tsv`, 'utf8').trim().split(/\r?\n/);
    for (const line of lines.slice(1)) {
        const [eco, name, pgn] = line.split('\t'), board = new Chess();
        board.loadPgn(pgn);
        rows.push([eco, name, board.history({ verbose: true }).map(m => m.lan).join(' '), board.fen().split(' ').slice(0, 4).join(' ')]);
    }
}
writeFileSync('src/data/openings.json', JSON.stringify(rows));
console.log(`Indexed ${rows.length} legal openings`);
