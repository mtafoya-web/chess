// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readNativeReview, resolveReviewPly, navigateNativeReview } from '../src/site-review';
import { sessionFromPgn } from '../src/review-session';
import { allowedContext } from '../src/adapters';
import type { NativeReviewSnapshot } from '../src/site-review-types';

const source = { url: 'https://www.chess.com/game/live/1234', gameId: '1234' };
const session = () => sessionFromPgn('[Result "1-0"]\n\n1. e4 e5 2. Nf3 1-0', source);
const execute = (href: string) => new Function('location', 'document', 'window', `return (${readNativeReview.toString()})();`)({ href }, document, window) as NativeReviewSnapshot;
beforeEach(() => { document.body.replaceChildren(); });
afterEach(() => { vi.unstubAllGlobals(); delete (window as unknown as Record<string, unknown>).site; delete (window as unknown as Record<string, unknown>).lichess; });

describe('native review snapshots', () => {
    it('serializes independently and reads a completed Chess.com selected ply', () => {
        const game = session();
        document.body.innerHTML = '<wc-chess-board class="flipped"></wc-chess-board>';
        Object.assign(document.querySelector('wc-chess-board')!, { game: {
            getFEN: () => game.moves[0].afterFen, getSelectedNode: () => ({ ply: 1 }), getHistorySANs: () => ['e4'],
            getPGN: () => '[Link "https://www.chess.com/game/live/1234"]\n[Result "1-0"]\n\n1. e4 e5 1-0',
        } });
        expect(execute(source.url)).toMatchObject({ allowed: true, fen: game.moves[0].afterFen, ply: 1, orientation: 'black', gameId: '1234' });
        expect(execute('https://www.chess.com/game/live/5678').allowed).toBe(false);
        document.body.insertAdjacentHTML('beforeend', '<div class="clock-component clock-player-turn"></div>');
        expect(execute(source.url).allowed).toBe(false);
    });
    it('reads the actual selected Lichess analysis node and relative custom root ply', () => {
        const game = session();
        document.body.innerHTML = '<div class="analyse__board orientation-black"><cg-board></cg-board></div><div class="game__meta"><div class="status">Draw</div></div>';
        Object.assign(window, { site: { analysis: { node: { fen: game.moves[1].afterFen, ply: 12 }, tree: { root: { fen: game.initialFen, ply: 10 } }, path: 'abCD' } } });
        expect(execute('https://lichess.org/abcd1234')).toMatchObject({ allowed: true, ply: 2, path: 'abCD', fen: game.moves[1].afterFen, orientation: 'black' });
        document.querySelector('.status')!.textContent = 'Playing right now';
        expect(execute('https://lichess.org/abcd1234').allowed).toBe(false);
    });
    it('keeps missing and incomplete FENs unavailable and does not infer a final ply', () => {
        document.body.innerHTML = '<wc-chess-board data-fen="8/8/8/8/8/8/8/8 w - -"></wc-chess-board><div class="game-over-modal"></div>';
        expect(execute(source.url).fen).toBeUndefined();
        expect(execute(source.url).ply).toBeUndefined();
    });
    it('reads readonly six-field Lichess FEN inputs when analysis globals are absent', () => {
        const game = session();
        document.body.innerHTML = '<div class="analyse__board"><cg-board></cg-board></div><div class="analyse__underboard"><div class="copyables"><input class="copyable" readonly></div></div>';
        document.querySelector('input')!.value = game.moves[0].afterFen;
        expect(execute('https://lichess.org/analysis')).toMatchObject({ allowed: true, fen: game.moves[0].afterFen });
        document.querySelector('input')!.value = game.moves[0].afterFen.split(' ').slice(0, 4).join(' ');
        expect(execute('https://lichess.org/analysis').fen).toBeUndefined();
    });
    it('derives the selected prefix index only when native SAN and full-FEN histories agree', () => {
        const game = session();
        document.body.innerHTML = '<wc-chess-board></wc-chess-board>';
        const native = { getFEN: () => game.initialFen, getSelectedNode: () => null,
            getHistorySANs: () => [] as string[], getHistoryFENs: () => [game.initialFen],
            getPGN: () => '[Link "https://www.chess.com/game/live/1234"]\n[Result "1-0"]\n\n1. e4 e5 1-0',
        };
        Object.assign(document.querySelector('wc-chess-board')!, { game: native });
        expect(execute(source.url)).toMatchObject({ ply: 0, moves: [], initialFen: game.initialFen });
        native.getFEN = () => game.moves[0].afterFen;
        native.getHistorySANs = () => ['e4'];
        native.getHistoryFENs = () => [game.initialFen, game.moves[0].afterFen];
        expect(execute(source.url)).toMatchObject({ ply: 1, moves: ['e4'] });
        native.getHistoryFENs = () => [game.initialFen];
        expect(execute(source.url).ply).toBeUndefined();
    });
});

