// Refresh the central-tension regression from the same packaged engine used by Kibitz.
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { Chess } from 'chess.js';

const history = ['e2e4', 'e7e6', 'd2d3', 'd7d5', 'g1f3', 'f7f5', 'g2g3'];
const board = new Chess();
for (const uci of history.slice(0, -1)) board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4) });
const beforeFen = board.fen(), played = board.move('g3'), afterFen = board.fen();
const expected = 'rnbqkbnr/ppp3pp/4p3/3p1p2/4P3/3P1NP1/PPP2P1P/RNBQKB1R b KQkq - 0 4';
if (afterFen !== expected) throw new Error('Regression history no longer matches the reported position.');
async function search(fen, moves) {
    return new Promise((resolve, reject) => {
        const engine = spawn(process.execPath, ['node_modules/stockfish/src/stockfish-17.1-lite-single-03e3232.js'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
        let buffer = '', complete = false;
        const candidates = new Map();
        const timer = setTimeout(() => { engine.kill(); reject(new Error('Fixture search timed out.')); }, 20000);
        const fail = error => { clearTimeout(timer); engine.kill(); reject(error); };
        engine.on('error', fail);
        engine.on('exit', code => { if (!complete) fail(new Error(`Fixture engine exited early (${code}).`)); });
        engine.stdout.on('data', data => {
            buffer += data;
            const lines = buffer.split(/\r?\n/); buffer = lines.pop();
            for (const line of lines) {
                if (line === 'uciok') engine.stdin.write('setoption name MultiPV value 3\nisready\n');
                if (line === 'readyok') engine.stdin.write(`position startpos moves ${moves.join(' ')}\ngo movetime 1500\n`);
                const score = /\bscore (cp|mate) (-?\d+)/.exec(line), pv = /\bpv (.+)$/.exec(line);
                if (score && pv && !/\b(?:upperbound|lowerbound)\b/.test(line)) {
                    const replay = new Chess(fen), uciPv = pv[1].split(' ').slice(0, 10), sanPv = [];
                    try { for (const uci of uciPv) sanPv.push(replay.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san); } catch { continue; }
                    const value = Number(score[2]) * (fen.split(' ')[1] === 'w' ? 1 : -1);
                    candidates.set(Number(/\bmultipv (\d+)/.exec(line)?.[1] ?? 1), {
                        uci: uciPv[0], san: sanPv[0], uciPv, sanPv, pv: sanPv.join(' '), depth: Number(/\bdepth (\d+)/.exec(line)?.[1] ?? 0),
                        score: score[1] === 'cp' ? value / 100 : Math.sign(value) * 100,
                        engineScore: score[1] === 'cp' ? { kind: 'cp', value } : { kind: 'mate', winner: value > 0 ? 'w' : 'b', moves: Math.abs(Number(score[2])) }
                    });
                }
                if (line.startsWith('bestmove ')) {
                    complete = true; clearTimeout(timer); engine.stdin.write('quit\n');
                    const list = [...candidates].sort(([a], [b]) => a - b).map(([, c]) => c);
                    if (!list.length || list[0].uci !== line.split(' ')[1]) { fail(new Error('Fixture engine returned an inconsistent PV.')); return; }
                    resolve(list);
                }
            }
        });
        engine.stdin.write('uci\n');
    });
}
const before = await search(beforeFen, history.slice(0, -1));
const after = await search(afterFen, history);
await mkdir('tests/fixtures', { recursive: true });
await writeFile('tests/fixtures/review-central-tension.json', JSON.stringify({
    engine: 'Stockfish 17.1 lite single', movetime: 1500, multiPV: 3,
    history, move: { ply: 7, san: played.san, uci: 'g2g3', color: 'w', beforeFen, afterFen }, before, after
}, null, 2) + '\n');
console.log(JSON.stringify({ before: before[0], after: after[0] }, null, 2));
