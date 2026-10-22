import { normalizedFen } from './chess';
import { fenAt } from './review-session';
import type { ReviewSession } from './review-types';
import type { NativeReviewSnapshot } from './site-review-types';

// Chrome serializes this function into MAIN world; retain all runtime helpers inside.
export function readNativeReview(): NativeReviewSnapshot {
    const url = new URL(location.href);
    const lichess = url.hostname === 'lichess.org';
    const supported = lichess || url.hostname === 'www.chess.com';
    const study = lichess ? /^\/(analysis|study)(\/|$)/.test(url.pathname) : /^\/(analysis|practice)(\/|$)/.test(url.pathname) || /^\/play\/computer(\/|$)/.test(url.pathname);
    const gameId = lichess
        ? (!study ? /^\/([a-zA-Z0-9]{8})(?:[a-zA-Z0-9]{4})?(?:\/(?:white|black))?\/?$/.exec(url.pathname)?.[1] : undefined)
        : /^\/(?:game\/(?:live|daily)|live\/game|analysis\/game\/(?:live|daily))\/(\d+)(?:\/|$)/.exec(url.pathname)?.[1];
    const board = document.querySelector<HTMLElement>(lichess ? '.analyse__board cg-board, .round__app cg-board, cg-board' : 'wc-chess-board, chess-board, .board');
    const orientation = (lichess ? board?.closest('.orientation-black') : board?.matches('.flipped') || board?.closest('.flipped')) ? 'black' : 'white';
    const snapshot: NativeReviewSnapshot = { url: url.href, gameId, allowed: false, orientation, canNavigate: false };
    if (!supported || !board || document.querySelector('.rclock.running, .clock-component.clock-player-turn, .back-to-game, .analyse.is-relay, main.analyse[class*="variant-"]:not(.variant-standard)')) return snapshot;
    const full = (value: unknown): string | undefined => {
        if (typeof value !== 'string' || value.length > 200) return;
        const fields = value.trim().split(/\s+/);
        return fields.length === 6 && /^[prnbqkPRNBQK1-8/]+$/.test(fields[0]) && /^[wb]$/.test(fields[1])
            && /^(?:-|K?Q?k?q?)$/.test(fields[2]) && /^(?:-|[a-h][36])$/.test(fields[3]) && /^\d+$/.test(fields[4]) && /^[1-9]\d*$/.test(fields[5]) ? fields.join(' ') : undefined;
    };
    const integer = (value: unknown): number | undefined => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1500 ? value : undefined;
    let completed = !!document.querySelector('.game-over-modal, .game-over-component, [data-game-status="finished"]');
    const result = document.querySelector('.game__meta .result, .analyse__tools .result, .result-wrap .result')?.textContent?.trim();
    if (result && /^(1-0|0-1|½-½|1\/2-1\/2)$/.test(result)) completed = true;
    if (lichess) {
        const status = document.querySelector('.game__meta .status')?.textContent?.trim().toLowerCase() ?? '';
        completed ||= /^(?:draw|drawn)(?:\s*[•·—-]|\s*$)/.test(status) || /\b(?:white|black)\s+(?:is\s+victorious|wins|won)\b/.test(status);
        type Node = { fen?: unknown; ply?: unknown; san?: unknown };
        type Analysis = { node?: Node; nodeList?: Node[]; path?: unknown; tree?: { root?: Node } };
        const global = window as Window & { site?: { analysis?: Analysis }; lichess?: { analysis?: Analysis } };
        const analysis = global.site?.analysis ?? global.lichess?.analysis;
        snapshot.fen = full(analysis?.node?.fen);
        snapshot.initialFen = full(analysis?.tree?.root?.fen);
        if (typeof analysis?.path === 'string' && analysis.path.length <= 3000) snapshot.path = analysis.path;
        const absolutePly = integer(analysis?.node?.ply);
        const rootPly = integer(analysis?.tree?.root?.ply);
        if (absolutePly !== undefined && rootPly !== undefined && absolutePly >= rootPly) snapshot.ply = absolutePly - rootPly;
        else if (absolutePly !== undefined && !snapshot.initialFen) snapshot.ply = absolutePly;
        if (snapshot.initialFen && Array.isArray(analysis?.nodeList) && analysis.nodeList.length <= 1501 && full(analysis.nodeList[0]?.fen) === snapshot.initialFen) {
            const nodes = analysis.nodeList.slice(1);
            if (nodes.length && nodes.every(node => typeof node?.san === 'string' && node.san.length <= 32)) snapshot.moves = nodes.map(node => node.san as string);
        }
    } else {
        type Node = { ply?: unknown; fen?: unknown };
        type Game = { getFEN?: () => unknown; getPGN?: () => unknown; getHeaders?: () => unknown; getSelectedNode?: () => Node; getPositionInfo?: () => Node; getHistorySANs?: () => unknown; getHistoryFENs?: () => unknown };
        const game = (board as HTMLElement & { game?: Game }).game;
        try {
            snapshot.fen = full(game?.getFEN?.());
            const node = (() => { try { return game?.getSelectedNode?.() ?? game?.getPositionInfo?.(); } catch { return undefined; } })();
            snapshot.ply = integer(node?.ply);
            const history = (() => { try { return game?.getHistorySANs?.(); } catch { return undefined; } })();
            if (Array.isArray(history) && history.length <= 1500) {
                const moves = history.map(move => typeof move === 'string' ? move : move && typeof move === 'object' ? move.san ?? move.uci : undefined);
                if (moves.every(move => typeof move === 'string' && move.length <= 32)) {
                    snapshot.moves = moves as string[];
                    const fens = (() => { try { return game?.getHistoryFENs?.(); } catch { return undefined; } })();
                    // The observed history API contains the initial FEN plus each
                    // selected-prefix position. Verify its shape/current endpoint
                    // before treating its length as an explicit selected index.
                    if (Array.isArray(fens) && fens.length === moves.length + 1 && fens.every(fen => full(fen)) && full(fens.at(-1)) === snapshot.fen) {
                        snapshot.initialFen = full(fens[0]);
                        snapshot.ply ??= moves.length;
                    }
                }
            }
            const pgn = game?.getPGN?.();
            if (typeof pgn === 'string' && pgn.length <= 256 * 1024) {
                const raw = game?.getHeaders?.();
                const headers = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
                const header = (name: string) => new RegExp(`^\\s*\\[${name}\\s+"([^"\\r\\n]*)"\\]`, 'm').exec(pgn)?.[1] ?? (typeof headers[name] === 'string' ? headers[name] as string : undefined);
                const link = header('Link');
                let linkedId: string | undefined;
                if (link) {
                    try {
                        const selected = new URL(link);
                        if (selected.hostname === url.hostname && selected.protocol === 'https:') linkedId = /^\/(?:game\/(?:live|daily)|live\/game|analysis\/game\/(?:live|daily))\/(\d+)(?:\/|$)/.exec(selected.pathname)?.[1];
                    } catch { /* Reject malformed export identities. */ }
                }
                if (gameId && (linkedId === gameId || (!link && header('GameId') === gameId))) {
                    completed ||= /^(1-0|0-1|1\/2-1\/2)$/.test(header('Result') ?? '');
                    snapshot.initialFen ??= full(header('FEN'));
                }
            }
        } catch { /* Native board replacement can temporarily remove its state. */ }
    }
    if (!snapshot.fen) snapshot.fen = full(board.getAttribute('data-fen'));
    if (!snapshot.fen) {
        for (const input of document.querySelectorAll<HTMLInputElement>('input[name="fen"], textarea[name="fen"], .analyse__underboard .fen input, .analyse__underboard .copyables input.copyable')) {
            if (input !== document.activeElement && (snapshot.fen = full(input.value))) break;
        }
    }
    // Only explicit native ply metadata is trusted. Text order alone is not a ply.
    if (snapshot.ply === undefined) {
        const selected = document.querySelector<HTMLElement>(lichess ? '.analyse__moves move.active[data-ply], .analyse__moves move[aria-current="true"][data-ply], .tview2 move.active[data-ply], .tview2 [data-ply][aria-current="true"], .round__app move.active[data-ply]' : '.move-list .node.active[data-ply], .vertical-move-list .node.selected[data-ply], [data-ply][aria-current="true"]');
        if (selected?.dataset.ply && /^\d+$/.test(selected.dataset.ply)) snapshot.ply = integer(Number(selected.dataset.ply));
    }
    snapshot.allowed = supported && ((study && !gameId) || (!!gameId && completed));
    return snapshot;
}

