// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureSession, completeGameSnapshot, readGameSnapshot } from '../src/game-capture';

const pgn = '[Result "1-0"]\n\n1. e4 e5 1-0';
beforeEach(() => { document.body.replaceChildren(); window.history.replaceState({}, '', '/'); });
afterEach(() => vi.unstubAllGlobals());

describe('completed game capture', () => {
    it('reads a completed Chess.com history-selected game without native review', () => {
        window.history.replaceState({}, '', '/game/live/1234');
        document.body.innerHTML = '<div data-game-status="finished" data-result="1-0"></div><textarea name="pgn"></textarea>';
        document.querySelector('textarea')!.value = pgn;
        // jsdom uses localhost; exercise self-contained serialization with a site location.
        const run = new Function('location', 'document', 'HTMLTextAreaElement', `return (${readGameSnapshot.toString()})();`);
        const snapshot = run({ href: 'https://www.chess.com/game/live/1234' }, document, HTMLTextAreaElement);
        expect(snapshot).toMatchObject({ completed: true, gameId: '1234', pgn });
        expect(captureSession(snapshot).moves).toHaveLength(2);
    });
    it('blocks a running clock even with stale completion markers', () => {
        document.body.innerHTML = '<div class="game-over-modal">1-0</div><div class="rclock running"></div><textarea name="pgn"></textarea>';
        document.querySelector('textarea')!.value = pgn;
        const run = new Function('location', 'document', 'HTMLTextAreaElement', `return (${readGameSnapshot.toString()})();`);
        const snapshot = run({ href: 'https://www.chess.com/game/live/1234' }, document, HTMLTextAreaElement);
        expect(snapshot.completed).toBe(false);
        expect(snapshot.pgn).toBeUndefined();
    });
    it('reads Lichess final results but never assumes visible move history is complete', () => {
        document.body.innerHTML = '<div class="game__meta"><span class="result">½-½</span></div><div class="analyse__moves"><move>e4</move></div>';
        const run = new Function('location', 'document', 'HTMLTextAreaElement', `return (${readGameSnapshot.toString()})();`);
        const snapshot = run({ href: 'https://lichess.org/abcd1234/black' }, document, HTMLTextAreaElement);
        expect(snapshot).toMatchObject({ gameId: 'abcd1234', completed: true, result: '1/2-1/2' });
        expect(() => captureSession(snapshot)).toThrow('Import its PGN');
    });
    it('feature-detects the Chess.com board export without reading partial moves', () => {
        document.body.innerHTML = '<div class="game-over-component">White won</div><wc-chess-board></wc-chess-board>';
        const board = document.querySelector('wc-chess-board') as Element & { game: { getPGN: () => string } };
        board.game = { getPGN: () => `[Link "https://www.chess.com/game/live/1234"]\n${pgn}` };
        const run = new Function('location', 'document', 'HTMLTextAreaElement', `return (${readGameSnapshot.toString()})();`);
        const snapshot = run({ href: 'https://www.chess.com/game/live/1234' }, document, HTMLTextAreaElement);
        expect(captureSession(snapshot)).toMatchObject({ result: '1-0', source: { gameId: '1234' } });
        expect(run({ href: 'https://www.chess.com/member/example/games' }, document, HTMLTextAreaElement)).toBeUndefined();
    });
    it('uses a verified finished Chess.com board export without native review DOM and rejects stale or ongoing exports', () => {
        document.body.innerHTML = '<wc-chess-board></wc-chess-board>';
        const board = document.querySelector('wc-chess-board') as Element & { game: { getPGN: () => string } };
        let exported = `[Link "https://www.chess.com/game/live/1234"]\n${pgn}`;
        board.game = { getPGN: () => exported };
        const run = new Function('location', 'document', 'HTMLTextAreaElement', `return (${readGameSnapshot.toString()})();`);
        const location = { href: 'https://www.chess.com/game/live/1234' };
        expect(run(location, document, HTMLTextAreaElement)).toMatchObject({ completed: true, result: '1-0', pgn: exported });
        expect(run({ href: 'https://www.chess.com/game/live/5678' }, document, HTMLTextAreaElement).completed).toBe(false);
        exported = '[Link "https://www.chess.com/game/live/1234"]\n[Result "*"]\n\n1. e4 *';
        expect(run(location, document, HTMLTextAreaElement).completed).toBe(false);
        exported = pgn;
        expect(run(location, document, HTMLTextAreaElement).completed).toBe(false);
    });
    it('recognizes ordinary finished Lichess round controls and still blocks a running clock', () => {
        document.body.innerHTML = '<div class="round__app"><div class="result-wrap"><div class="result">1-0</div></div></div>';
        const run = new Function('location', 'document', 'HTMLTextAreaElement', `return (${readGameSnapshot.toString()})();`);
        const location = { href: 'https://lichess.org/abcd1234/white' };
        expect(run(location, document, HTMLTextAreaElement)).toMatchObject({ completed: true, result: '1-0', gameId: 'abcd1234' });
        const clock = document.createElement('div'); clock.className = 'rclock running'; document.body.append(clock);
        expect(run(location, document, HTMLTextAreaElement)).toMatchObject({ completed: false });
    });
    it.each([
        ['Draw', '1/2-1/2'], ['Checkmate • White is victorious', '1-0'], ['Black is victorious', '0-1'],
    ])('recognizes native Lichess metadata status %s before review loads', (status, result) => {
        document.body.innerHTML = `<div class="game__meta"><div class="status">${status}</div></div><a href="/game/export/abcd1234">Download PGN</a>`;
        const run = new Function('location', 'document', 'HTMLTextAreaElement', `return (${readGameSnapshot.toString()})();`);
        const location = { href: 'https://lichess.org/abcd1234' };
        expect(run(location, document, HTMLTextAreaElement)).toMatchObject({ completed: true, result });
        document.querySelector('.status')!.textContent = 'Playing right now';
        expect(run(location, document, HTMLTextAreaElement)).toMatchObject({ completed: false });
    });
    it('rejects incomplete exports, changed games, unsupported origins and result mismatches', () => {
        const snapshot = { url: 'https://www.chess.com/game/live/1234', gameId: '1234', completed: true, pgn };
        expect(() => captureSession({ ...snapshot, completed: false })).toThrow('finished');
        expect(() => captureSession({ ...snapshot, gameId: '5678' })).toThrow('changed');
        expect(() => captureSession({ ...snapshot, url: 'https://example.com/game/live/1234' })).toThrow('changed');
        expect(() => captureSession({ ...snapshot, pgn: '1. e4 e5 *' })).toThrow('final result');
        expect(() => captureSession({ ...snapshot, result: '0-1' })).toThrow('result changed');
    });
});

