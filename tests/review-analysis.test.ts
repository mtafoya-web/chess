import { describe, expect, it, vi } from 'vitest';
import { Chess } from 'chess.js';
import { candidateFrom, evaluation, playUci, positionEvaluation } from '../src/chess';
import { moveFeedback } from '../src/move-feedback';
import { ReviewAnalyzer, validateReview } from '../src/review-analysis';
import type { Evaluation } from '../src/types';
import type { ReviewMove, ReviewRequest } from '../src/review-types';

const initialFen = new Chess().fen();
const request = (moves = ['e2e4'], ply = moves.length): ReviewRequest => ({ type: 'REVIEW_ANALYZE', sessionId: 'game', requestId: 'request', initialFen, moves, ply });
const cp = (value: number, best = 'd2d4'): Evaluation => ({ ...evaluation([{ uci: best, san: 'd4', pv: 'd4', score: value / 100, engineScore: { kind: 'cp', value } }]) });
const move = (color: 'w' | 'b' = 'w'): ReviewMove => ({ ply: color === 'w' ? 1 : 2, san: color === 'w' ? 'e4' : 'e5', uci: color === 'w' ? 'e2e4' : 'e7e5', color, beforeFen: '', afterFen: '' });
const mate = (winner: 'w' | 'b'): Evaluation => ({ ...cp(winner === 'w' ? 10000 : -10000), engineScore: { kind: 'mate', winner, moves: 3 } });

describe('review feedback', () => {
    it.each([[20, 'Excellent'], [50, 'Good'], [100, 'Inaccuracy'], [200, 'Mistake'], [201, 'Blunder']])('grades a %i centipawn loss as %s', (loss, label) => {
        expect(moveFeedback(move(), cp(100), cp(100 - loss))).toMatchObject({ label, lossCp: loss });
        expect(moveFeedback(move('b'), cp(-100), cp(-100 + loss))).toMatchObject({ label, lossCp: loss });
    });
    it('recognizes best moves, clamps search improvement, and handles draws', () => {
        expect(moveFeedback(move(), cp(100, 'e2e4'), cp(99)).label).toBe('Best');
        expect(moveFeedback(move(), cp(100), cp(120)).lossCp).toBe(0);
        const draw = evaluation([], 'Stalemate', { kind: 'terminal' });
        expect(moveFeedback(move(), cp(300), draw)).toMatchObject({ label: 'Blunder', lossCp: 300 });
    });
    it('handles mate transitions without subtracting synthetic scores', () => {
        expect(moveFeedback(move(), cp(0), mate('b'))).toMatchObject({ label: 'Blunder' });
        expect(moveFeedback(move(), mate('w'), cp(300))).toMatchObject({ label: 'Missed mate' });
        expect(moveFeedback(move(), mate('w'), mate('w'))).toMatchObject({ label: 'Good' });
        expect(moveFeedback(move(), mate('b'), cp(-300))).toMatchObject({ label: 'Good' });
        expect(moveFeedback(move(), cp(0), mate('b')).lossCp).toBeUndefined();
        const checkmate = evaluation([], 'Checkmate', { kind: 'terminal', winner: 'w' });
        expect(moveFeedback(move(), mate('w'), checkmate).label).toBe('Checkmate');
    });
});

