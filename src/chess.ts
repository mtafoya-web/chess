import { Chess, validateFen } from 'chess.js';
import type { Candidate, Evaluation } from './types';

export function normalizedFen(fen: string): string {
    if (fen.trim().split(/\s+/).length !== 6 || !validateFen(fen).ok) throw new Error('A complete, valid six-field FEN is required.');
    return new Chess(fen).fen();
}
export function replay(moves: string[], initial?: string): string {
    const chess = new Chess(initial ? normalizedFen(initial) : undefined);
    for (const move of moves) chess.move(move);
    return chess.fen();
}
export function playUci(chess: Chess, uci: string) {
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) throw new Error('Invalid engine move');
    return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
}
export function candidateFrom(line: string, fen: string): { rank: number; candidate: Candidate } | undefined {
    if (/\b(?:lowerbound|upperbound)\b/.test(line)) return;
    const score = /\bscore (cp|mate) (-?\d+)/.exec(line);
    const pv = /\bpv (.+)$/.exec(line);
    if (!score || !pv) return;
    const chess = new Chess(fen);
    const sign = chess.turn() === 'w' ? 1 : -1;
    try {
        const moves = pv[1].trim().split(/\s+/);
        const uciPv = moves.slice(0, 10);
        const san = uciPv.map(m => playUci(chess, m).san);
        const value = Number(score[2]) * sign;
        return { rank: Number(/\bmultipv (\d+)/.exec(line)?.[1] ?? 1), candidate: {
            uci: moves[0], san: san[0], pv: san.join(' '),
            score: score[1] === 'cp' ? value / 100 : Math.sign(value || sign) * 100,
            ...(score[1] === 'mate' ? { mate: value } : {}),
            uciPv, sanPv: san, depth: Number(/\bdepth (\d+)/.exec(line)?.[1] ?? 0),
            engineScore: score[1] === 'cp' ? { kind: 'cp', value } : { kind: 'mate', winner: value > 0 ? 'w' : value < 0 ? 'b' : sign < 0 ? 'w' : 'b', moves: Math.abs(Number(score[2])) },
        } };
    } catch { return; }
}
export function evaluation(candidates: Candidate[], terminal?: string, terminalScore?: Evaluation['engineScore']): Evaluation {
    const top = candidates[0];
    return { candidates, terminal, engineScore: terminalScore ?? top?.engineScore, depth: top?.depth, bestMove: top?.uci ?? '', pvLines: candidates.map(c => c.pv),
        promisingMoves: candidates.slice(1).map(c => c.uci), whiteScore: top?.score ?? 0,
        evaluation: top?.mate !== undefined ? `${top.mate < 0 ? '−' : ''}M${Math.abs(top.mate)}` : `${(top?.score ?? 0) >= 0 ? '+' : ''}${(top?.score ?? 0).toFixed(2)}` };
}
export function positionEvaluation(chess: Chess): Evaluation | undefined {
    if (chess.isCheckmate()) {
        const winner = chess.turn() === 'w' ? 'b' : 'w';
        return { ...evaluation([], 'Checkmate', { kind: 'terminal', winner }), whiteScore: winner === 'w' ? 100 : -100, evaluation: winner === 'w' ? '1–0' : '0–1' };
    }
    const terminal = chess.isStalemate() ? 'Stalemate' : chess.isThreefoldRepetition() ? 'Threefold repetition' : chess.isDraw() ? 'Draw' : undefined;
    return terminal ? evaluation([], terminal, { kind: 'terminal' }) : undefined;
}
export function terminalPosition(fen: string): string | undefined {
    const chess = new Chess(fen);
    if (chess.isCheckmate()) return 'Checkmate';
    if (chess.isStalemate()) return 'Stalemate';
    if (chess.isDraw()) return 'Draw';
}
