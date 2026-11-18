import type { Evaluation } from './types';

/** Kibitz v2: Lichess-inspired chances, not a prediction of an individual's result. */
export const SCORING_VERSION = 2;
export const SEARCH_PROFILES = {
    quick: { id: 'stockfish-17.1-lite:300:1:v2', movetime: 300, multiPV: 1 },
    standard: { id: 'stockfish-17.1-lite:1500:3:v2', movetime: 1500, multiPV: 3 },
    confirm: { id: 'stockfish-17.1-lite:5000:3:v2', movetime: 5000, multiPV: 3 },
} as const;
export type SearchProfile = keyof typeof SEARCH_PROFILES;
export type LearningLevel = 'beginner' | 'intermediate' | 'advanced';
export type ReviewSide = 'w' | 'b' | 'both';
export interface ReviewPreferences { level: LearningLevel; side: ReviewSide; visuals: boolean }
export const DEFAULT_REVIEW_PREFERENCES: ReviewPreferences = { level: 'beginner', side: 'both', visuals: true };
export function validPreferences(value: unknown): value is ReviewPreferences {
    const p = value as ReviewPreferences | undefined;
    return !!p && ['beginner', 'intermediate', 'advanced'].includes(p.level) && ['w', 'b', 'both'].includes(p.side) && typeof p.visuals === 'boolean';
}
export function winPercent(cp: number): number {
    return 100 / (1 + Math.exp(-0.00368208 * Math.max(-1000, Math.min(1000, cp))));
}
export function scoreCp(result: Evaluation): number {
    const score = result.engineScore;
    return score?.kind === 'cp' ? score.value : score?.kind === 'mate' || score?.kind === 'terminal'
        ? score.winner === 'w' ? 1000 : score.winner === 'b' ? -1000 : 0 : result.whiteScore * 100;
}
export function chanceLoss(before: Evaluation, after: Evaluation, side: 'w' | 'b'): number {
    return Math.max(0, (winPercent(scoreCp(before)) - winPercent(scoreCp(after))) * (side === 'w' ? 1 : -1));
}
export function moveAccuracy(loss: number): number {
    return loss <= 0 ? 100 : Math.max(0, Math.min(100, 103.1668100711649 * Math.exp(-0.04354415386753951 * loss) - 3.166924740191411 + 1));
}
/** Mean of volatility-weighted and harmonic move accuracy, using actual initial eval. */
export function gameAccuracy(points: { cp: number; color?: 'w' | 'b' }[], side: 'w' | 'b'): number | undefined {
    if (points.length < 2) return;
    const wins = points.map(p => winPercent(p.cp)), size = Math.max(2, Math.min(8, Math.floor((points.length - 1) / 10)));
    const samples: { value: number; weight: number }[] = [];
    for (let i = 1; i < points.length; i++) {
        if (points[i].color !== side) continue;
        const window = wins.slice(Math.max(0, i - size + 1), Math.max(size, i + 1));
        const mean = window.reduce((a, b) => a + b, 0) / window.length;
        const weight = Math.max(0.5, Math.min(12, Math.sqrt(window.reduce((a, b) => a + (b - mean) ** 2, 0) / window.length)));
        samples.push({ value: moveAccuracy(Math.max(0, (wins[i - 1] - wins[i]) * (side === 'w' ? 1 : -1))), weight });
    }
    if (!samples.length) return;
    const weighted = samples.reduce((n, p) => n + p.value * p.weight, 0) / samples.reduce((n, p) => n + p.weight, 0);
    const harmonic = samples.some(p => p.value === 0) ? 0 : samples.length / samples.reduce((n, p) => n + 1 / p.value, 0);
    return (weighted + harmonic) / 2;
}
