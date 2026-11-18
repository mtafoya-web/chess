// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { parseLichessGameUrl } from '../src/site-game-route';
import { captureSession, completeGameSnapshot } from '../src/game-capture';
import { readNativeReview, bindCapturedSnapshot, navigateNativeReview, resolveReviewPly } from '../src/site-review';
import { allowedContext } from '../src/adapters';
import type { SiteSnapshot } from '../src/site-snapshot';

const pgn = '[Result "1-0"]\n\n1. e4 e5 2. Nf3 1-0';
const url = 'https://lichess.org/game/abcd1234/white';
const read = (href = url) => new Function('location', 'document', 'window', `return (${readNativeReview.toString()})();`)({ href }, document, window) as SiteSnapshot;
const game = () => captureSession({ url, gameId: 'abcd1234', completed: true, result: '1-0', pgn });
beforeEach(() => { document.body.replaceChildren(); });
afterEach(() => { vi.unstubAllGlobals(); });

it.each([
    '/abcd1234', '/abcd1234WXYZ/black', '/abcd1234/white/analysis',
    '/game/abcd1234', '/game/abcd1234/white', '/game/abcd1234WXYZ/black/analysis/',
])('captures a completed game on the supported Lichess route %s', path => {
    document.body.innerHTML = '<div class="round__app variant-standard"><cg-board></cg-board><div class="result-wrap"><p class="result">1-0</p></div></div>';
    const snapshot = read(`https://lichess.org${path}?view=board#2`);
    expect(snapshot).toMatchObject({ completed: true, allowed: true, gameId: 'abcd1234', canonicalGameUrl: 'https://lichess.org/game/abcd1234' });
    const session = captureSession({ ...snapshot, pgn });
    expect(session.moves).toHaveLength(3);
    expect(session.source?.url).not.toContain('WXYZ');
    expect(parseLichessGameUrl(snapshot.pageUrl)?.gameId).toBe('abcd1234');
});

it.each(['https://lichess.org/analysis', 'https://lichess.org/training', 'https://lichess.org/game/short', 'https://lichess.org/game/abcd1234/not-a-color', 'https://example.com/game/abcd1234', 'http://lichess.org/game/abcd1234'])('rejects non-game or untrusted routes: %s', value => {
    expect(parseLichessGameUrl(value)).toBeUndefined();
});

it('uses only the public ID for the official PGN export and canonical source', async () => {
    const fetcher = vi.fn(async () => new Response(pgn, { headers: { 'Content-Type': 'application/x-chess-pgn' } }));
    vi.stubGlobal('fetch', fetcher);
    const snapshot = await completeGameSnapshot({ url: 'https://lichess.org/game/abcd1234WXYZ/black/analysis', completed: true, gameId: 'abcd1234', result: '1-0' });
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('/game/export/abcd1234?'), expect.anything());
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain('WXYZ');
    expect(captureSession(snapshot).source?.canonicalGameUrl).toBe('https://lichess.org/game/abcd1234');
});

function round(selected = 2) {
    document.body.innerHTML = `<div class="round__app variant-standard"><cg-board></cg-board><i5d><bo3><button data-ply="0">First</button><button data-ply="${selected - 1}">Previous</button></bo3><app><qzm>1</qzm><z7yx ${selected === 1 ? 'class="a1t"' : ''}>e4</z7yx><z7yx ${selected === 2 ? 'class="a1t"' : ''}>e5</z7yx><qzm>2</qzm><z7yx ${selected === 3 ? 'class="a1t"' : ''}>Nf3</z7yx><div class="result-wrap"><p class="result">1-0</p></div></app></i5d></div>`;
}

it('reads generated round notation, binds captured history, and survives the native Analysis transition', () => {
    round();
    const session = game();
    const snapshot = read();
    expect(snapshot).toMatchObject({ completed: true, allowed: true, ply: 2, canNavigate: true });
    const bound = bindCapturedSnapshot(session, { ...snapshot, placement: session.moves[1].afterFen.split(' ')[0] });
    expect(bound.fen).toBe(session.moves[1].afterFen);
    expect(resolveReviewPly(session, { ...bound, url: 'https://lichess.org/game/abcd1234/black/analysis#2' })).toBe(2);
    expect(resolveReviewPly(session, { ...bound, url: 'https://lichess.org/game/other123/white/analysis#2' })).toBeUndefined();
});

