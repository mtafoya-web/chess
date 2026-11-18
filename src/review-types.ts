import type { Diagnostic } from './diagnostics';
import type { ExplanationProgress } from './explanation-state';
import type { OpeningContext } from './opening-context';
import type { Evaluation, ExecutionSettings } from './types';
import type { SearchProfile, LearningLevel } from './review-scoring';

export interface ReviewMove {
    ply: number; san: string; uci: string; color: 'w' | 'b'; beforeFen: string; afterFen: string;
}
export interface ReviewSource { url: string; gameId: string; tabId?: number }
export interface ReviewSession {
    id: string; title: string; initialFen: string; result: string; moves: ReviewMove[];
    selectedPly: number; source?: ReviewSource;
}
export interface MoveFeedback { label: string; summary: string; lossCp?: number; bestMove?: string; lossWinPercent?: number; accuracy?: number; provisional?: boolean; confirmed?: boolean }
export interface MoveAssessment { ply: number; before?: Evaluation; after: Evaluation; feedback?: MoveFeedback; pendingConfirmation?: boolean; opening?: OpeningContext }
export interface ReviewRequest {
    type: 'REVIEW_ANALYZE'; sessionId: string; requestId: string; initialFen: string;
    moves: string[]; ply: number; ai?: boolean; background?: boolean; profile?: SearchProfile; attempt?: string; level?: LearningLevel;
}
export interface ReviewJob {
    target: 'offscreen'; type: 'REVIEW_START'; request: ReviewRequest; tabId: number; settings: ExecutionSettings; manual?: boolean; nativeEvaluation?: Evaluation;
}
export type ReviewEvent =
    | { type: 'REVIEW_ENGINE_COMPLETE'; sessionId: string; requestId: string; tabId: number; ply: number }
    | { type: 'REVIEW_PRACTICE_RESULT'; sessionId: string; requestId: string; tabId: number; ply: number; attempt: string; feedback: MoveFeedback; accepted: boolean; uncertain: boolean }
    | ({ type: 'REVIEW_EXPLANATION_STATE'; sessionId: string; requestId: string; tabId: number; ply: number; fen: string } & ExplanationProgress)
    | { type: 'REVIEW_OPENING'; sessionId: string; requestId: string; tabId: number; ply: number; opening: OpeningContext }
    | { type: 'REVIEW_RESULT'; sessionId: string; requestId: string; tabId: number; ply: number; before?: Evaluation; after: Evaluation; advice?: Evaluation; feedback?: MoveFeedback; opening?: OpeningContext; pendingConfirmation?: boolean }
    | { type: 'REVIEW_TEXT'; sessionId: string; requestId: string; tabId: number; text: string; provider?: string }
    | { type: 'REVIEW_STATUS' | 'REVIEW_ERROR'; sessionId: string; requestId: string; tabId: number; text: string; diagnostic?: Diagnostic };
