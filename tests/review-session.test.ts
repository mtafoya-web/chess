import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { fenAt, sessionFromMoves, sessionFromPgn } from '../src/review-session';

describe('review session', () => {
    it('reconstructs every ply and preserves original move context', () => {
        const session = sessionFromPgn('[White "Alice"]\n[Black "Bob"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 1-0');
        expect(session.title).toBe('Alice vs Bob');
        expect(session.moves[2]).toMatchObject({ ply: 3, san: 'Nf3', uci: 'g1f3', color: 'w' });
        expect(fenAt(session, 0)).toBe(new Chess().fen());
        expect(fenAt(session, 2)).toBe(session.moves[2].beforeFen);
        expect(() => fenAt(session, -1)).toThrow();
        expect(() => fenAt(session, 1.5)).toThrow();
        expect(() => fenAt(session, 5)).toThrow();
    });
    it('preserves custom starting positions and promotions', () => {
        const fen = '7k/P7/8/8/8/8/8/7K w - - 0 1';
        const session = sessionFromPgn(`[SetUp "1"]\n[FEN "${fen}"]\n[Result "1-0"]\n\n1. a8=Q+ 1-0`);
        expect(session.initialFen).toBe(fen);
        expect(session.moves[0].uci).toBe('a7a8q');
    });
    it('replays castling and en passant legally', () => {
        const castle = sessionFromMoves(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'O-O']);
        expect(castle.moves.at(-1)?.uci).toBe('e1g1');
        const ep = sessionFromMoves(['e4', 'a6', 'e5', 'd5', 'exd6']);
        expect(new Chess(ep.moves.at(-1)!.afterFen).get('d5')).toBeUndefined();
    });
    it('rejects invalid, oversized, empty, and variant games', () => {
        expect(() => sessionFromMoves(['e5'])).toThrow();
        expect(() => sessionFromMoves([])).toThrow();
        expect(() => sessionFromPgn('x'.repeat(256 * 1024 + 1))).toThrow();
        expect(() => sessionFromMoves(Array(1501).fill('e4'))).toThrow();
        expect(() => sessionFromPgn('[Variant "Crazyhouse"]\n\n1. e4 *')).toThrow('standard');
        expect(() => sessionFromPgn('[Event "A"]\n\n1. e4 *\n[Event "B"]\n\n1. d4 *')).toThrow('one game');
    });
});
