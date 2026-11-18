import type { NativeReviewSnapshot } from './site-review-types';

/** Page location and game identity are deliberately separate on history/SPA pages. */
export interface SiteSnapshot extends NativeReviewSnapshot {
    pageUrl: string;
    canonicalGameUrl?: string;
    completed: boolean;
    running?: boolean;
    result?: string;
    pgn?: string;
    title?: string;
}

/** Serialized into MAIN world: keep every runtime dependency inside this function. */
export function readSiteSnapshot(): SiteSnapshot {
    const url = new URL(location.href), lichess = url.hostname === 'lichess.org';
    const supported = url.protocol === 'https:' && (lichess || url.hostname === 'www.chess.com');
    const idAt = (value: URL) => value.origin !== url.origin ? undefined : lichess
        ? /^\/(?:analysis|study|practice|training)(?:\/|$)/.test(value.pathname) ? undefined : /^\/(?:game\/)?([a-zA-Z0-9]{8})(?:[a-zA-Z0-9]{4})?(?:\/(?:white|black))?(?:\/analysis)?\/?$/.exec(value.pathname)?.[1]
        : /^\/(?:game\/(?:live|daily)|live\/game|analysis\/game\/(?:live|daily))\/(\d+)(?:\/|$)/.exec(value.pathname)?.[1];
    const study = /^\/(analysis|study|practice)(\/|$)/.test(url.pathname) && !/^\/analysis\/game\//.test(url.pathname)
        || !lichess && /^\/play\/computer(?:\/|$)/.test(url.pathname);
    const routeGameId = study ? undefined : idAt(url);
    const board = document.querySelector<HTMLElement>(lichess ? '.analyse__board cg-board, .round__app cg-board, cg-board' : 'wc-chess-board, chess-board, .board');
    const orientation = (lichess ? board?.closest('.orientation-black') : board?.matches('.flipped') || board?.closest('.flipped')) ? 'black' : 'white';
    const snapshot: SiteSnapshot = { url: url.href, pageUrl: url.href, gameId: routeGameId, allowed: false, completed: false, orientation, canNavigate: false };
    if (!supported || document.querySelector('.back-to-game, .analyse.is-relay, main.analyse[class*="variant-"]:not(.variant-standard), .round__app[class*="variant-"]:not(.variant-standard)')) return snapshot;
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
    snapshot.running = running;
    let exportResult: string | undefined, exportMismatch = false, unfinishedExport = false;
    if (!snapshot.gameId && !study) {
        for (const anchor of document.querySelectorAll<HTMLAnchorElement>('a[href]')) {
            if (!anchor.closest('.active, .selected, [aria-current="true"], [aria-pressed="true"]')) continue;
            try {
                const selected = new URL(anchor.href, url.origin), id = idAt(selected);
                if (id) { snapshot.gameId = id; snapshot.canonicalGameUrl = selected.href; break; }
            } catch { /* Ignore malformed links. */ }
        }
    }
    if (!lichess) {
        type Node = { ply?: unknown; fen?: unknown };
        type Game = { getFEN?: () => unknown; getPGN?: () => unknown; getHeaders?: () => unknown; getSelectedNode?: () => Node; getPositionInfo?: () => Node; getHistorySANs?: () => unknown; getHistoryFENs?: () => unknown };
        const game = (board as HTMLElement & { game?: Game } | null)?.game;
        try {
            snapshot.fen = full(game?.getFEN?.());
            snapshot.ply = integer((game?.getSelectedNode?.() ?? game?.getPositionInfo?.())?.ply);
        } catch { /* A board can be replaced between reads. */ }
        try {
            const raw = game?.getPGN?.(), rawHeaders = game?.getHeaders?.();
            const pgn = typeof raw === 'string' && raw.length <= 262144 ? raw : '';
            const headers = rawHeaders && typeof rawHeaders === 'object' ? rawHeaders as Record<string, unknown> : {};
            const pgnHeader = (name: string) => new RegExp(`^\\s*\\[${name}\\s+"([^"\\r\\n]*)"\\]`, 'm').exec(pgn)?.[1];
            const nativeHeader = (name: string): string | undefined => typeof headers[name] === 'string' ? headers[name] as string
                : name === 'GameId' && Number.isSafeInteger(headers[name]) && Number(headers[name]) >= 0 ? String(headers[name]) : undefined;
            const header = (name: string) => pgnHeader(name) ?? nativeHeader(name);
            const links = [pgnHeader('Link'), nativeHeader('Link')].filter((value): value is string => value !== undefined);
            const ids = links.map(link => { try { return idAt(new URL(link)); } catch { return undefined; } });
            for (const id of [pgnHeader('GameId'), nativeHeader('GameId')]) {
                if (id !== undefined) ids.push(/^\d+$/.test(id) ? id : undefined);
            }
            const declaredResults = [pgnHeader('Result'), nativeHeader('Result')].filter((value): value is string => value !== undefined);
            unfinishedExport = declaredResults.some(value => value.trim() === '*');
            exportMismatch = ids.some(id => !id || !!snapshot.gameId && id !== snapshot.gameId)
                || new Set(ids).size > 1 || new Set(declaredResults.map(value => finalResult(value) ?? value.trim())).size > 1;
            const exportedId = ids[0];
            // Link/GameId tags are optional in Chess.com's native PGN. On an
            // individual game page its route supplies the missing identity.
            const acceptedId = exportedId ?? routeGameId;
            if (!exportMismatch && acceptedId) {
                snapshot.gameId ??= acceptedId;
                snapshot.canonicalGameUrl = `https://www.chess.com/game/${/daily/.test(links[0] ?? url.pathname) ? 'daily' : 'live'}/${acceptedId}`;
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
    snapshot.fen ??= full(board?.getAttribute('data-fen'));
    if (!snapshot.fen) for (const input of document.querySelectorAll<HTMLInputElement>('input[name="fen"], textarea[name="fen"], .analyse__underboard .fen input, .analyse__underboard .copyables input.copyable')) {
        if (input !== document.activeElement && (snapshot.fen = full(input.value))) break;
    }
    // A placement is not a FEN. The trusted coordinator may bind it to exactly
    // one captured legal mainline position, retaining that position's rights/turn.
    if (!snapshot.fen && board) {
        const cells: string[][] = Array.from({length:8},()=>Array(8).fill(''));
        const pieces = [...board.querySelectorAll<HTMLElement>(lichess ? 'piece:not(.ghost)' : '.piece')];
        const rect = board.getBoundingClientRect();
        let valid = pieces.length > 0 && pieces.length <= 32;
        for (const piece of pieces) {
            let file: number, rank: number, code: string | undefined;
            if (lichess) {
                const p = piece.getBoundingClientRect();
                const x = Math.round((p.left-rect.left)/(rect.width/8)), y = Math.round((p.top-rect.top)/(rect.height/8));
                file = orientation==='white'?x:7-x; rank = orientation==='white'?7-y:y;
                const name = Object.entries({pawn:'p',knight:'n',bishop:'b',rook:'r',queen:'q',king:'k'}).find(([key])=>piece.classList.contains(key))?.[1];
                code = piece.classList.contains('white') ? name?.toUpperCase() : piece.classList.contains('black') ? name : undefined;
            } else {
                const square = /\bsquare-([1-8])([1-8])\b/.exec(piece.className), value = /\b([wb])([pnbrqk])\b/.exec(piece.className);
                file = Number(square?.[1])-1; rank = Number(square?.[2])-1;
                code = value?.[1]==='w'?value[2].toUpperCase():value?.[2];
            }
            if (!Number.isInteger(file) || !Number.isInteger(rank) || file<0 || file>7 || rank<0 || rank>7 || !code || cells[rank][file]) {valid=false;break;}
            cells[rank][file]=code;
        }
        if (valid) snapshot.placement = cells.reverse().map(row=>{
            let value='', empty=0;
            for(const piece of row){if(!piece)empty++;else{if(empty)value+=empty;empty=0;value+=piece;}}
            return value+(empty||'');
        }).join('/');
    }
    if (snapshot.ply === undefined) {
        const selected = document.querySelector<HTMLElement>('.move-list .node.active[data-ply], .vertical-move-list .node.selected[data-ply], .analyse__moves move.active[data-ply], .tview2 move.active[data-ply], .round__app move.active[data-ply], [data-ply][aria-current="true"]');
        if (selected?.dataset.ply && /^\d+$/.test(selected.dataset.ply)) snapshot.ply = integer(Number(selected.dataset.ply));
    }
    // Round notation uses generated tag names and delegated mousedown events.
    // Count only SAN siblings of the selected move, never navigation controls.
    if (lichess && snapshot.ply === undefined) {
        const selected = document.querySelector<HTMLElement>('.round__app .a1t');
        if (selected?.parentElement) {
            const san = /^(?:O-O(?:-O)?|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?)[+#]?[!?]*$/;
            const nodes = [...selected.parentElement.children].filter(node => node.tagName === selected.tagName && san.test((node.firstChild?.textContent ?? '').trim()));
            const index = nodes.indexOf(selected);
            if (index >= 0 && nodes.length <= 1500) { snapshot.ply = index + 1; snapshot.canNavigate = true; }
        }
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
    snapshot.completed = !exportMismatch && !unfinishedExport && !!snapshot.gameId && (!!exportResult || !running && !!domResult);
    snapshot.allowed = !!board && !exportMismatch && (snapshot.completed || study && !running);
    if (snapshot.gameId) snapshot.canonicalGameUrl ??= lichess ? `https://lichess.org/game/${snapshot.gameId}` : `https://www.chess.com/game/${/daily/.test(url.pathname) ? 'daily' : 'live'}/${snapshot.gameId}`;
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
