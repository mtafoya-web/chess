import { MAX_PGN_LENGTH, sessionFromMoves, sessionFromPgn } from './review-session';
import type { ReviewSession } from './review-types';

export interface GameSnapshot {
    url: string; gameId: string; completed: boolean; pgn?: string; moves?: string[];
    initialFen?: string; result?: string; title?: string;
}

// Serialized into MAIN world. All runtime dependencies must stay inside this function.
export function readGameSnapshot(): GameSnapshot | undefined {
    const url = new URL(location.href);
    const gameId = url.hostname === 'www.chess.com'
        ? /^\/(?:game\/(?:live|daily)|live\/game|analysis\/game\/(?:live|daily))\/(\d+)(?:\/|$)/.exec(url.pathname)?.[1]
        : url.hostname === 'lichess.org' ? /^\/([a-zA-Z0-9]{8})(?:[a-zA-Z0-9]{4})?(?:\/(?:white|black))?\/?$/.exec(url.pathname)?.[1] : undefined;
    if (!gameId) return;
    const running = !!document.querySelector('.rclock.running, .clock-component.clock-player-turn, .back-to-game, .analyse.is-relay');
    const resultNodes = document.querySelectorAll<HTMLElement>('.game__meta .result, .analyse__tools .result, .result-wrap .result, .game-over-modal, .game-over-component, [data-game-status="finished"], [data-result]');
    let result: string | undefined;
    for (const node of resultNodes) {
        const value = (node.dataset.result ?? node.textContent ?? '').trim().replace(/½/g, '1/2');
        const match = /(?:^|\s)(1-0|0-1|1\/2-1\/2)(?=\s|$)/.exec(value);
        if (match) { result = match[1]; break; }
    }
    // Ordinary Lichess history-selected games render a prose status in their
    // metadata, before an analysis board or numeric result control exists.
    const status = url.hostname === 'lichess.org' ? document.querySelector('.game__meta .status')?.textContent?.trim().toLowerCase() ?? '' : '';
    const statusResult = /^(?:draw|drawn)(?:\s*[•·—-]|\s*$)/.test(status) ? '1/2-1/2'
        : /\bwhite\s+(?:is\s+victorious|wins|won)\b/.test(status) ? '1-0'
        : /\bblack\s+(?:is\s+victorious|wins|won)\b/.test(status) ? '0-1' : undefined;
    result ??= statusResult;
    let exportedPgn: string | undefined, exportedResult: string | undefined;
    try {
        const board = document.querySelector('wc-chess-board, chess-board') as Element & { game?: { getPGN?: () => unknown; getHeaders?: () => unknown } } | null;
        const pgn = board?.game?.getPGN?.();
        if (typeof pgn === 'string' && pgn.length > 0 && pgn.length <= 256 * 1024) {
            const rawHeaders = board?.game?.getHeaders?.();
            const headers = rawHeaders && typeof rawHeaders === 'object' ? rawHeaders as Record<string, unknown> : {};
            const header = (name: string) => new RegExp(`^\\s*\\[${name}\\s+"([^"\\r\\n]*)"\\]`, 'm').exec(pgn)?.[1]
                ?? (typeof headers[name] === 'string' ? headers[name] as string : undefined);
            const link = header('Link');
            const linkedId = link ? (() => {
                try {
                    const linked = new URL(link);
                    return linked.protocol === 'https:' && linked.hostname === 'www.chess.com'
                        ? /^\/(?:game\/(?:live|daily)|live\/game|analysis\/game\/(?:live|daily))\/(\d+)(?:\/|$)/.exec(linked.pathname)?.[1] : undefined;
                } catch { return undefined; }
            })() : undefined;
            // A SPA can retain the preceding board while the selected URL changes.
            // Only use its export when the game's own headers identify this game.
            if (url.hostname === 'www.chess.com' && (linkedId === gameId || (!link && header('GameId') === gameId))) {
                exportedPgn = pgn;
                const value = header('Result');
                if (value && /^(1-0|0-1|1\/2-1\/2)$/.test(value)) exportedResult = value;
            }
        }
    } catch { /* Export may not be ready; offer PGN import instead. */ }
    result ??= exportedResult;
    const completed = !running && (resultNodes.length > 0 || !!statusResult || !!exportedResult);
    const snapshot: GameSnapshot = { url: url.href, gameId, completed, result };
    if (!completed) return snapshot;
    const values: unknown[] = exportedPgn ? [exportedPgn] : [];
    for (const node of document.querySelectorAll<HTMLElement>('textarea[name="pgn"], textarea.pgn, .pgn textarea, .pgn .copyable, .analyse__underboard textarea.copyable, [data-pgn], script[type="application/x-chess-pgn"]')) {
        values.push(node.dataset.pgn ?? (node instanceof HTMLTextAreaElement ? node.value : node.textContent));
        if (values.length >= 20) break;
    }
    const pgn = values.find(value => typeof value === 'string' && value.length > 0 && value.length <= 256 * 1024);
    if (typeof pgn === 'string') snapshot.pgn = pgn;
    return snapshot;
}

export function captureSession(snapshot: GameSnapshot): ReviewSession {
    if (!snapshot || snapshot.completed !== true) throw new Error('Select a finished game from your game history first.');
    const url = new URL(snapshot.url);
    const gameId = url.hostname === 'www.chess.com'
        ? /^\/(?:game\/(?:live|daily)|live\/game|analysis\/game\/(?:live|daily))\/(\d+)(?:\/|$)/.exec(url.pathname)?.[1]
        : url.hostname === 'lichess.org' ? /^\/([a-zA-Z0-9]{8})(?:[a-zA-Z0-9]{4})?(?:\/(?:white|black))?\/?$/.exec(url.pathname)?.[1] : undefined;
    if (url.protocol !== 'https:' || !gameId || gameId !== snapshot.gameId) throw new Error('The selected game changed. Open it again from game history.');
    const source = { url: url.href, gameId };
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
    const selected = new URL(snapshot.url);
    if (selected.hostname !== 'lichess.org') return snapshot;
    const gameId = /^\/([a-zA-Z0-9]{8})(?:[a-zA-Z0-9]{4})?(?:\/(?:white|black))?\/?$/.exec(selected.pathname)?.[1];
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
