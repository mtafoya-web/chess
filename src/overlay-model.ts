import type { Candidate } from './types';
import { Chess } from 'chess.js';
export interface HeatCell {
    square: string; rank: number; ranks?: number[]; label: string;
    /** Evaluation in pawns, from White's perspective. */
    score: number; mate?: number;
    /** Pawn loss relative to best searched move; omitted for mate comparisons. */
    loss?: number;
}
export interface OverlayArrow { uci: string; kind: 'best' | 'alternative' | 'played'; rank?: number }
export interface MoveMarker {
    square: string;
    label: string;
    grade?: 'best' | 'excellent' | 'good' | 'inaccuracy' | 'mistake' | 'blunder' | 'missed-mate' | 'forced' | 'unknown';
}
export interface ReviewCue { square: string; kind: 'origin' | 'destination' | 'consequence'; grade: 'inaccuracy' | 'mistake' | 'blunder' | 'missed-mate'; label: string }
export interface OverlayLayers { heatmap?: HeatCell[]; arrows?: OverlayArrow[]; marker?: MoveMarker; reviewCues?: ReviewCue[] }
export type Orientation = 'white' | 'black';
export const validOverlayMove = (uci: string) => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci) && uci.slice(0, 2) !== uci.slice(2, 4);
export function candidateWhiteMate(candidate: Candidate): number | undefined {
    return candidate.engineScore?.kind === 'mate' ? (candidate.engineScore.winner === 'w' ? 1 : -1) * candidate.engineScore.moves : candidate.mate;
}
/** One ranking for headings, candidate lists and both overlay layers. */
export function rankedCandidates(candidates: Candidate[], turn: 'w' | 'b', fen?: string): Candidate[] {
    const sign = turn === 'w' ? 1 : -1;
    const strength = (c: Candidate) => c.engineScore?.kind === 'mate'
        ? (c.engineScore.winner === turn ? 1_000_000 - c.engineScore.moves : -1_000_000 + c.engineScore.moves)
        : c.mate === undefined ? c.score * sign : Math.sign(c.mate * sign || sign) * 1_000_000 - c.mate * sign;
    let legal: Set<string> | undefined;
    if (fen) {
        try { legal = new Set(new Chess(fen).moves({ verbose: true }).map(m => m.from + m.to + (m.promotion ?? ''))); }
        catch { return []; }
    }
    const seen = new Set<string>();
    return candidates.filter(c => {
        if (!validOverlayMove(c.uci) || !Number.isFinite(c.score) || c.mate !== undefined && !Number.isFinite(c.mate) || legal && !legal.has(c.uci) || seen.has(c.uci)) return false;
        seen.add(c.uci); return true;
    }).sort((a, b) => strength(b) - strength(a)).slice(0, 3);
}
export function candidateArrows(candidates: Candidate[], fen: string): OverlayArrow[] {
    try { return rankedCandidates(candidates, new Chess(fen).turn(), fen).map((c, i) => ({ uci: c.uci, rank: i + 1, kind: i ? 'alternative' : 'best' })); }
    catch { return []; }
}
/** Only searched destinations are represented. This does not measure square safety. */
export function candidateHeatmap(candidates: Candidate[], turn: 'w' | 'b'): HeatCell[] {
    const sign = turn === 'w' ? 1 : -1;
    const ranked = rankedCandidates(candidates, turn);
    const best = ranked[0], cells = new Map<string, HeatCell>();
    ranked.forEach((candidate, index) => {
        const square = candidate.uci.slice(2, 4);
        const mate = candidateWhiteMate(candidate);
        const loss = candidateWhiteMate(best) === undefined && mate === undefined ? Math.max(0, (best.score - candidate.score) * sign) : undefined;
        const evaluation = mate === undefined ? `${candidate.score >= 0 ? '+' : ''}${candidate.score.toFixed(2)}` : `${mate < 0 ? '-' : ''}M${Math.abs(mate)}`;
        const existing = cells.get(square);
        if (existing) { existing.ranks = [...(existing.ranks ?? [existing.rank]), index + 1]; existing.label += `; also #${index + 1} ${candidate.san}: ${evaluation}`; return; }
        cells.set(square, { square, rank: index + 1, score: candidate.score, ...(mate === undefined ? {} : { mate }),
            ...(loss === undefined ? {} : { loss }), label: `#${index + 1} ${candidate.san}: ${evaluation} (White's perspective)${loss === undefined ? '' : `; ${loss.toFixed(2)} pawn loss versus best searched move`}` });
    });
    return [...cells.values()];
}
/** Coordinates in the overlay's 800 × 800 viewBox. */
export function squareCenter(square: string, orientation: Orientation): [number, number] | undefined {
    if (!/^[a-h][1-8]$/.test(square)) return;
    let file = square.charCodeAt(0) - 97, row = 8 - Number(square[1]);
    if (orientation === 'black') { file = 7 - file; row = 7 - row; }
    return [file * 100 + 50, row * 100 + 50];
}
