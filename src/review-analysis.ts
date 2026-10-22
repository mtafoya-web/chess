import { Chess } from 'chess.js';
import { normalizedFen, playUci, positionEvaluation } from './chess';
import { moveFeedback } from './move-feedback';
import type { Evaluation } from './types';
import type { MoveFeedback, ReviewMove, ReviewRequest } from './review-types';

interface Analyzer { analyze(fen: string, signal: AbortSignal, history?: { initialFen: string; moves: string[] }): Promise<Evaluation> }
export interface ReviewAnalysis { before?: Evaluation; after: Evaluation; feedback?: MoveFeedback; fen: string; move?: ReviewMove }

export function validateReview(request: ReviewRequest) {
    if (!request || typeof request.sessionId !== 'string' || !request.sessionId || request.sessionId.length > 200 || typeof request.requestId !== 'string' || !request.requestId || request.requestId.length > 200 || typeof request.initialFen !== 'string' || request.initialFen.length > 200 || !Array.isArray(request.moves) || request.moves.length > 2000 || request.moves.some(move => typeof move !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)) || !Number.isInteger(request.ply) || request.ply < 0 || request.ply > request.moves.length || request.ai !== undefined && typeof request.ai !== 'boolean') throw new Error('Invalid review request.');
    const initialFen = normalizedFen(request.initialFen);
    const chess = new Chess(initialFen);
    let selected: ReviewMove | undefined;
    for (let index = 0; index < request.moves.length; index++) {
        // Repetition and fifty-move draws require a claim; a real game can continue.
        if (chess.isCheckmate() || chess.isStalemate() || chess.isInsufficientMaterial()) throw new Error('Review contains moves after the game ended.');
        const beforeFen = chess.fen();
        const move = playUci(chess, request.moves[index]);
        if (index + 1 === request.ply) selected = { ply: index + 1, uci: request.moves[index], san: move.san, color: move.color, beforeFen, afterFen: chess.fen() };
    }
    return { initialFen, selected };
}

/** Bounded per-offscreen cache. Full history protects repetition-sensitive positions. */
export class ReviewAnalyzer {
    private cache = new Map<string, Evaluation>();
    constructor(private engine: Analyzer, private limit = 160) {}
    async analyze(request: ReviewRequest, signal: AbortSignal): Promise<ReviewAnalysis> {
        signal.throwIfAborted();
        const { initialFen, selected } = validateReview(request);
        const position = new Chess(initialFen);
        const evaluate = async (ply: number) => {
            signal.throwIfAborted();
            const key = JSON.stringify(['stockfish-17.1-lite:1500:3:v1', initialFen, request.moves.slice(0, ply)]);
            const cached = this.cache.get(key);
            if (cached) { this.cache.delete(key); this.cache.set(key, cached); return structuredClone(cached); }
            const value = positionEvaluation(position) ?? await this.engine.analyze(position.fen(), signal, { initialFen, moves: request.moves.slice(0, ply) });
            signal.throwIfAborted();
            this.cache.set(key, structuredClone(value));
            while (this.cache.size > Math.max(1, this.limit)) this.cache.delete(this.cache.keys().next().value!);
            return value;
        };
        for (let index = 0; index < Math.max(0, request.ply - 1); index++) playUci(position, request.moves[index]);
        const before = request.ply ? await evaluate(request.ply - 1) : undefined;
        if (request.ply) playUci(position, request.moves[request.ply - 1]);
        const after = await evaluate(request.ply);
        return { before, after, feedback: selected && before ? moveFeedback(selected, before, after) : undefined, fen: position.fen(), move: selected };
    }
}
