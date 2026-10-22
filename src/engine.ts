import { Chess } from 'chess.js';
import { candidateFrom, evaluation, positionEvaluation } from './chess';
import type { Candidate, Evaluation } from './types';

export class Engine {
    private worker?: Worker;
    private reject?: (error: Error) => void;
    cancel() {
        this.worker?.terminate(); this.worker = undefined;
        this.reject?.(new DOMException('Cancelled', 'AbortError')); this.reject = undefined;
    }
    async analyze(fen: string, signal: AbortSignal, history?: { initialFen: string; moves: string[] }): Promise<Evaluation> {
        signal.throwIfAborted();
        const terminal = positionEvaluation(new Chess(fen));
        if (terminal) return terminal;
        this.cancel();
        // Filename belongs to the pinned stockfish@17.1.0 distribution. The build
        // copies JS and WASM unchanged beside one another, preserving resolution.
        const name = 'stockfish-17.1-lite-single-03e3232.js';
        return new Promise((resolve, reject) => {
            this.reject = reject;
            performance.mark('kibitz:engine:start');
            const worker = this.worker = new Worker(chrome.runtime.getURL(`engine/${name}`));
            let searching = false;
            const lines = new Map<number, Candidate>();
            const stop = () => this.cancel();
            signal.addEventListener('abort', stop, { once: true });
            const timer = setTimeout(() => finish(new Error('Stockfish timed out. Try again.')), 20000);
            const finish = (error?: Error, value?: Evaluation) => {
                clearTimeout(timer); signal.removeEventListener('abort', stop);
                worker.terminate(); if (this.worker === worker) { this.worker = undefined; this.reject = undefined; }
                if (error) reject(error); else resolve(value!);
            };
            // Also clean up the watchdog and listener if cancellation rejects this promise.
            this.reject = error => finish(error);
            worker.onerror = () => finish(new Error('Stockfish failed to load. Check packaged WASM and extension CSP.'));
            worker.onmessage = event => {
                for (const line of String(event.data).split('\n')) {
                    if (line === 'uciok') { worker.postMessage('setoption name MultiPV value 3'); worker.postMessage('isready'); }
                    if (line === 'readyok' && !searching) {
                        performance.mark('kibitz:engine:ready');
                        performance.clearMeasures('kibitz:engine-init');
                        performance.measure('kibitz:engine-init', 'kibitz:engine:start', 'kibitz:engine:ready');
                        searching = true; worker.postMessage(history ? `position fen ${history.initialFen}${history.moves.length ? ` moves ${history.moves.join(' ')}` : ''}` : `position fen ${fen}`); worker.postMessage('go movetime 1500');
                    }
                    if (line.startsWith('info ')) { const parsed = candidateFrom(line, fen); if (parsed) lines.set(parsed.rank, parsed.candidate); }
                    if (line.startsWith('bestmove ')) {
                        const best = line.split(' ')[1];
                        const candidates = [...lines].sort(([a], [b]) => a - b).map(([, c]) => c);
                        if (!candidates.length || candidates[0].uci !== best) finish(new Error('Engine returned no reliable line. Try again.'));
                        else finish(undefined, evaluation(candidates));
                    }
                }
            };
            worker.postMessage('uci');
        });
    }
}
