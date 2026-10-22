// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { Chess } from 'chess.js';
import { normalizeNativeEngine } from '../src/analysis-sources';
import { readNativeEngine, type NativeEngineSnapshot } from '../src/site-engine';
const fen = new Chess().fen();
const url = 'https://lichess.org/analysis';
function snapshot(): NativeEngineSnapshot { return { source: 'lichess-client', url, fen, evaluationFen: fen, path: '', ply: 0, variant: 'standard', perspective: 'white', capturedAt: Date.now(), depth: 18, candidates: [{ cp: 30, moves: ['e2e4', 'e7e5'] }] }; }
afterEach(() => { vi.unstubAllGlobals(); delete (window as any).site; });
it('normalizes legal lines without guessing extra candidates or grading compatibility', () => {
    const result = normalizeNativeEngine(snapshot(), { fen, url, path: '', ply: 0 })!;
    expect(result.evaluation.bestMove).toBe('e2e4'); expect(result.evaluation.whiteScore).toBe(.3);
    expect(result.evaluation.candidates[0].sanPv).toEqual(['e4', 'e5']);
    expect(result.capabilities).toEqual({ advice: true, continuation: true, heatmap: false, pairedGrading: false });
});
it('keeps white scores on black to move, including typed mates', () => {
    const chess = new Chess(); chess.move('e4'); const raw = snapshot(); raw.fen = raw.evaluationFen = chess.fen(); raw.ply = 1;
    raw.candidates = [{ cp: -42, moves: ['e7e5'] }];
    expect(normalizeNativeEngine(raw, { fen: chess.fen(), url })!.evaluation.whiteScore).toBe(-.42);
    raw.candidates = [{ mate: -3, moves: ['e7e5'] }];
    expect(normalizeNativeEngine(raw, { fen: chess.fen(), url })!.evaluation.engineScore).toEqual({ kind: 'mate', winner: 'b', moves: 3 });
});
it.each(['stale', 'fen', 'evalFen', 'path', 'ply', 'url', 'variant', 'perspective', 'illegal', 'duplicate', 'score', 'oversized'])('rejects %s page results', reason => {
    const raw = snapshot() as any;
    if (reason === 'stale') raw.capturedAt -= 5000;
    if (reason === 'fen') raw.fen = fen.replace(' w ', ' b ');
    if (reason === 'evalFen') raw.evaluationFen = fen.replace(' w ', ' b ');
    if (reason === 'path') raw.path = 'xx';
    if (reason === 'ply') raw.ply = 2;
    if (reason === 'url') raw.url = 'https://lichess.org/study/other';
    if (reason === 'variant') raw.variant = 'chess960';
    if (reason === 'perspective') raw.perspective = 'black';
    if (reason === 'illegal') raw.candidates[0].moves = ['e2e5'];
    if (reason === 'duplicate') raw.candidates.push(raw.candidates[0]);
    if (reason === 'score') raw.candidates[0].mate = 3;
    if (reason === 'oversized') raw.candidates = Array(6).fill(raw.candidates[0]);
    expect(normalizeNativeEngine(raw, { fen, url, path: '', ply: 0 })).toBeUndefined();
});
it('normalizes Lichess standard castling encoding only after legal replay', () => {
    const raw = snapshot(); raw.fen = raw.evaluationFen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
    raw.candidates[0].moves = ['e1h1', 'e8a8'];
    expect(normalizeNativeEngine(raw, { fen: raw.fen, url })!.evaluation.candidates[0].uciPv).toEqual(['e1g1', 'e8c8']);
});
it('reader copies only bounded known data and fails closed on engine off/threat/live/unsupported site', () => {
    vi.stubGlobal('location', new URL(url));
    const controller: any = { variantKey: 'standard', path: '', node: { fen, ply: 0, ceval: { fen, depth: 18, pvs: [{ cp: 30, moves: ['e2e4'] }] } }, threatMode: () => false };
    (window as any).site = { analysis: controller };
    expect(readNativeEngine()?.candidates[0].moves).toEqual(['e2e4']);
    controller.threatMode = () => true; expect(readNativeEngine()).toBeUndefined();
    controller.threatMode = () => false; controller.ongoing = true; expect(readNativeEngine()).toBeUndefined();
    controller.ongoing = false; delete controller.node.ceval; expect(readNativeEngine()).toBeUndefined();
    vi.stubGlobal('location', new URL('https://www.chess.com/analysis')); expect(readNativeEngine()).toBeUndefined();
});
it('reads server PV strings and falls back when only an evaluation score is available', () => {
    vi.stubGlobal('location', new URL(url));
    const node: any = { fen, ply: 0, eval: { fen, depth: 16, pvs: [{ cp: 10, moves: 'e2e4 e7e5' }] } };
    (window as any).site = { analysis: { variantKey: 'standard', path: '', node } };
    expect(readNativeEngine()?.source).toBe('lichess-server'); delete node.eval.pvs;
    expect(readNativeEngine()).toBeUndefined();
});