describe('selected review move resolution', () => {
    it('requires exact full FEN/index, preserves benign URL changes and verifies history', () => {
        const game = session();
        const snapshot: NativeReviewSnapshot = { url: `${source.url}?view=board#2`, gameId: '1234', allowed: true, orientation: 'white', fen: game.moves[1].afterFen, ply: 2 };
        expect(resolveReviewPly(game, snapshot)).toBe(2);
        expect(resolveReviewPly(game, { ...snapshot, ply: 1 })).toBeUndefined();
        expect(resolveReviewPly(game, { ...snapshot, moves: ['d4', 'd5'] })).toBeUndefined();
        expect(resolveReviewPly(game, { ...snapshot, moves: ['e2e4', 'e7e5'] })).toBe(2);
        expect(resolveReviewPly(game, { ...snapshot, gameId: '5678' })).toBeUndefined();
        expect(resolveReviewPly(game, { ...snapshot, url: 'https://example.com/game/live/1234' })).toBeUndefined();
        expect(resolveReviewPly(game, { ...snapshot, fen: snapshot.fen!.replace(/ 2$/, ' 99') })).toBeUndefined();
    });
    it('allows a unique full-FEN fallback but rejects ambiguity without an index', () => {
        const game = session();
        const snapshot: NativeReviewSnapshot = { url: source.url, gameId: '1234', allowed: true, orientation: 'white', fen: game.moves[0].afterFen };
        expect(resolveReviewPly(game, snapshot)).toBe(1);
        game.moves[1].afterFen = game.moves[0].afterFen;
        expect(resolveReviewPly(game, snapshot)).toBeUndefined();
        expect(resolveReviewPly(game, { ...snapshot, ply: 2 })).toBe(2);
    });
    it('accepts a matching imported study with prefix, never a different study route', () => {
        const game = session(); game.source = { url: 'https://lichess.org/study/abcdefgh', gameId: 'study' };
        const snapshot: NativeReviewSnapshot = { url: `${game.source.url}#1`, allowed: true, orientation: 'white', fen: game.moves[0].afterFen, moves: ['e4'] };
        expect(resolveReviewPly(game, snapshot)).toBe(1);
        expect(resolveReviewPly(game, { ...snapshot, url: 'https://lichess.org/study/another1' })).toBeUndefined();
    });
    it('native context cannot override running clocks or mismatched URLs', () => {
        const game = session();
        const snapshot: NativeReviewSnapshot = { url: source.url, gameId: '1234', allowed: true, orientation: 'white', fen: game.initialFen };
        expect(allowedContext(document, new URL(source.url), snapshot)).toBe(true);
        expect(allowedContext(document, new URL('https://www.chess.com/game/live/5678'), snapshot)).toBe(false);
        document.body.innerHTML = '<div class="rclock running"></div>';
        expect(allowedContext(document, new URL(source.url), snapshot)).toBe(false);
    });
    it('rejects stale native snapshots even on a normally allowed study route', () => {
        const game = session();
        const url = new URL('https://lichess.org/analysis#2');
        const snapshot: NativeReviewSnapshot = { url: 'https://lichess.org/analysis#1', allowed: true, orientation: 'white', fen: game.initialFen };
        expect(allowedContext(document, url, snapshot)).toBe(false);
    });
    it('unsupported native navigation leaves the board untouched', () => {
        vi.stubGlobal('location', { href: source.url });
        expect(navigateNativeReview({ direction: 'next', expectedUrl: source.url })).toEqual({ ok: false });
    });
    it('selects only a unique native move node and refuses stale or live-game navigation',()=>{
        vi.stubGlobal('location',new URL(source.url));
        document.body.innerHTML='<div class="move-list"><button data-ply="3">g4</button></div>';
        const click=vi.fn(); document.querySelector('button')!.addEventListener('click',click);
        expect(navigateNativeReview({direction:'select',ply:3,expectedUrl:source.url})).toEqual({ok:true}); expect(click).toHaveBeenCalledOnce();
        expect(navigateNativeReview({direction:'select',ply:3,expectedUrl:source.url+'changed'})).toEqual({ok:false});
        document.body.insertAdjacentHTML('beforeend','<div class="rclock running"></div>');
        expect(navigateNativeReview({direction:'select',ply:3,expectedUrl:source.url})).toEqual({ok:false});
        document.querySelector('.rclock')!.remove(); document.querySelector('.move-list')!.insertAdjacentHTML('beforeend','<button data-ply="3">duplicate</button>');
        expect(navigateNativeReview({direction:'select',ply:3,expectedUrl:source.url})).toEqual({ok:false}); expect(click).toHaveBeenCalledOnce();
    });
});
