import {reviewProgress, canCoach, type ReviewPhase} from './review-progress';
import type { ReviewRunStatus } from './review-coordinator';
import { Chess } from 'chess.js';
import { playUci } from './chess';
import { reviewInsight, reviewProblem } from './review-insights';
import { positionalFacts } from './positional-facts';
import { DEFAULT_REVIEW_PREFERENCES, gameAccuracy, scoreCp, type ReviewPreferences } from './review-scoring';
import type { MoveAssessment, ReviewMove, ReviewSession } from './review-types';

export interface ReviewLesson { id: string; title: string; text: string; ply: number }
export interface PracticeRecord { ply: number; outcome: 'solved' | 'hinted' | 'revealed' | 'skipped' | 'missed'; at: number }
export interface ReviewState { session: ReviewSession; assessments: MoveAssessment[]; preferences: ReviewPreferences; running: boolean; phase?: ReviewPhase; runStatus?: ReviewRunStatus; runError?: string; active?: boolean; practicePly?: number; updatedAt: number; attempts: PracticeRecord[] }
export interface GameReviewSummary { phase: ReviewPhase; estimated: boolean; scanned: number; checked: number; checks: number; progressText: string; analyzed: number; total: number; complete: boolean; provisional: boolean; accuracy: { w?: number; b?: number }; counts: Record<'w' | 'b', Record<string, number>>; moments: number[]; lessons: ReviewLesson[]; points: { ply: number; cp: number; provisional: boolean }[] }
const lessons: Record<string, [string, string]> = {
    mate: ['King safety', 'Before making a quiet move, check the opponent’s forcing checks.'],
    material: ['Exchanges and recaptures', 'Count legal captures and recaptures before committing to an exchange.'],
    'central-support': ['Central tension', 'Compare your ways to recapture before making a move away from the center.'],
    'development-space': ['Development', 'Look for developing moves that keep useful squares available.'],
    'king-lines': ['Checking lines', 'Check which lines toward the king change when a pawn or piece moves.'],
    fork: ['Forks', 'Look for moves that attack two valuable targets at once.'],
    pin: ['Pinned defenders', 'Check whether a defender can legally move before counting it as a recapturer.'],
    calculation: ['Compare forcing replies', 'Compare checks, captures, and threats before choosing your move.'],
};
const insightCache = new WeakMap<MoveAssessment, ReturnType<typeof reviewInsight>>();
export function assessmentInsight(move: ReviewMove, assessment: MoveAssessment) {
    let insight = insightCache.get(assessment);
    if (!insight && assessment.feedback && canCoach(assessment)) {
        insight = reviewInsight(move, assessment.feedback, assessment.before, assessment.after);
        insightCache.set(assessment, insight);
    }
    return insight;
}
export function lessonFor(move: ReviewMove, assessment: MoveAssessment): ReviewLesson | undefined {
    if (!canCoach(assessment) || !assessment.feedback || !reviewProblem(assessment.feedback.label)) return;
    const cause = assessmentInsight(move, assessment)?.evidence?.causes[0];
    const id = assessment.feedback.label === 'Missed mate' ? 'mate' : cause?.motif ?? cause?.kind ?? 'calculation';
    const [title, text] = lessons[id] ?? lessons.calculation;
    return { id, title, text, ply: move.ply };
}
export function coachingText(move: ReviewMove, assessment: MoveAssessment, preferences = DEFAULT_REVIEW_PREFERENCES, session?: ReviewSession): string {
    if (assessment.profile === 'quick') return `Quick estimate: ${assessment.feedback?.summary ?? 'Position scanned.'}${assessment.refinement==='pending'?' A deeper check is queued.':''}`;
    if (assessment.feedback?.provisional) return 'The engine searches disagree about this move. The assessment is provisional; try a deeper analysis before drawing a lesson.';
    const insight = assessmentInsight(move, assessment);
    if (reviewProblem(assessment.feedback?.label)) {
        const lesson = lessonFor(move, assessment);
        if (preferences.level === 'advanced') {
            const line=insight?.evidence?.actual;
            return `${move.san}: ${insight?.summary ?? assessment.feedback?.summary}${line?.steps.length ? ` Searched line${line.depth ? ` (depth ${line.depth})` : ''}: ${line.steps.slice(0,6).map(s=>s.san).join(' ')}.` : ''}`;
        }
        return [insight?.summary, preferences.level === 'beginner' ? lesson?.text : undefined].filter(Boolean).join(' ');
    }
    const board = new Chess(move.beforeFen), played = playUci(board, move.uci);
    const side = move.color === 'w' ? 'White' : 'Black';
    if (board.isCheckmate()) return `${side} delivered checkmate.`;
    if (played.isKingsideCastle() || played.isQueensideCastle()) return `${side} castled, moving the king and bringing the rook into play, while keeping the evaluation close to the engine’s preference.`;
    if (played.captured) return insight?.summary ?? `${side} made a sound capture in this search.`;
    if (board.isCheck()) return `${side} gave check while keeping the evaluation close to the engine’s preference. The opponent must answer the check.`;
    if (session) {
        const fact = positionalFacts(move.beforeFen,move.uci,'played','after:played',{sessionId:session.id,initialFen:session.initialFen,moves:session.moves.map(m=>m.uci),ply:move.ply-1}).find(f=>f.kind==='development');
        if (fact) return `${fact.effect} ${preferences.level==='beginner'?fact.benefit:'The move stays close to the engine evaluation.'}`;
    }
    return insight?.summary ?? assessment.feedback?.summary ?? 'This position is ready to review.';
}
export function summarizeReview(state: ReviewState): GameReviewSummary {
    const { session, preferences } = state;
    const progress = reviewProgress(session.moves.length,state.assessments);
    const assessments = new Map(state.assessments.map(a => [a.ply, a]));
    const analyzed = progress.scanned;
    const counts: GameReviewSummary['counts'] = { w: {}, b: {} };
    const points: GameReviewSummary['points'] = [];
    const initial = assessments.get(0)?.after ?? assessments.get(1)?.before;
    if (initial) points.push({ ply: 0, cp: scoreCp(initial), provisional: false });
    const candidates: { ply: number; priority: number; lesson?: ReviewLesson; positive: boolean }[] = [];
    for (const move of session.moves) {
        const a = assessments.get(move.ply); if (!a) continue;
        points.push({ ply: move.ply, cp: scoreCp(a.after), provisional: !!a.feedback?.provisional });
        const label = a.feedback?.label ?? 'Review'; counts[move.color][label] = (counts[move.color][label] ?? 0) + 1;
        if (preferences.side !== 'both' && move.color !== preferences.side || !canCoach(a)) continue;
        const lesson = lessonFor(move, a);
        if (lesson) candidates.push({ ply: move.ply, priority: (lesson.id === 'mate' ? 1000 : 100) + (a.feedback?.lossWinPercent ?? a.feedback?.lossCp ?? 0), lesson, positive: false });
        else if (['Best', 'Excellent', 'Checkmate'].includes(label)) {
            const board = new Chess(move.beforeFen), played = playUci(board, move.uci);
            if (board.isCheckmate() || played.captured || played.isKingsideCastle() || played.isQueensideCastle()) candidates.push({ ply: move.ply, priority: label === 'Checkmate' ? 90 : 10, positive: true });
        }
    }
    const chosen: typeof candidates = []; let positive = 0;
    for (const candidate of candidates.sort((a, b) => b.priority - a.priority || a.ply - b.ply)) {
        if (chosen.length === 8 || candidate.positive && positive >= 2) continue;
        if (candidate.lesson && chosen.some(c => c.lesson?.id === candidate.lesson!.id && Math.abs(c.ply - candidate.ply) <= 2)) continue;
        chosen.push(candidate); if (candidate.positive) positive++;
    }
    const complete = progress.complete;
    const provisional = !complete || state.assessments.some(a => a.feedback?.provisional);
    const contiguous = initial && session.moves.every(m => assessments.has(m.ply));
    const trajectory = contiguous ? [{ cp: scoreCp(initial!) }, ...session.moves.map(m => ({ cp: scoreCp(assessments.get(m.ply)!.after), color: m.color }))] : [];
    const takeaways: ReviewLesson[] = [];
    for (const c of chosen) if (c.lesson && !takeaways.some(l => l.id === c.lesson!.id) && takeaways.length < 3) takeaways.push(c.lesson);
    return {phase:progress.phase,estimated:progress.estimated,scanned:progress.scanned,checked:progress.checked,checks:progress.checks,progressText:progress.text, analyzed, total: session.moves.length, complete, provisional, accuracy: { w: gameAccuracy(trajectory, 'w'), b: gameAccuracy(trajectory, 'b') }, counts, points, moments: chosen.map(c => c.ply).sort((a, b) => a - b), lessons: takeaways };
}
export function reviewFingerprint(session: ReviewSession): string {
    const text = session.initialFen + '|' + session.moves.map(m => m.uci).join(' ');
    let a = 2166136261, b = 5381;
    for (let i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ text.charCodeAt(i); }
    return `v2-${(a >>> 0).toString(16)}-${(b >>> 0).toString(16)}`;
}
export function matchingGame(a: ReviewSession, b: ReviewSession) {
    return a.initialFen === b.initialFen && a.moves.length === b.moves.length && a.moves.every((m, i) => m.uci === b.moves[i].uci);
}