describe('review positions and history', () => {
    it('validates bounds and all supplied moves before starting engine work', async () => {
        const engine = { analyze: vi.fn(async () => cp(0)) };
        const analyzer = new ReviewAnalyzer(engine);
        for (const invalid of [{ ...request(), ply: -1 }, { ...request(), ply: 2 }, { ...request(), moves: ['e2e5'] }, { ...request(), moves: ['e2e4', 'e7e4'], ply: 1 }, { ...request(), ai: 'yes' }]) {
            await expect(analyzer.analyze(invalid as ReviewRequest, new AbortController().signal)).rejects.toThrow();
        }
        expect(engine.analyze).not.toHaveBeenCalled();
    });
    it('reconstructs legal before/after positions and passes full history to Stockfish', async () => {
        const engine = { analyze: vi.fn(async (_fen: string, _signal: AbortSignal, _history?: { initialFen: string; moves: string[] }) => cp(0)) };
        const result = await new ReviewAnalyzer(engine).analyze(request(['e2e4', 'e7e5'], 2), new AbortController().signal);
        expect(result.move).toMatchObject({ san: 'e5', color: 'b', ply: 2 });
        expect(result.feedback).toBeDefined();
        expect(engine.analyze.mock.calls[0][2]).toEqual({ initialFen, moves: ['e2e4'] });
        expect(engine.analyze.mock.calls[1][2]).toEqual({ initialFen, moves: ['e2e4', 'e7e5'] });
    });
    it('only analyzes the initial position at ply zero', async () => {
        const engine = { analyze: vi.fn(async () => cp(0)) };
        const result = await new ReviewAnalyzer(engine).analyze(request(['e2e4'], 0), new AbortController().signal);
        expect(engine.analyze).toHaveBeenCalledOnce();
        expect(result.before).toBeUndefined(); expect(result.feedback).toBeUndefined(); expect(result.fen).toBe(initialFen);
    });
    it('reuses adjacent results but does not mix different repetition histories', async () => {
        const engine = { analyze: vi.fn(async () => cp(0)) };
        const analyzer = new ReviewAnalyzer(engine);
        const signal = new AbortController().signal;
        await analyzer.analyze(request(['e2e4', 'e7e5'], 1), signal);
        await analyzer.analyze(request(['e2e4', 'e7e5'], 2), signal);
        expect(engine.analyze).toHaveBeenCalledTimes(3);
        await analyzer.analyze(request(['e2e4', 'e7e5'], 1), signal);
        expect(engine.analyze).toHaveBeenCalledTimes(3);
        await analyzer.analyze(request(['g1f3', 'g8f6', 'f3g1', 'f6g8'], 4), signal);
        expect(engine.analyze).toHaveBeenCalledTimes(5);
    });
    it('recognizes repetition and checkmate without an engine search for terminal positions', async () => {
        const engine = { analyze: vi.fn(async () => cp(0)) };
        const analyzer = new ReviewAnalyzer(engine);
        const cycle = ['g1f3', 'g8f6', 'f3g1', 'f6g8'];
        const draw = await analyzer.analyze(request([...cycle, ...cycle]), new AbortController().signal);
        expect(draw.after).toMatchObject({ terminal: 'Threefold repetition', engineScore: { kind: 'terminal' } });
        expect(engine.analyze).toHaveBeenCalledOnce();
        const checkmate = await analyzer.analyze(request(['f2f3', 'e7e5', 'g2g4', 'd8h4']), new AbortController().signal);
        expect(checkmate.after).toMatchObject({ terminal: 'Checkmate', engineScore: { kind: 'terminal', winner: 'b' }, whiteScore: -100 });
        expect(checkmate.feedback?.label).toBe('Checkmate');
    });
    it('allows an unclaimed repetition draw to be followed by legal game moves', () => {
        const cycle = ['g1f3', 'g8f6', 'f3g1', 'f6g8'];
        expect(validateReview(request([...cycle, ...cycle, 'e2e4'])).selected?.san).toBe('e4');
    });
    it('cancels between comparison searches and never caches aborted output', async () => {
        const controller = new AbortController();
        const engine = { analyze: vi.fn(async () => { controller.abort(); return cp(0); }) };
        const analyzer = new ReviewAnalyzer(engine);
        await expect(analyzer.analyze(request(), controller.signal)).rejects.toThrow();
        expect(engine.analyze).toHaveBeenCalledOnce();
        engine.analyze.mockImplementation(async () => cp(0));
        await analyzer.analyze(request(), new AbortController().signal);
        expect(engine.analyze).toHaveBeenCalledTimes(3);
    });
    it('evicts old cache entries and returns isolated cached values', async () => {
        const engine = { analyze: vi.fn(async () => cp(0)) };
        const analyzer = new ReviewAnalyzer(engine, 1);
        const signal = new AbortController().signal;
        await analyzer.analyze(request(), signal);
        await analyzer.analyze(request([], 0), signal);
        expect(engine.analyze).toHaveBeenCalledTimes(3);
        const cached = await analyzer.analyze(request([], 0), signal);
        cached.after.candidates.length = 0;
        expect((await analyzer.analyze(request([], 0), signal)).after.candidates).toHaveLength(1);
    });
    it('validates promotions, castling, and en passant through legal replay', () => {
        expect(validateReview({ ...request(['a7a8q']), initialFen: '7k/P7/8/8/8/8/8/K7 w - - 0 1' }).selected?.san).toBe('a8=Q+');
        expect(validateReview(request(['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'g8f6', 'e1g1'])).selected?.san).toBe('O-O');
        expect(validateReview(request(['e2e4', 'a7a6', 'e4e5', 'd7d5', 'e5d6'])).selected?.san).toBe('exd6');
    });
});

it('preserves legal PV arrays and typed white-perspective scores', () => {
    const chess = new Chess(); playUci(chess, 'e2e4');
    const line = candidateFrom('info depth 14 multipv 1 score cp 35 pv e7e5 g1f3', chess.fen())!.candidate;
    expect(line).toMatchObject({ uciPv: ['e7e5', 'g1f3'], sanPv: ['e5', 'Nf3'], depth: 14, engineScore: { kind: 'cp', value: -35 } });
    expect(candidateFrom('info score mate 2 pv e7e5', chess.fen())!.candidate.engineScore).toEqual({ kind: 'mate', winner: 'b', moves: 2 });
    expect(positionEvaluation(new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'))).toMatchObject({ terminal: 'Stalemate', engineScore: { kind: 'terminal' } });
});
