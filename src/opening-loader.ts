import { Chess, DEFAULT_POSITION } from 'chess.js';
import { createOpeningLookup, type OpeningContext, type OpeningRow } from './opening-context';
import type { BoardHistory } from './board-context';

let pending: Promise<ReturnType<typeof createOpeningLookup>> | undefined;
let ready: ReturnType<typeof createOpeningLookup> | undefined;
let retryAfter = 0;
function index() {
    if (!pending) pending = (async () => {
        performance.mark('kibitz:opening-load:start');
        try {
            const response = await fetch(chrome.runtime.getURL('data/openings.json'), { signal: AbortSignal.timeout(2000) });
            if (!response.ok) throw new Error('Opening data unavailable.');
            const value: unknown = await response.json();
            if (!Array.isArray(value) || value.length > 10000 || !value.every(row => Array.isArray(row) && row.length === 4 && row.every(v => typeof v === 'string' && v.length <= 4000))) throw new Error('Invalid opening data.');
            ready = createOpeningLookup(value as OpeningRow[]);
            return ready;
        } finally {
            performance.mark('kibitz:opening-load:end');
            performance.clearMeasures('kibitz:opening-load');
            performance.measure('kibitz:opening-load', 'kibitz:opening-load:start', 'kibitz:opening-load:end');
        }
    })().catch(error => { pending = undefined; retryAfter = Date.now() + 30000; throw error; });
    return pending;
}
export function cachedOpeningContext(fen: string, history: BoardHistory, suggested?: string): OpeningContext | undefined {
    return ready?.(fen, history, suggested);
}
/** Only the offscreen document calls this; no content-script resource exposure. */
export async function loadOpeningContext(fen: string, history?: BoardHistory, suggested?: string, signal?: AbortSignal): Promise<OpeningContext> {
    signal?.throwIfAborted();
    if (!history || Date.now() < retryAfter) return {};
    try { if (new Chess(history.initialFen).fen() !== DEFAULT_POSITION) return {}; }
    catch { return {}; }
    // A canceled caller stops waiting without aborting another caller's shared load.
    let onAbort: (() => void) | undefined;
    try {
        const cancelled = new Promise<never>((_, reject) => {
            onAbort = () => reject(signal?.reason ?? new DOMException('Cancelled', 'AbortError'));
            signal?.addEventListener('abort', onAbort, { once: true });
        });
        const lookup = await Promise.race([index(), cancelled]);
        signal?.throwIfAborted();
        return lookup(fen, history, suggested);
    } catch {
        signal?.throwIfAborted();
        return {}; // Opening metadata is optional; engine and coaching stay available.
    } finally { if (onAbort) signal?.removeEventListener('abort', onAbort); }
}