describe('official Lichess single-game export', () => {
    const snapshot = { url: 'https://lichess.org/abcd1234/black', gameId: 'abcd1234', completed: true, result: '1-0' };
    it('fetches only the selected completed game and validates the returned PGN', async () => {
        const fetcher = vi.fn().mockResolvedValue(new Response(pgn, { headers: { 'Content-Type': 'application/x-chess-pgn' } }));
        vi.stubGlobal('fetch', fetcher);
        expect((await completeGameSnapshot(snapshot)).pgn).toBe(pgn);
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(fetcher).toHaveBeenCalledWith('https://lichess.org/game/export/abcd1234?moves=true&tags=true&clocks=false&evals=false&opening=false', expect.objectContaining({ credentials: 'omit', redirect: 'error', headers: { Accept: 'application/x-chess-pgn' } }));
    });
    it('does not fetch ongoing games, existing exports, or other sites', async () => {
        const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
        await completeGameSnapshot({ ...snapshot, completed: false });
        await completeGameSnapshot({ ...snapshot, pgn });
        await completeGameSnapshot({ ...snapshot, url: 'https://www.chess.com/game/live/1234', gameId: '1234' });
        expect(fetcher).not.toHaveBeenCalled();
        await expect(completeGameSnapshot({ ...snapshot, gameId: 'changed1' })).rejects.toThrow('changed');
    });
    it('rejects unfinished exports, oversized bodies, HTTP errors, and cancellation', async () => {
        const fetcher = vi.fn().mockResolvedValueOnce(new Response('1. e4 *'))
            .mockResolvedValueOnce(new Response('x'.repeat(256 * 1024 + 1)))
            .mockResolvedValueOnce(new Response('', { status: 429 }));
        vi.stubGlobal('fetch', fetcher);
        await expect(completeGameSnapshot(snapshot)).rejects.toThrow('final result');
        await expect(completeGameSnapshot(snapshot)).rejects.toThrow('too large');
        await expect(completeGameSnapshot(snapshot)).rejects.toThrow('unavailable');
        const controller = new AbortController(); controller.abort();
        await expect(completeGameSnapshot(snapshot, controller.signal)).rejects.toThrow();
        expect(fetcher).toHaveBeenCalledTimes(3);
    });
});
