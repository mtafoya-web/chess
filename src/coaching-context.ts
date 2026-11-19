import { Chess } from 'chess.js';
import { playUci } from './chess';
import type { BoardContext } from './board-context';
import type { Evaluation } from './types';
import type { LearningLevel } from './review-scoring';

export interface CoachingBranch {
    id: 'played' | 'preferred' | 'alternative' | 'alternative-2'; rootFen: string; depth?: number;
    evaluation?: Evaluation['engineScore']; whiteScore?: number;
    invalidTail: boolean; truncated: boolean; unsettled: boolean;
    steps: { id: string; uci: string; san: string; color: 'w' | 'b'; piece: string; from: string; to: string; captured?: string; check: boolean; mate: boolean }[];
}
export interface CoachingContext {
    version: 1; level: LearningLevel; mode: 'review' | 'analysis'; fen: string;
    beforeFen?: string; playedMove?: string; preferredMove?: string;
    selectedMove?: { uci: string; san: string; piece: 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen' | 'king'; from: string; to: string; captured?: string; promotion?: string; castle?: 'king' | 'queen' };
    assessment?: { label?: string; lossCp?: number; provisional?: boolean; beforeWhite?: number; afterWhite?: number; beforeScore?: Evaluation['engineScore']; afterScore?: Evaluation['engineScore']; moverDeltaCp?: number };
    branches: CoachingBranch[];
}

function branch(id: CoachingBranch['id'], fen: string, evaluation: Evaluation, prefix: string[] = []): CoachingBranch | undefined {
    const candidate = evaluation.candidates.find(c => c.uci === evaluation.bestMove);
    const raw = candidate?.uciPv?.length ? candidate.uciPv : evaluation.bestMove ? [evaluation.bestMove] : [];
    const moves = [...prefix, ...raw], board = new Chess(fen);
    const value: CoachingBranch = { id, rootFen: fen, depth: candidate?.depth ?? evaluation.depth,
        evaluation: evaluation.engineScore, whiteScore: !evaluation.engineScore || evaluation.engineScore.kind === 'cp' ? evaluation.whiteScore : undefined,
        invalidTail: false, truncated: moves.length > 8, unsettled: false, steps: [] };
    for (const uci of moves.slice(0, 8)) {
        try {
            const move = playUci(board, uci);
            value.steps.push({ id: `${id}:${value.steps.length}`, uci, san: move.san, color: move.color,
                piece: move.piece, from: move.from, to: move.to, captured: move.captured, check: board.isCheck(), mate: board.isCheckmate() });
        } catch { value.invalidTail = true; break; }
    }
    const last = value.steps.at(-1);
    value.unsettled = !!last?.captured && board.moves({ verbose: true }).some(m => m.captured && m.to === last.to);
    return value.steps.length ? value : undefined;
}

/** A bounded comparison, reconstructed from legal moves rather than model memory. */
export function coachingContext(context: BoardContext, result: Evaluation, review?: {
    level?: LearningLevel; mode?: 'analysis' | 'review'; before?: Evaluation; label?: string; lossCp?: number; provisional?: boolean;
}): CoachingContext {
    const played = review?.mode === 'analysis' ? undefined : context.played;
    const root = played?.beforeFen ?? context.fen, before = played ? review?.before : result;
    const branches: CoachingBranch[] = [];
    const add = (value: CoachingBranch | undefined) => { if (value) branches.push(value); };
    if (played) add(branch('played', root, result, [played.uci]));
    if (before?.bestMove && before.bestMove !== played?.uci) add(branch('preferred', root, before));
    const used = new Set(branches.map(b => b.steps[0]?.uci));
    for (const candidate of before?.candidates ?? []) {
        if (branches.length >= 3 || used.has(candidate.uci)) continue;
        const id = !branches.some(b => b.id === 'preferred') ? 'preferred' : !branches.some(b => b.id === 'alternative') ? 'alternative' : 'alternative-2';
        add(branch(id, root, {
            ...before!, bestMove: candidate.uci, whiteScore: candidate.score, engineScore: candidate.engineScore,
        }));
        used.add(candidate.uci);
    }
    const cp = (value: Evaluation) => !value.engineScore || value.engineScore.kind === 'cp';
    let selectedMove: CoachingContext['selectedMove'];
    if (played) {
        const board = new Chess(played.beforeFen);
        const move = playUci(board, played.uci);
        const pieceNames = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' } as const;
        selectedMove = {
            uci: played.uci, san: move.san, piece: pieceNames[move.piece],
            from: move.from.toUpperCase(), to: move.to.toUpperCase(),
            captured: move.captured ? pieceNames[move.captured] : undefined,
            promotion: move.promotion ? pieceNames[move.promotion] : undefined,
            castle: move.isKingsideCastle() ? 'king' : move.isQueensideCastle() ? 'queen' : undefined,
        };
    }
    return { version: 1, level: review?.level ?? 'beginner', mode: played ? 'review' : 'analysis', fen: context.fen,
        beforeFen: played?.beforeFen, playedMove: played?.uci, preferredMove: before?.bestMove, selectedMove,
        assessment: { label: review?.label, lossCp: cp(result) && (!review?.before || cp(review.before)) ? review?.lossCp : undefined, provisional: review?.provisional,
            beforeWhite: review?.before && cp(review.before) ? review.before.whiteScore : undefined, afterWhite: cp(result) ? result.whiteScore : undefined,
            beforeScore: review?.before?.engineScore, afterScore: result.engineScore,
            moverDeltaCp: played && review?.before && cp(review.before) && cp(result)
                ? Math.round((result.whiteScore - review.before.whiteScore) * (played.color === 'w' ? 1 : -1) * 100) : undefined }, branches };
}
