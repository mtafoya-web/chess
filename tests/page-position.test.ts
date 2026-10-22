// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { readPageFen } from '../src/page-position';
afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });
it('reads Chess.com game state without modifying the game', () => {
    vi.stubGlobal('location', { hostname: 'www.chess.com' });
    const board = document.createElement('wc-chess-board');
    const getFEN = vi.fn(() => 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    Object.assign(board, { game: { getFEN } }); document.body.append(board);
    expect(readPageFen()).toContain('w KQkq - 0 1'); expect(getFEN).toHaveBeenCalledOnce();
    expect(document.body.firstChild).toBe(board);
});
it('handles unavailable or broken page APIs', () => {
    vi.stubGlobal('location', { hostname: 'www.chess.com' });
    expect(readPageFen()).toBeUndefined();
    const board = document.createElement('wc-chess-board');
    Object.assign(board, { game: { getFEN: () => { throw new Error('board replaced'); } } }); document.body.append(board);
    expect(readPageFen()).toBeUndefined();
});
it('reads the currently selected Lichess study node, including custom positions', () => {
    vi.stubGlobal('location', { hostname: 'lichess.org' });
    const fen = '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1';
    Object.assign(window, { site: { analysis: { node: { fen } } } });
    expect(readPageFen()).toBe(fen);
    delete (window as Window & { site?: unknown }).site;
});
