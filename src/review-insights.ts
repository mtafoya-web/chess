import { Chess } from 'chess.js';
import { playUci } from './chess';
import { colorName, pieceNames } from './piece-names';
import { reviewEvidence, formatEvidenceLine, type ReviewEvidence } from './review-evidence';
import type { ReviewCue } from './overlay-model';
import type { Evaluation } from './types';
import type { MoveFeedback, ReviewMove } from './review-types';

export type ReviewProblem = 'inaccuracy' | 'mistake' | 'blunder' | 'missed-mate';
export function reviewProblem(label?: string): ReviewProblem | undefined {
    const key = label?.toLowerCase().replaceAll(' ', '-');
    return key === 'inaccuracy' || key === 'mistake' || key === 'blunder' || key === 'missed-mate' ? key : undefined;
}
export const reviewLabel = (label?: string) => label === 'Best' || label === 'Excellent' ? 'Accurate' : label ?? 'Review';
export interface ReviewInsight {
    summary: string;
    playedDescription: string;
    gradeExplanation?: string;
    cues: ReviewCue[];
    evaluationNote?: string;
    consequence?: { square: string; label: string };
    alternative?: string;
    continuation?: string;
    evidence?: ReviewEvidence;
}
/** Critique only what legal replay and this local search establish. */
export function reviewInsight(move: ReviewMove, feedback: MoveFeedback, before: Evaluation | undefined, after: Evaluation): ReviewInsight {
    const board = new Chess(move.beforeFen), played = playUci(board, move.uci);
    if (board.fen() !== move.afterFen) throw new Error('Review position mismatch.');
    const side = colorName(played.color), problem = reviewProblem(feedback.label);
    const summary = feedback.label === 'Checkmate' ? `${side} delivered checkmate.`
        : !problem ? (played.captured ? `${side} captured ${played.isEnPassant() ? `a pawn en passant, moving to ${played.to.toUpperCase()}` : `${pieceNames[played.captured]} on ${played.to.toUpperCase()}`} without a major loss in this search.`
            : `${side}'s move stayed close to the previous evaluation in this search.`)
        : problem === 'missed-mate' ? `${side} missed a mating continuation found in the previous search.`
        : `${side}'s move was ${problem === 'inaccuracy' ? 'a small' : problem === 'mistake' ? 'a significant' : 'a major'} setback according to the engine.`;
    const meanings: Record<ReviewProblem, string> = {
        inaccuracy: 'Inaccuracy: a small setback in the engine comparison.',
        mistake: 'Mistake: a significant setback in the engine comparison.',
        blunder: 'Blunder: a major setback in the engine comparison.',
        'missed-mate': 'Missed mate: a missed chance to force checkmate, according to the engine.'
    };
    const playedDescription = `${side} moved the ${pieceNames[played.piece]} from ${played.from.toUpperCase()} to ${played.to.toUpperCase()}${played.promotion ? ` and promoted it to a ${pieceNames[played.promotion]}` : ''}.`;
    const result: ReviewInsight = { summary, playedDescription, cues: [], gradeExplanation: problem ? meanings[problem] : undefined };
    if (problem) result.cues.push(
        {square: played.from, kind: 'origin', grade: problem, label: `${played.from.toUpperCase()}: where ${side}'s ${pieceNames[played.piece]} moved from.`},
        {square: played.to, kind: 'destination', grade: problem, label: `${played.to.toUpperCase()}: where the ${played.promotion ? pieceNames[played.promotion] : pieceNames[played.piece]} moved to. The badge rates this played move.`}
    );
    if (!problem) return result;
    const evidence = reviewEvidence(move, before, after);
    result.evidence = evidence;
    const lineText = formatEvidenceLine(evidence.actual);
    if (lineText) result.continuation = `After the played move, ${colorName(new Chess(move.afterFen).turn())} to move. One searched continuation${evidence.actual.depth ? ` (depth ${evidence.actual.depth})` : ''}: ${lineText}${evidence.actual.unsettled ? ' The line stops with a legal recapture available; the exchange is unfinished.' : ''}`;
    else result.continuation = 'No legal searched continuation is available for this position.';
    const cause = evidence.causes[0];
    if (problem === 'missed-mate') result.summary = 'The engine found a way to force checkmate before this move, but not after it.';
    else if (cause) {
        result.summary = cause.text;
        if (cause.square) {
            const piece = new Chess(move.afterFen).get(cause.square);
            if (piece) result.consequence = {square: cause.square, label: `${cause.square.toUpperCase()}: the gold outline marks ${side}'s ${pieceNames[piece.type]}. ${cause.text}`};
        }
    } else if (evidence.existingTension.length && !evidence.actual.invalidTail && !evidence.actual.unsettled && evidence.actualMaterialChange >= 0) {
        const squares = evidence.existingTension.map(s => s.toUpperCase()).join(' and ');
        result.summary = `The searched line exchanges material on ${squares}, where tension already existed before this move, without a net material loss in the shown sequence. That exchange does not establish the reason for the engine's rating.`;
    } else {
        const first = evidence.actual.steps[0];
        result.summary = `${first ? `The searched reply is ${first.san} (${first.words}). ` : ''}The available lines do not establish a specific tactical or positional reason for this rating.`;
    }
    if (result.consequence) result.cues.push({ ...result.consequence, kind: 'consequence', grade: problem });
    if (feedback.lossCp !== undefined && feedback.lossCp > 0) result.evaluationNote = `The engine evaluation worsened by about ${(feedback.lossCp / 100).toFixed(2)} pawn units. This measures the position; it does not mean that many pawns were captured.`;
    const alternative = evidence.preferredLine && formatEvidenceLine(evidence.preferredLine);
    if (alternative) result.alternative = `Better alternative from the previous position (separate branch): ${alternative}`;

    return result;
}
