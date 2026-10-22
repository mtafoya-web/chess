import type { Evaluation } from './types';
import type { MoveFeedback, ReviewMove } from './review-types';

/** All engine scores are from White's perspective, independent of board orientation. */
export function moveFeedback(move: ReviewMove, before: Evaluation, after: Evaluation): MoveFeedback {
    const best = before.candidates[0];
    const base = { bestMove: best?.uci };
    const first = before.engineScore;
    const last = after.engineScore;
    const winner = (value: Evaluation['engineScore']) => value?.kind === 'mate' || value?.kind === 'terminal' ? value.winner : undefined;
    const previousWinner = winner(first), nextWinner = winner(last);
    if (last?.kind === 'terminal' && last.winner === move.color) return { ...base, label: 'Checkmate', summary: `${move.san} delivers checkmate.` };
    if (nextWinner && nextWinner !== move.color && previousWinner !== nextWinner) return { ...base, label: 'Blunder', summary: `${move.san} allows a forced mate. ${best ? `Stockfish preferred ${best.san}.` : ''}`.trim() };
    if (previousWinner === move.color && nextWinner !== move.color) return { ...base, label: 'Missed mate', summary: `${move.san} no longer has a forced mate in this search. ${best ? `Stockfish preferred ${best.san}.` : ''}`.trim() };
    if (nextWinner === move.color) return { ...base, label: best?.uci === move.uci ? 'Best' : 'Good', summary: `${move.san} ${previousWinner === move.color ? 'keeps' : 'finds'} a forced mate.` };
    if (previousWinner && !nextWinner) return { ...base, label: 'Good', summary: `${move.san} escapes the forced mate found in the previous search.` };
    if (nextWinner) return { ...base, label: best?.uci === move.uci ? 'Best' : 'Review', summary: `Stockfish still finds a forced mate against ${move.color === 'w' ? 'White' : 'Black'} after ${move.san}.` };
    const cp = (result: Evaluation) => result.engineScore?.kind === 'cp' ? result.engineScore.value : result.engineScore?.kind === 'terminal' ? 0 : Math.round(result.whiteScore * 100);
    const lossCp = Math.max(0, Math.round((cp(before) - cp(after)) * (move.color === 'w' ? 1 : -1)));
    const label = best?.uci === move.uci ? 'Best' : lossCp <= 20 ? 'Excellent' : lossCp <= 50 ? 'Good' : lossCp <= 100 ? 'Inaccuracy' : lossCp <= 200 ? 'Mistake' : 'Blunder';
    const outcome = after.terminal ? ` The position is ${after.terminal.toLowerCase()}.` : '';
    const alternative = best && best.uci !== move.uci ? ` Stockfish preferred ${best.san}.` : '';
    return { ...base, label, lossCp, summary: `${move.san}: ${label.toLowerCase()}. ${lossCp ? `About ${(lossCp / 100).toFixed(2)} pawns lost in this search.` : 'Keeps roughly the same evaluation.'}${alternative}${outcome}` };
}
