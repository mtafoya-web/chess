import { MAX_PGN_LENGTH, sessionFromMoves, sessionFromPgn } from './review-session';
import type { ReviewSession } from './review-types';
import { parseLichessGameUrl } from './site-game-route';

export interface GameSnapshot {
    url: string; pageUrl?: string; canonicalGameUrl?: string; gameId?: string; completed: boolean; pgn?: string; moves?: string[];
    initialFen?: string; result?: string; title?: string;
}

export { readSiteSnapshot as readGameSnapshot } from './site-snapshot';

export function captureSession(snapshot: GameSnapshot): ReviewSession {
    if (!snapshot || snapshot.completed !== true) throw new Error('Select a finished game from your game history first.');
    const url = new URL(snapshot.canonicalGameUrl ?? snapshot.url);
    const gameId = url.hostname === 'www.chess.com'
        ? /^\/(?:game\/(?:live|daily)|live\/game|analysis\/game\/(?:live|daily))\/(\d+)(?:\/|$)/.exec(url.pathname)?.[1]
        : parseLichessGameUrl(url)?.gameId;
    if (url.protocol !== 'https:' || !gameId || gameId !== snapshot.gameId) throw new Error('The selected game changed. Open it again from game history.');
    const pageUrl = snapshot.pageUrl ?? snapshot.url;
    const source = { url: parseLichessGameUrl(pageUrl)?.publicUrl ?? pageUrl, canonicalGameUrl: parseLichessGameUrl(url)?.canonicalUrl ?? url.href, gameId };
    const session = snapshot.pgn ? sessionFromPgn(snapshot.pgn, source)
        : snapshot.moves ? sessionFromMoves(snapshot.moves, snapshot.initialFen, source, snapshot.result)
        : undefined;
    if (!session) throw new Error('Complete game history is unavailable on this page. Import its PGN to review it.');
    if (!['1-0', '0-1', '1/2-1/2'].includes(session.result)) throw new Error('The game export has no final result. Import the completed game PGN.');
    if (snapshot.result && snapshot.result !== session.result) throw new Error('The game result changed. Capture the completed game again.');
    if (snapshot.title) session.title = snapshot.title.slice(0, 180);
    return session;
}

// Official single-game export: https://lichess.org/api#tag/Games/operation/gamePgn
// Called only after the selected game's completion has been verified on its page.
export async function completeGameSnapshot(snapshot: GameSnapshot, signal?: AbortSignal): Promise<GameSnapshot> {
    signal?.throwIfAborted();
    if (!snapshot.completed || snapshot.pgn || snapshot.moves) return snapshot;
    const selected = new URL(snapshot.canonicalGameUrl ?? snapshot.url);
    if (selected.hostname !== 'lichess.org') return snapshot;
    const gameId = parseLichessGameUrl(selected)?.gameId;
    if (selected.protocol !== 'https:' || !gameId || gameId !== snapshot.gameId) throw new Error('The selected game changed. Open it again from game history.');
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error('Game export timed out. Import its PGN to review it.')), 12000);
    try {
        const response = await fetch(`https://lichess.org/game/export/${gameId}?moves=true&tags=true&clocks=false&evals=false&opening=false`, {
            headers: { Accept: 'application/x-chess-pgn' }, credentials: 'omit', redirect: 'error', signal: controller.signal,
        });
        if (!response.ok) throw new Error('Game export unavailable. Import its PGN to review it.');
        if (Number(response.headers.get('Content-Length') ?? 0) > MAX_PGN_LENGTH || response.headers.get('Content-Type')?.includes('text/html')) throw new Error('Invalid game export. Import its PGN to review it.');
        if (!response.body) throw new Error('Empty game export. Import its PGN to review it.');
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let bytes = 0, pgn = '';
        try {
            while (true) {
                controller.signal.throwIfAborted();
                const chunk = await reader.read();
                if (chunk.done) break;
                bytes += chunk.value.byteLength;
                if (bytes > MAX_PGN_LENGTH) throw new Error('Game export is too large. Import a PGN smaller than 256 KiB.');
                pgn += decoder.decode(chunk.value, { stream: true });
            }
            pgn += decoder.decode();
        } finally { await reader.cancel().catch(() => {}); }
        controller.signal.throwIfAborted();
        const completed = { ...snapshot, pgn };
        captureSession(completed); // Reject unfinished, malformed, or result-mismatched exports.
        return completed;
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
    }
}
