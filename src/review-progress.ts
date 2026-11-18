import type { MoveAssessment } from './review-types';

export type ReviewPhase = 'overview' | 'refinement' | 'complete';
export function reviewProgress(total: number, assessments: readonly MoveAssessment[]) {
    const positions = new Map(assessments.filter(a => a.ply > 0 && a.ply <= total).map(a => [a.ply,a]));
    const values = [...positions.values()];
    const remaining = values.filter(a => a.refinement === 'pending' || a.pendingConfirmation);
    const checked = values.filter(a => a.refinement === 'done' && !a.pendingConfirmation).length;
    const scanned = positions.size;
    const phase: ReviewPhase = scanned < total ? 'overview' : remaining.length ? 'refinement' : 'complete';
    return {phase,scanned,total,checked,checks:checked+remaining.length,remaining,complete:total>0&&phase==='complete',
        estimated:values.some(a=>a.profile==='quick'),
        text:phase==='overview' ? `Building overview: ${scanned}/${total}` : phase==='refinement' ? `Checking key moments: ${checked}/${checked+remaining.length}` : `Review complete: ${scanned}/${total}`};
}

export function canCoach(assessment: MoveAssessment) {
    return assessment.profile !== 'quick' && !assessment.pendingConfirmation && assessment.refinement !== 'pending' && !assessment.feedback?.provisional;
}