export function resolveReviewPly(session: ReviewSession, snapshot: NativeReviewSnapshot): number | undefined {
    if (!snapshot.allowed || !snapshot.fen || !session.source) return;
    try {
        const selected = new URL(snapshot.url), source = new URL(session.source.url);
        if (selected.protocol !== 'https:' || source.protocol !== 'https:' || selected.hostname !== source.hostname) return;
        const study = session.source.gameId === 'study' && !snapshot.gameId && selected.pathname === source.pathname && (selected.hostname === 'lichess.org' ? /^\/(analysis|study)(\/|$)/.test(selected.pathname) : selected.hostname === 'www.chess.com' && /^\/(analysis|practice)(\/|$)/.test(selected.pathname));
        const currentId = selected.hostname === 'lichess.org' ? /^\/([a-zA-Z0-9]{8})(?:[a-zA-Z0-9]{4})?(?:\/(?:white|black))?\/?$/.exec(selected.pathname)?.[1]
            : selected.hostname === 'www.chess.com' ? /^\/(?:game\/(?:live|daily)|live\/game|analysis\/game\/(?:live|daily))\/(\d+)(?:\/|$)/.exec(selected.pathname)?.[1] : undefined;
        if (!study && (snapshot.gameId !== session.source.gameId || currentId !== session.source.gameId)) return;
        const fen = normalizedFen(snapshot.fen);
        if (snapshot.initialFen && normalizedFen(snapshot.initialFen) !== session.initialFen) return;
        const matches = (ply: number) => {
            if (normalizedFen(fenAt(session, ply)) !== fen) return false;
            return !snapshot.moves || (snapshot.moves.length >= ply && snapshot.moves.slice(0, ply).every((move, index) => move === session.moves[index].san || move === session.moves[index].uci));
        };
        if (snapshot.ply !== undefined) return Number.isInteger(snapshot.ply) && snapshot.ply >= 0 && snapshot.ply <= session.moves.length && matches(snapshot.ply) ? snapshot.ply : undefined;
        const found: number[] = [];
        for (let ply = 0; ply <= session.moves.length; ply++) if (matches(ply)) found.push(ply);
        return found.length === 1 ? found[0] : undefined;
    } catch { return; }
}

// Native variation/history methods differ across site builds. Until a method is
// positively supported, retain the site's own controls and textual continuation.
export function navigateNativeReview(request: { direction: 'previous' | 'next' | 'first' | 'last' | 'select'; ply?: number; expectedUrl: string }): { ok: boolean } {
    if (location.href !== request.expectedUrl) return { ok: false };
    if (location.protocol !== 'https:' || !['www.chess.com','lichess.org'].includes(location.hostname) || document.querySelector('.rclock.running,.clock-component.clock-player-turn,.back-to-game')) return {ok:false};
    if(request.direction==='select' && Number.isInteger(request.ply) && request.ply!>0 && request.ply!<=1500){
        const nodes=[...document.querySelectorAll<HTMLElement>('.move-list [data-ply],.vertical-move-list [data-ply],.analyse__moves [data-ply],.tview2 [data-ply],.round__moves [data-ply]')].filter(node=>Number(node.dataset.ply)===request.ply);
        if(nodes.length!==1 || nodes[0].getAttribute('aria-disabled')==='true' || nodes[0].hasAttribute('disabled'))return {ok:false};
        nodes[0].click(); return {ok:true};
    }
    return { ok: false };
}
