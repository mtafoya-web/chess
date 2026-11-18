import { Chess } from 'chess.js';
import { normalizedFen, playUci, positionEvaluation } from './chess';
import { moveFeedback } from './move-feedback';
import type { Evaluation } from './types';
import type { MoveFeedback, ReviewMove, ReviewRequest, MoveAssessment } from './review-types';
import { SEARCH_PROFILES, type SearchProfile } from './review-scoring';

interface Analyzer { analyze(fen: string, signal: AbortSignal, history?: { initialFen: string; moves: string[] }, profile?: SearchProfile): Promise<Evaluation> }
export interface ReviewAnalysis extends Pick<MoveAssessment,'profile'|'refinement'> { before?: Evaluation; after: Evaluation; feedback?: MoveFeedback; fen: string; move?: ReviewMove }

function validateShape(request: ReviewRequest) {
    if (!request || typeof request.sessionId !== 'string' || !request.sessionId || request.sessionId.length > 200 || typeof request.requestId !== 'string' || !request.requestId || request.requestId.length > 200 || typeof request.initialFen !== 'string' || request.initialFen.length > 200 || !Array.isArray(request.moves) || request.moves.length > 2000 || request.moves.some(move => typeof move !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)) || !Number.isInteger(request.ply) || request.ply < 0 || request.ply > request.moves.length || request.ai !== undefined && typeof request.ai !== 'boolean') throw new Error('Invalid review request.');
    if (request.moves.length > 1500 || request.profile !== undefined && !Object.hasOwn(SEARCH_PROFILES, request.profile) || request.background !== undefined && typeof request.background !== 'boolean' || request.attempt !== undefined && (request.ply === 0 || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(request.attempt))) throw new Error('Invalid review request.');
    if (request.level !== undefined && !['beginner','intermediate','advanced'].includes(request.level)) throw new Error('Invalid review request.');
}

function replayReview(start: string, moves: readonly string[]) {
    const initialFen = normalizedFen(start);
    const chess = new Chess(initialFen);
    const played: ReviewMove[] = [], positions = [initialFen];
    for (let index = 0; index < moves.length; index++) {
        // Repetition and fifty-move draws require a claim; a real game can continue.
        if (chess.isCheckmate() || chess.isStalemate() || chess.isInsufficientMaterial()) throw new Error('Review contains moves after the game ended.');
        const beforeFen = chess.fen();
        const move = playUci(chess, moves[index]);
        const afterFen = chess.fen();
        played.push({ply:index+1,uci:moves[index],san:move.san,color:move.color,beforeFen,afterFen}); positions.push(afterFen);
    }
    return {initialFen,played,positions};
}

export function validateReview(request: ReviewRequest) {
    validateShape(request);
    const game = replayReview(request.initialFen,request.moves);
    return {initialFen:game.initialFen,selected:game.played[request.ply-1]};
}

/** Bounded per-offscreen cache. Full history protects repetition-sensitive positions. */
export class ReviewAnalyzer {
    private cache = new Map<string, Evaluation>();
    private replay?: {key:string;game:ReturnType<typeof replayReview>};
    constructor(private engine: Analyzer, private limit = 512) {}
    async analyze(request: ReviewRequest, signal: AbortSignal, onPreliminary?: (result: ReviewAnalysis) => void): Promise<ReviewAnalysis> {
        signal.throwIfAborted();
        validateShape(request);
        const replayKey = JSON.stringify([request.sessionId,request.initialFen,request.moves]);
        if (this.replay?.key !== replayKey) this.replay = {key:replayKey,game:replayReview(request.initialFen,request.moves)};
        let game = this.replay.game;
        if (request.attempt) {
            request = {...request,moves:[...request.moves.slice(0,request.ply-1),request.attempt],profile:'confirm',attempt:undefined};
            // Practice uses a separate branch and never replaces the mainline replay.
            game = replayReview(request.initialFen,request.moves);
        }
        const {initialFen} = game, selected = game.played[request.ply-1];
        const profile = request.profile ?? 'standard';
        const evaluate = async (ply: number, profile: SearchProfile = request.profile ?? 'standard') => {
            signal.throwIfAborted();
            const key = JSON.stringify([SEARCH_PROFILES[profile].id, initialFen, request.moves.slice(0, ply)]);
            const cached = this.cache.get(key);
            if (cached) { this.cache.delete(key); this.cache.set(key, cached); return structuredClone(cached); }
            const fen = game.positions[ply];
            const value = positionEvaluation(new Chess(fen)) ?? await this.engine.analyze(fen, signal, { initialFen, moves: request.moves.slice(0, ply) }, profile);
            signal.throwIfAborted();
            this.cache.set(key, structuredClone(value));
            while (this.cache.size > Math.max(1, this.limit)) this.cache.delete(this.cache.keys().next().value!);
            return value;
        };
        let before = request.ply ? await evaluate(request.ply-1) : undefined;
        let after = await evaluate(request.ply);
        let feedback = selected && before ? moveFeedback(selected, before, after) : undefined;
        const loss = feedback?.lossWinPercent;
        const needsConfirmation = feedback && (feedback.provisional || ['Mistake', 'Blunder', 'Missed mate'].includes(feedback.label) || before?.engineScore?.kind === 'mate' || after.engineScore?.kind === 'mate' || loss !== undefined && [2, 5, 10, 20].some(boundary => Math.abs(boundary - loss) <= 1));
        if (profile === 'quick') {
            const refine = !!feedback && (!!needsConfirmation || feedback.label === 'Inaccuracy' || after.engineScore?.kind === 'terminal' && !!after.engineScore.winner);
            if (feedback && refine) feedback = {...feedback,provisional:true};
            return {before,after,feedback,fen:game.positions[request.ply],move:selected,profile,refinement:refine?'pending':undefined};
        }
        if (selected && before && needsConfirmation && request.profile !== 'confirm') {
            const previous = feedback!;
            const confirmedCached = [request.ply-1,request.ply].every(ply=>this.cache.has(JSON.stringify([SEARCH_PROFILES.confirm.id,initialFen,request.moves.slice(0,ply)])));
            if (!confirmedCached) onPreliminary?.({before,after,feedback:{...previous,provisional:true,summary:'Preliminary assessment. Stockfish is running a deeper comparison.'},fen:game.positions[request.ply],move:selected,profile,refinement:'pending'});
            const oldMate = JSON.stringify([before.engineScore?.kind === 'mate' ? before.engineScore.winner : undefined, after.engineScore?.kind === 'mate' ? after.engineScore.winner : undefined]);
            before = await evaluate(request.ply-1,'confirm');
            after = await evaluate(request.ply,'confirm');
            feedback = { ...moveFeedback(selected, before, after), confirmed: true };
            const newMate = JSON.stringify([before.engineScore?.kind === 'mate' ? before.engineScore.winner : undefined, after.engineScore?.kind === 'mate' ? after.engineScore.winner : undefined]);
            feedback.provisional ||= previous.label !== feedback.label || oldMate !== newMate;
        }
        if (feedback && request.profile === 'confirm') feedback.confirmed = true;
        return {before,after,feedback,fen:game.positions[request.ply],move:selected,profile,refinement:'done'};
    }
}
