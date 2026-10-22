import { expect, it } from 'vitest';
import { Chess, DEFAULT_POSITION } from 'chess.js';
import { buildBoardContext } from '../src/board-context';
import { playUci } from '../src/chess';

function context(moves: string[], ply = moves.length, initialFen = DEFAULT_POSITION) {
    const board = new Chess(initialFen); for (const move of moves.slice(0, ply)) playUci(board, move);
    return buildBoardContext(board.fen(), { sessionId: 'game', initialFen, moves, ply });
}
it('restores the exact earlier inventory and ledger when stepping backward', () => {
    const moves = ['e2e4', 'd7d5', 'e4d5'];
    const after = context(moves), before = context(moves, 2);
    expect(after.inventory.b.p).toBe(7); expect(after.captures).toHaveLength(1);
    expect(after.captures[0]).toMatchObject({ ply: 3, square: 'd5', captured: { id: 'bp:d7', type: 'p' }, by: { id: 'wp:e2' } });
    expect(before.inventory.b.p).toBe(8); expect(before.captures).toEqual([]);
    expect(before.pieces.find(p => p.id === 'wp:e2')?.square).toBe('e4');
});
it('records en passant capture on the removed pawn square', () => {
    const ctx = context(['e2e4', 'a7a6', 'e4e5', 'd7d5', 'e5d6']);
    expect(ctx.captures[0]).toMatchObject({ square: 'd5', captured: { type: 'p', color: 'b' } });
    expect(ctx.pieces.find(p => p.id === 'wp:e2')?.square).toBe('d6');
    expect(ctx.pieces.some(p => p.square === 'd5')).toBe(false);
});
it.each([['e1g1', 'wr:h1', 'f1'], ['e1c1', 'wr:a1', 'd1']])('tracks king and rook identities in castling %s', (move, rook, square) => {
    const ctx = context([move], 1, 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    expect(ctx.pieces.find(p => p.id === rook)?.square).toBe(square);
    expect(ctx.captures).toEqual([]);
});
it('tracks promotion and capture of the promoted piece without fabricating missing armies', () => {
    const ctx = context(['a7a8q', 'b8a8'], 2, '1r5k/P7/8/8/8/8/8/7K w - - 0 1');
    expect(ctx.historyCompleteness).toBe('custom-start');
    expect(ctx.promotions[0]).toMatchObject({ pieceId: 'wp:a7', origin: 'a7', to: 'q' });
    expect(ctx.captures[0].captured).toMatchObject({ id: 'wp:a7', type: 'q', square: 'a8' });
    expect(ctx.captures).toHaveLength(1);
});
it('marks FEN-only capture history unavailable and rejects mismatching prefixes', () => {
    expect(buildBoardContext(DEFAULT_POSITION).historyCompleteness).toBe('position-only');
    expect(() => buildBoardContext(DEFAULT_POSITION, { sessionId: 'x', initialFen: DEFAULT_POSITION, moves: ['e2e4'], ply: 1 })).toThrow('does not match');
});
it('distinguishes repeated FEN history from the original position', () => {
    const initial = context([], 0), repeat = context(['g1f3', 'g8f6', 'f3g1', 'f6g8']);
    expect(initial.key).not.toBe(repeat.key); expect(repeat.captures).toEqual([]);
});
