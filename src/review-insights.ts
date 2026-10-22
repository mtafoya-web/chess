import { Chess } from 'chess.js';
import { playUci } from './chess';
import { colorName, pieceNames } from './piece-names';
import { readableMove } from './readable-move';
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
    consequence?: { square: string; label: string };
    alternative?: string;
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
        : `${side}'s move ${problem === 'inaccuracy' ? 'gave up some of the position’s evaluated strength' : 'worsened the position in this search'}.`;
    const result: ReviewInsight = { summary };
    if (!problem) return result;
    const candidate = after.candidates.find(c => c.uci === after.bestMove);
    const line = candidate?.uciPv?.length ? candidate.uciPv : after.bestMove ? [after.bestMove] : [];
    // Track a searched victim back to its square in the board currently displayed.
    const origins = new Map<string, string>();
    for (const piece of board.board().flat()) if (piece) origins.set(piece.square, piece.square);
    for (const [index, uci] of line.slice(0, 4).entries()) {
        let reply;
        try { reply = playUci(board, uci); } catch { break; }
        const capturedSquare = reply.isEnPassant() ? `${reply.to[0]}${reply.from[1]}` : reply.to;
        const victimOrigin = origins.get(capturedSquare);
        if (reply.color !== played.color && reply.captured && victimOrigin) {
            const target = reply.isEnPassant() ? `${side}'s pawn from ${capturedSquare.toUpperCase()} en passant on ${reply.to.toUpperCase()}` : `${side}'s ${pieceNames[reply.captured]} on ${reply.to.toUpperCase()}`;
            const effect = `${colorName(reply.color)}'s ${pieceNames[reply.piece]} ${index === 0 ? 'can capture' : 'captures'} ${target}`;
            result.summary = `${index === 0 ? 'After this move, ' : 'In one searched continuation, '}${effect}.`;
            result.consequence = { square: victimOrigin, label: `${side}'s piece on ${victimOrigin.toUpperCase()} is captured in this searched continuation.` };
            break;
        }
        const origin = origins.get(reply.from);
        origins.delete(reply.from); origins.delete(capturedSquare);
        if (origin) origins.set(reply.to, origin);
        // Castling moves two pieces; preserve the rook's identity as well.
        if (reply.isKingsideCastle() || reply.isQueensideCastle()) {
            const from = `${reply.isKingsideCastle() ? 'h' : 'a'}${reply.from[1]}`, to = `${reply.isKingsideCastle() ? 'f' : 'd'}${reply.from[1]}`;
            const rook = origins.get(from); origins.delete(from); if (rook) origins.set(to, rook);
        }
        if (reply.color !== played.color && board.isCheck()) {
            const king = board.board().flat().find(p => p?.color === played.color && p.type === 'k');
            const current = king && origins.get(king.square);
            if (current) result.consequence = { square: current, label: `${side}'s king faces ${board.isCheckmate() ? 'checkmate' : 'check'} in this searched continuation.` };
            result.summary = `${index === 0 ? 'After this move, ' : 'In one searched continuation, '}${colorName(reply.color)} ${board.isCheckmate() ? 'delivers checkmate' : 'gives check'} with the ${pieceNames[reply.piece]} on ${reply.to.toUpperCase()}.`;
            break;
        }
    }
    if (problem === 'missed-mate') result.summary = `The previous search found a mating continuation, but this move no longer keeps it.`;
    if (feedback.lossCp !== undefined && feedback.lossCp > 0) result.summary += ` The estimated loss is ${(feedback.lossCp / 100).toFixed(2)} pawns.`;
    if (before?.bestMove && before.bestMove !== move.uci) {
        try {
            const alternative = new Chess(move.beforeFen), preferred = before.candidates.find(c => c.uci === before.bestMove);
            const moves = preferred?.uciPv?.length ? preferred.uciPv : [before.bestMove];
            const named: string[] = [];
            for (const uci of moves.slice(0, 3)) { const label = readableMove(alternative.fen(), uci); const step=playUci(alternative,uci); named.push(`${colorName(step.color)}: ${label}`); }
            result.alternative = `Better alternative from the previous position: ${named[0]}. ${named.length > 1 ? `One possible continuation: ${named.slice(1).join('; ')}.` : ''}`.trim();
        } catch { /* An invalid search line is not evidence for an alternative. */ }
    }
    return result;
}
