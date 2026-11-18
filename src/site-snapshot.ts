import type { NativeReviewSnapshot } from './site-review-types';

/** Page location and game identity are deliberately separate on history/SPA pages. */
export interface SiteSnapshot extends NativeReviewSnapshot {
    pageUrl: string;
    canonicalGameUrl?: string;
    completed: boolean;
    result?: string;
    pgn?: string;
    title?: string;
}

/** Serialized into MAIN world: keep every runtime dependency inside this function. */
export function readSiteSnapshot(): SiteSnapshot {
    const url = new URL(location.href), lichess = url.hostname === 'lichess.org';
    const supported = url.protocol === 'https:' && (lichess || url.hostname === 'www.chess.com');
    const idAt = (value: URL) => value.origin !== url.origin ? undefined : lichess
        ? /^\/([a-zA-Z0-9]{8})(?:[a-zA-Z0-9]{4})?(?:\/(?:white|black))?\/?$/.exec(value.pathname)?.[1]
        : /^\/(?:game\/(?:live|daily)|live\/game|analysis\/game\/(?:live|daily))\/(\d+)(?:\/|$)/.exec(value.pathname)?.[1];
    const study = /^\/(analysis|study|practice)(\/|$)/.test(url.pathname) && !/^\/analysis\/game\//.test(url.pathname)
        || !lichess && /^\/play\/computer(?:\/|$)/.test(url.pathname);
    const board = document.querySelector<HTMLElement>(lichess ? '.analyse__board cg-board, .round__app cg-board, cg-board' : 'wc-chess-board, chess-board, .board');
    const orientation = (lichess ? board?.closest('.orientation-black') : board?.matches('.flipped') || board?.closest('.flipped')) ? 'black' : 'white';
    const snapshot: SiteSnapshot = { url: url.href, pageUrl: url.href, gameId: study ? undefined : idAt(url), allowed: false, completed: false, orientation, canNavigate: false };
    if (!supported || !board || document.querySelector('.back-to-game, .analyse.is-relay, main.analyse[class*="variant-"]:not(.variant-standard)')) return snapshot;
    const full = (value: unknown): string | undefined => {
        if (typeof value !== 'string' || value.length > 200) return;
        const f = value.trim().split(/\s+/);
        return f.length === 6 && /^[prnbqkPRNBQK1-8/]+$/.test(f[0]) && /^[wb]$/.test(f[1]) && /^(?:-|K?Q?k?q?)$/.test(f[2])
            && /^(?:-|[a-h][36])$/.test(f[3]) && /^\d+$/.test(f[4]) && /^[1-9]\d*$/.test(f[5]) ? f.join(' ') : undefined;
    };
    const integer = (v: unknown): number | undefined => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 1500 ? v : undefined;
    const finalResult = (v: unknown): string | undefined => {
        if (typeof v !== 'string') return;
        const text = v.trim().replace(/½/g, '1/2').replace(/[–−]/g, '-');
        return /(?:^|\s)(1-0|0-1|1\/2-1\/2)(?=\s|$)/.exec(text)?.[1];
    };
    const running = !!document.querySelector('.rclock.running, .clock-component.clock-player-turn');
    let exportResult: string | undefined, exportMismatch = false;
    if (!lichess) {
        type Node = { ply?: unknown; fen?: unknown };
        type Game = { getFEN?: () => unknown; getPGN?: () => unknown; getHeaders?: () => unknown; getSelectedNode?: () => Node; getPositionInfo?: () => Node; getHistorySANs?: () => unknown; getHistoryFENs?: () => unknown };
        const game = (board as HTMLElement & { game?: Game }).game;
        try {
            snapshot.fen = full(game?.getFEN?.());
            snapshot.ply = integer((game?.getSelectedNode?.() ?? game?.getPositionInfo?.())?.ply);
        } catch { /* A board can be replaced between reads. */ }
        try {
            const raw = game?.getPGN?.(), rawHeaders = game?.getHeaders?.();
            const pgn = typeof raw === 'string' && raw.length <= 262144 ? raw : '';
            const headers = rawHeaders && typeof rawHeaders === 'object' ? rawHeaders as Record<string, unknown> : {};
            const header = (name: string) => new RegExp(`^\\s*\\[${name}\\s+"([^"\\r\\n]*)"\\]`, 'm').exec(pgn)?.[1]
                ?? (typeof headers[name] === 'string' ? headers[name] as string : undefined);
            let linkedId: string | undefined;
            const link = header('Link');
            if (link) { try { linkedId = idAt(new URL(link)); } catch { /* Invalid identity. */ } }
            const exportedId = linkedId ?? (/^\d+$/.test(header('GameId') ?? '') ? header('GameId') : undefined);
            exportMismatch = !!snapshot.gameId && !!exportedId && snapshot.gameId !== exportedId;
            if (!exportMismatch && exportedId) {
                snapshot.gameId ??= exportedId;
                snapshot.canonicalGameUrl = `https://www.chess.com/game/${/daily/.test(link ?? url.pathname) ? 'daily' : 'live'}/${exportedId}`;
                snapshot.pgn = pgn || undefined;
                exportResult = finalResult(header('Result'));
                snapshot.initialFen = full(header('FEN'));
                const white = header('White'), black = header('Black');
                if (white && black) snapshot.title = `${white} vs ${black}`.slice(0, 180);
            }
        } catch { /* Export is optional; DOM and import remain available. */ }
        try {
            const history = game?.getHistorySANs?.(), fens = game?.getHistoryFENs?.();
            if (Array.isArray(history) && history.length <= 1500) {
                const moves = history.map(m => typeof m === 'string' ? m : m && typeof m === 'object' ? m.san ?? m.uci : undefined);
                if (moves.every(m => typeof m === 'string' && m.length <= 32)) {
                    snapshot.moves = moves;
                    if (Array.isArray(fens) && fens.length === moves.length + 1 && fens.every(full) && full(fens.at(-1)) === snapshot.fen) {
                        snapshot.initialFen ??= full(fens[0]); snapshot.ply ??= moves.length;
                    }
                }
            }
        } catch { /* Selected history is optional. */ }
    } else {
        type Node = { fen?: unknown; ply?: unknown; san?: unknown };
        type Analysis = { node?: Node; nodeList?: Node[]; path?: unknown; tree?: { root?: Node } };
        const global = window as Window & { site?: { analysis?: Analysis }; lichess?: { analysis?: Analysis } };
        const analysis = global.site?.analysis ?? global.lichess?.analysis;
        snapshot.fen = full(analysis?.node?.fen); snapshot.initialFen = full(analysis?.tree?.root?.fen);
        if (typeof analysis?.path === 'string' && analysis.path.length <= 3000) snapshot.path = analysis.path;
        const ply = integer(analysis?.node?.ply), root = integer(analysis?.tree?.root?.ply);
        snapshot.ply = ply !== undefined && root !== undefined && ply >= root ? ply - root : !snapshot.initialFen ? ply : undefined;
        if (snapshot.initialFen && Array.isArray(analysis?.nodeList) && analysis.nodeList.length <= 1501 && full(analysis.nodeList[0]?.fen) === snapshot.initialFen) {
            const nodes = analysis.nodeList.slice(1);
            if (nodes.every(n => typeof n.san === 'string' && n.san.length <= 32)) snapshot.moves = nodes.map(n => n.san as string);
        }
    }
    // A selected history entry is useful; an arbitrary game link elsewhere is not.
    if (!snapshot.gameId && !study) {
        for (const anchor of document.querySelectorAll<HTMLAnchorElement>('a[href]')) {
            if (!anchor.closest('.active, .selected, [aria-current="true"], [aria-pressed="true"]')) continue;
            try {
                const selected = new URL(anchor.href, url.origin), id = idAt(selected);
                if (id) { snapshot.gameId = id; snapshot.canonicalGameUrl = selected.href; break; }
            } catch { /* Ignore malformed links. */ }
        }
    }
    snapshot.fen ??= full(board.getAttribute('data-fen'));
    if (!snapshot.fen) for (const input of document.querySelectorAll<HTMLInputElement>('input[name="fen"], textarea[name="fen"], .analyse__underboard .fen input, .analyse__underboard .copyables input.copyable')) {
        if (input !== document.activeElement && (snapshot.fen = full(input.value))) break;
    }
    if (snapshot.ply === undefined) {
        const selected = document.querySelector<HTMLElement>('.move-list .node.active[data-ply], .vertical-move-list .node.selected[data-ply], .analyse__moves move.active[data-ply], .tview2 move.active[data-ply], .round__app move.active[data-ply], [data-ply][aria-current="true"]');
        if (selected?.dataset.ply && /^\d+$/.test(selected.dataset.ply)) snapshot.ply = integer(Number(selected.dataset.ply));
    }
    let domResult: string | undefined;
    for (const node of document.querySelectorAll<HTMLElement>('.game__meta .result, .analyse__tools .result, .result-wrap .result, .game-over-modal, .game-over-component, [data-game-status="finished"], [data-result]')) {
        domResult ??= finalResult(node.dataset.result ?? node.textContent);
    }
    if (lichess) {
        const status = document.querySelector('.game__meta .status')?.textContent?.trim().toLowerCase() ?? '';
        domResult ??= /^(?:draw|drawn)(?:\s*[•·—-]|\s*$)/.test(status) ? '1/2-1/2'
            : /\bwhite\s+(?:is\s+victorious|wins|won)\b/.test(status) ? '1-0'
            : /\bblack\s+(?:is\s+victorious|wins|won)\b/.test(status) ? '0-1' : undefined;
    }
    // An identified native export outranks a lingering clock animation.
    snapshot.result = exportResult ?? domResult;
    snapshot.completed = !exportMismatch && !!snapshot.gameId && (!!exportResult || !running && !!domResult);
    snapshot.allowed = !exportMismatch && (snapshot.completed || study && !running);
    if (snapshot.gameId) snapshot.canonicalGameUrl ??= lichess ? `https://lichess.org/${snapshot.gameId}` : `https://www.chess.com/game/${/daily/.test(url.pathname) ? 'daily' : 'live'}/${snapshot.gameId}`;
    if (snapshot.completed && !snapshot.pgn) {
        for (const node of document.querySelectorAll<HTMLElement>('textarea[name="pgn"], textarea.pgn, .pgn textarea, .pgn .copyable, .analyse__underboard textarea.copyable, [data-pgn], script[type="application/x-chess-pgn"]')) {
            const value = node.dataset.pgn ?? (node instanceof HTMLTextAreaElement ? node.value : node.textContent);
            if (value && value.length <= 262144) { snapshot.pgn = value; break; }
        }
        // Native move arrays are often only the selected prefix. Use a full export
        // instead of incorrectly calling that prefix the complete game.
        snapshot.moves = undefined;
    }
    return snapshot;
}
