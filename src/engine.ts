import { Chess } from 'chess.js';
import { candidateFrom, evaluation, positionEvaluation } from './chess';
import { SEARCH_PROFILES, type SearchProfile } from './review-scoring';
import type { Candidate, Evaluation } from './types';

/** One reusable worker; a canceled in-flight search is terminated to isolate late UCI output. */
export class Engine {
    private worker?: Worker;
    private initialized = false;
    private reject?: (error: Error) => void;
    cancel() {
        if (!this.reject) return; // Completed workers remain warm.
        const reject = this.reject; this.reject = undefined;
        this.worker?.terminate(); this.worker = undefined; this.initialized = false;
        reject(new DOMException('Cancelled', 'AbortError'));
    }
    async analyze(fen: string, signal: AbortSignal, history?: { initialFen: string; moves: string[] }, profile: SearchProfile = 'standard'): Promise<Evaluation> {
        for (let attempt = 0; ; attempt++) {
            try { return await this.search(fen, signal, history, profile); }
            catch (error) {
                if (signal.aborted || attempt || error instanceof DOMException && error.name === 'AbortError') throw error;
            }
        }
    }
    private async search(fen: string, signal: AbortSignal, history: { initialFen: string; moves: string[] } | undefined, profile: SearchProfile): Promise<Evaluation> {
        signal.throwIfAborted();
        const board = new Chess(fen), terminal = positionEvaluation(board);
        if (terminal) return terminal;
        this.cancel();
        const settings = SEARCH_PROFILES[profile];
        const count = Math.min(settings.multiPV, board.moves().length);
        const worker = this.worker ??= new Worker(chrome.runtime.getURL('engine/stockfish-17.1-lite-single-03e3232.js'));
        return new Promise((resolve, reject) => {
            let searching = false, settled = false;
            const iterations = new Map<number, Map<number, Candidate>>();
            const abort = () => this.cancel();
            const finish = (error?: Error, value?: Evaluation) => {
                if (settled) return; settled = true;
                clearTimeout(timer); signal.removeEventListener('abort', abort);
                worker.onmessage = null; worker.onerror = null; this.reject = undefined;
                if (error) {
                    worker.terminate(); if (this.worker === worker) { this.worker = undefined; this.initialized = false; }
                    reject(error);
                } else resolve(value!);
            };
            const timer = setTimeout(() => finish(new Error('Stockfish timed out. Retry analysis.')), 20000);
            this.reject = error => finish(error);
            signal.addEventListener('abort', abort, { once: true });
            worker.onerror = () => finish(new Error('Stockfish failed to load. Check packaged WASM and extension CSP.'));
            const ready = () => {
                worker.postMessage('ucinewgame');
                worker.postMessage(`setoption name MultiPV value ${count}`);
                worker.postMessage('isready');
            };
            worker.onmessage = event => {
                for (const line of String(event.data).split('\n').map(l => l.trim())) {
                    if (line === 'uciok') { this.initialized = true; ready(); }
                    if (line === 'readyok' && !searching) {
                        searching = true;
                        worker.postMessage(history ? `position fen ${history.initialFen}${history.moves.length ? ` moves ${history.moves.join(' ')}` : ''}` : `position fen ${fen}`);
                        worker.postMessage(`go movetime ${settings.movetime}`);
                    }
                    if (line.startsWith('info ')) {
                        const parsed = candidateFrom(line, fen);
                        if (parsed && parsed.rank <= count) {
                            const depth = parsed.candidate.depth ?? 0;
                            const iteration = iterations.get(depth) ?? new Map<number, Candidate>();
                            iteration.set(parsed.rank, parsed.candidate); iterations.set(depth, iteration);
                            // Retain enough completed iterations without unbounded worker output.
                            if (iterations.size > 8) iterations.delete(Math.min(...iterations.keys()));
                        }
                    }
                    if (line.startsWith('bestmove ')) {
                        const best = line.split(/\s+/)[1];
                        const coherent = [...iterations].sort(([a], [b]) => b - a).find(([, values]) => values.size === count && values.get(1)?.uci === best);
                        const primary = [...iterations].sort(([a], [b]) => b - a).find(([, values]) => values.get(1)?.uci === best);
                        const candidates = coherent ? [...coherent[1]].sort(([a], [b]) => a - b).map(([, c]) => c) : primary ? [primary[1].get(1)!] : [];
                        if (!candidates.length) finish(new Error('Engine returned no reliable line. Retry analysis.'));
                        else finish(undefined, { ...evaluation(candidates), search: { profile: settings.id, movetime: settings.movetime, multiPV: candidates.length } });
                    }
                }
            };
            if (this.initialized) ready(); else worker.postMessage('uci');
        });
    }
}