it('counts a custom black-to-move round relative to its captured starting position', () => {
    round(2);
    document.querySelector('app')!.innerHTML = '<qzm>23</qzm><z7yx>…</z7yx><z7yx class="a1t">Kg7</z7yx><qzm>24</qzm><z7yx>Kb2</z7yx><div class="result-wrap"><p class="result">½-½</p></div>';
    const session = captureSession({ url, gameId: 'abcd1234', completed: true, result: '1/2-1/2', pgn: '[SetUp "1"]\n[FEN "7k/8/8/8/8/8/8/K7 b - - 0 23"]\n[Result "1/2-1/2"]\n\n23... Kg7 24. Kb2 1/2-1/2' });
    const snapshot = read();
    expect(snapshot).toMatchObject({ ply: 1, completed: true, allowed: true });
    const bound = bindCapturedSnapshot(session, { ...snapshot, placement: session.moves[0].afterFen.split(' ')[0] });
    expect(bound.fen).toBe(session.moves[0].afterFen);
    expect(resolveReviewPly(session, bound)).toBe(1);
    vi.stubGlobal('location', new URL(url));
    document.querySelector('button[data-ply="0"]')!.setAttribute('data-ply', '45');
    const click = vi.fn(); document.querySelector('button[data-ply="45"]')!.addEventListener('click', click);
    expect(navigateNativeReview({ expectedUrl: url, direction: 'first', initialFen: session.initialFen, moves: session.moves.map(move => move.san), gameId: 'abcd1234' })).toEqual({ ok: true });
    expect(click).toHaveBeenCalledOnce();
});

it('selects verified current round notation with its native mousedown event and uses native first controls', () => {
    round(3); vi.stubGlobal('location', new URL(url));
    const session = game();
    const request = { expectedUrl: url, initialFen: session.initialFen, moves: session.moves.map(move => move.san), gameId: 'abcd1234' };
    const down = vi.fn(); document.querySelector('app')!.addEventListener('mousedown', down);
    expect(navigateNativeReview({ ...request, direction: 'select', ply: 1 })).toEqual({ ok: true });
    expect(down).toHaveBeenCalledOnce();
    expect((down.mock.calls[0][0] as MouseEvent).target).toBe(document.querySelector('z7yx'));
    const click = vi.fn(); document.querySelector('button[data-ply="0"]')!.addEventListener('click', click);
    expect(navigateNativeReview({ ...request, direction: 'first' })).toEqual({ ok: true });
    expect(click).toHaveBeenCalledOnce();
    expect(navigateNativeReview({ ...request, moves: ['d4', 'd5', 'Nf3'], direction: 'select', ply: 1 })).toEqual({ ok: false });
    expect(navigateNativeReview({ ...request, gameId: 'different', direction: 'select', ply: 1 })).toEqual({ ok: false });
    expect(down).toHaveBeenCalledOnce();
});

it.each(['variant-atomic', 'variant-chess960'])('blocks unsupported completed round variant %s', variant => {
    round(); document.querySelector('.round__app')!.className = `round__app ${variant}`;
    expect(read()).toMatchObject({ allowed: false, completed: false });
    expect(allowedContext(document, new URL(url), { url, allowed: true, completed: true, fen: game().initialFen, orientation: 'white' })).toBe(false);
    vi.stubGlobal('location', new URL(url));
    expect(navigateNativeReview({ direction: 'select', ply: 1, expectedUrl: url })).toEqual({ ok: false });
});

it('never navigates or captures an ongoing round, even with a stale result', () => {
    round(); document.body.insertAdjacentHTML('beforeend', '<div class="rclock running"></div>');
    expect(read()).toMatchObject({ completed: false, allowed: false });
    vi.stubGlobal('location', new URL(url));
    const session = game();
    expect(navigateNativeReview({ direction: 'select', ply: 1, expectedUrl: url, gameId: 'abcd1234', initialFen: session.initialFen, moves: session.moves.map(move => move.san) })).toEqual({ ok: false });
});
