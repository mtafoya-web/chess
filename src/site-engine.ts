/** Small allowlisted MAIN-world payload. No site engine is started or configured. */
export interface NativeEngineSnapshot {
    source: 'lichess-client' | 'lichess-server'; url: string; fen: string; evaluationFen: string;
    path: string; ply: number; variant: 'standard'; perspective: 'white'; capturedAt: number;
    depth: number; engine?: string; cloud?: boolean;
    candidates: { cp?: number; mate?: number; moves: string[] }[];
}

// chrome.scripting serializes this function: keep every runtime helper inside it.
export function readNativeEngine(): NativeEngineSnapshot | undefined {
    try {
        if (location.hostname !== 'lichess.org' || document.querySelector('.rclock.running, .back-to-game, .analyse.is-relay')) return;
        type Raw = { cp?: unknown; mate?: unknown; moves?: unknown; fen?: unknown; depth?: unknown; pvs?: unknown; engineId?: unknown; cloud?: unknown };
        type Controller = { node?: { fen?: unknown; ply?: unknown; ceval?: Raw; eval?: Raw }; path?: unknown; ongoing?: unknown; threatMode?: unknown; variantKey?: unknown; data?: { game?: { variant?: { key?: unknown } } } };
        const global = window as Window & { site?: { analysis?: Controller }; lichess?: { analysis?: Controller } };
        const analysis = global.site?.analysis ?? global.lichess?.analysis;
        if (!analysis || analysis.ongoing === true || (analysis.variantKey ?? analysis.data?.game?.variant?.key) !== 'standard') return;
        if (typeof analysis.threatMode === 'function' ? analysis.threatMode() : analysis.threatMode) return;
        const node = analysis.node;
        if (!node || typeof node.fen !== 'string' || node.fen.length > 200 || typeof analysis.path !== 'string' || analysis.path.length > 3000
            || !Number.isSafeInteger(node.ply) || (node.ply as number) < 0 || (node.ply as number) > 3000) return;
        for (const [source, raw] of [['lichess-client', node.ceval], ['lichess-server', node.eval]] as const) {
            if (!raw || typeof raw.fen !== 'string' || raw.fen !== node.fen || typeof raw.depth !== 'number' || !Number.isSafeInteger(raw.depth) || raw.depth < 1 || raw.depth > 256 || !Array.isArray(raw.pvs)) continue;
            const candidates: NativeEngineSnapshot['candidates'] = [];
            for (const pv of raw.pvs.slice(0, 5) as Raw[]) {
                if (!pv || typeof pv !== 'object') { candidates.length = 0; break; }
                const moves = typeof pv.moves === 'string' && pv.moves.length <= 2048 ? pv.moves.trim().split(/\s+/) : Array.isArray(pv.moves) ? pv.moves.slice(0, 24) : [];
                if (!moves.length || moves.some(move => typeof move !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move))) { candidates.length = 0; break; }
                const cp = typeof pv.cp === 'number' && Number.isFinite(pv.cp) && Math.abs(pv.cp) <= 100000 ? pv.cp : undefined;
                const mate = typeof pv.mate === 'number' && Number.isSafeInteger(pv.mate) && Math.abs(pv.mate) <= 1000 ? pv.mate : undefined;
                if ((cp === undefined) === (mate === undefined) || mate === 0) { candidates.length = 0; break; }
                candidates.push({ ...(cp !== undefined ? { cp } : { mate }), moves: moves.slice(0, 24) });
            }
            if (candidates.length) return { source, url: location.href, fen: node.fen, evaluationFen: raw.fen, path: analysis.path, ply: node.ply as number,
                variant: 'standard', perspective: 'white', capturedAt: Date.now(), depth: raw.depth, candidates,
                ...(typeof raw.engineId === 'string' && raw.engineId.length <= 120 ? { engine: raw.engineId } : {}), ...(raw.cloud === true ? { cloud: true } : {}) };
        }
    } catch { /* Internal site APIs may disappear during navigation; use local analysis. */ }
}
