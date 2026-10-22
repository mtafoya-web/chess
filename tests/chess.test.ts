import { describe, expect, it } from 'vitest';
import { candidateFrom, evaluation, normalizedFen, replay, terminalPosition } from '../src/chess';
const initial = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
describe('reliable chess positions', () => {
    it('requires all six FEN fields and valid kings', () => {
        expect(() => normalizedFen('8/8/8/8/8/8/8/8 w - -')).toThrow();
        expect(() => normalizedFen('8/8/8/8/8/8/8/8 w - - 0 1')).toThrow();
        expect(normalizedFen(initial)).toBe(initial);
    });
    it('replays history preserving castling rights and en passant', () => {
        expect(replay(['e4', 'a6', 'e5', 'd5']).split(' ')[3]).toBe('d6');
        expect(replay(['e4', 'e5', 'Ke2']).split(' ')[2]).toBe('kq');
        expect(() => replay(['e4', 'e5', 'e4'])).toThrow();
    });
    it('converts legal UCI lines to SAN and normalizes black scores', () => {
        const fen = replay(['e4']);
        const parsed = candidateFrom('info depth 12 multipv 1 score cp 42 nodes 123 pv e7e5 g1f3', fen)!;
        expect(parsed.candidate.san).toBe('e5'); expect(parsed.candidate.pv).toBe('e5 Nf3');
        expect(parsed.candidate.score).toBe(-0.42);
        expect(evaluation([parsed.candidate]).evaluation).toBe('-0.42');
        expect(candidateFrom('info score cp 50 lowerbound pv e7e5', fen)).toBeUndefined();
        expect(candidateFrom('info score cp 50 pv e7e4', fen)).toBeUndefined();
    });
    it('handles mate scores and terminal states', () => {
        const parsed = candidateFrom('info score mate 2 pv e2e4', initial)!;
        expect(evaluation([parsed.candidate]).evaluation).toBe('M2');
        expect(terminalPosition(replay(['f3', 'e5', 'g4', 'Qh4#']))).toBe('Checkmate');
        expect(terminalPosition('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')).toBe('Stalemate');
    });
});
