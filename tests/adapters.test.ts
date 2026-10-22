// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { allowedContext, readPosition, guidanceMode } from '../src/adapters';
import { renderMarkdown } from '../src/markdown';
const initial = new Chess().fen();
it('separates completed-game review routes from analysis/study boards',()=>{
    for(const url of ['https://lichess.org/abcd1234','https://www.chess.com/game/live/123','https://www.chess.com/analysis/game/live/123'])expect(guidanceMode(new URL(url))).toBe('review');
    for(const url of ['https://lichess.org/analysis#12','https://lichess.org/study/abcd','https://www.chess.com/analysis','https://www.chess.com/play/computer'])expect(guidanceMode(new URL(url))).toBe('analysis');
});
function fixture(lichess: boolean, fen = initial, black = false) {
    document.body.innerHTML = lichess ? `<div class="analyse__board ${black ? 'orientation-black' : ''}"><cg-board data-fen="${fen}"></cg-board></div>` : `<div class="board-wrapper"><wc-chess-board data-fen="${fen}" class="${black ? 'flipped' : ''}"></wc-chess-board></div>`;
    const board = document.querySelector<HTMLElement>('cg-board, wc-chess-board')!;
    board.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 800 } as DOMRect);
    const names = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
    for (const row of new Chess(fen).board()) for (const p of row) {
        if (!p) continue;
        const el = document.createElement(lichess ? 'piece' : 'div');
        const x = p.square.charCodeAt(0) - 97, y = 8 - Number(p.square[1]);
        el.className = lichess ? `${p.color === 'w' ? 'white' : 'black'} ${names[p.type]}` : `piece ${p.color}${p.type} square-${x + 1}${8 - y}`;
        el.getBoundingClientRect = () => ({ left: (black ? 7 - x : x) * 100, top: (black ? 7 - y : y) * 100, width: 100, height: 100 } as DOMRect);
        board.append(el);
    }
    return board;
}
beforeEach(() => { document.body.replaceChildren(); });
describe.each([false, true])('site adapter (lichess=%s)', lichess => {
    const url = new URL(lichess ? 'https://lichess.org/analysis' : 'https://www.chess.com/analysis');
    it('reads verified positions and rotation', () => {
        fixture(lichess, initial, true);
        expect(readPosition(document, url)).toMatchObject({ fen: initial, allowed: true, orientation: 'black' });
    });
    it('rejects stale FEN and handles replacement boards', () => {
        const board = fixture(lichess);
        board.querySelector('piece, .piece')!.remove();
        expect(readPosition(document, url)?.fen).toBeUndefined();
        const next = fixture(lichess); expect(readPosition(document, url)?.board).toBe(next);
    });
    it('blocks live human games, unknown pages, and running clocks', () => {
        fixture(lichess);
        expect(allowedContext(document, new URL(lichess ? 'https://lichess.org/abcdefgh' : 'https://www.chess.com/game/live/123'))).toBe(false);
        const clock = document.createElement('div'); clock.className = 'rclock running'; document.body.append(clock);
        expect(allowedContext(document, url)).toBe(false);
    });
    it('pauses on incomplete position state', () => {
        fixture(lichess).setAttribute('data-fen', initial.split(' ').slice(0, 4).join(' '));
        expect(readPosition(document, url)?.fen).toBeUndefined();
    });
});
it('keeps raw HTML inert while rendering basic Markdown', () => {
    const target = document.createElement('p');
    renderMarkdown(target, '**Develop** <img src=x onerror=alert(1)> `Nf3`');
    expect(target.querySelector('img')).toBeNull(); expect(target.querySelector('strong')?.textContent).toBe('Develop');
    expect(target.textContent).toContain('<img');
});
