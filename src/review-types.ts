import type { Diagnostic } from './diagnostics';
import type { OpeningContext } from './opening-context';
import type { Evaluation, ExecutionSettings } from './types';

export interface ReviewMove {
    ply: number; san: string; uci: string; color: 'w' | 'b'; beforeFen: string; afterFen: string;
}
export interface ReviewSource { url: string; gameId: string; tabId?: number }
export interface ReviewSession {
    id: string; title: string; initialFen: string; result: string; moves: ReviewMove[];
    selectedPly: number; source?: ReviewSource;
}
export interface MoveFeedback { label: string; summary: string; lossCp?: number; bestMove?: string }
export interface ReviewRequest {
    type: 'REVIEW_ANALYZE'; sessionId: string; requestId: string; initialFen: string;
    moves: string[]; ply: number; ai?: boolean; background?: boolean;
}
export interface ReviewJob {
    target: 'offscreen'; type: 'REVIEW_START'; request: ReviewRequest; tabId: number; settings: ExecutionSettings; manual?: boolean; nativeEvaluation?: Evaluation;
}
export type ReviewEvent =
    | { type: 'REVIEW_OPENING'; sessionId: string; requestId: string; tabId: number; ply: number; opening: OpeningContext }
    | { type: 'REVIEW_RESULT'; sessionId: string; requestId: string; tabId: number; ply: number; before?: Evaluation; after: Evaluation; advice?: Evaluation; feedback?: MoveFeedback; opening?: OpeningContext }
    | { type: 'REVIEW_TEXT'; sessionId: string; requestId: string; tabId: number; text: string; provider?: string }
    | { type: 'REVIEW_STATUS' | 'REVIEW_ERROR'; sessionId: string; requestId: string; tabId: number; text: string; diagnostic?: Diagnostic };
