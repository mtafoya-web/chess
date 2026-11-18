import { DEFAULT_REVIEW_PREFERENCES, SCORING_VERSION, validPreferences } from './review-scoring';
import { matchingGame, reviewFingerprint, type PracticeRecord, type ReviewState } from './review-model';
import type { MoveAssessment, ReviewSession } from './review-types';
import { isAnalysisEvent, isReviewSession } from './messages';
export { validPreferences } from './review-scoring';

export interface LibraryEntry extends ReviewState { key: string; version: number }
const KEY = 'reviewLibraryV2';
const DELETED = 'deletedReviewHistoryV2';
const MAX_BYTES = 5 * 1024 * 1024;
/** Trusted-context storage. Serialized read/modify/write prevents lost concurrent results. */
export class ReviewLibrary {
    private serial: Promise<unknown> = Promise.resolve();
    private transact<T>(work: (entries: LibraryEntry[]) => Promise<T>): Promise<T> {
        const task = this.serial.then(async () => {
            const raw = (await chrome.storage.local.get(KEY))[KEY];
            const entries: LibraryEntry[] = Array.isArray(raw) ? raw.slice(0, 50).filter(e => {
                if (e?.version !== SCORING_VERSION || typeof e.key !== 'string' || !isReviewSession(e.session) || !validPreferences(e.preferences) || !Number.isFinite(e.updatedAt) || !Array.isArray(e.assessments) || e.assessments.length > 1501 || !Array.isArray(e.attempts) || e.attempts.length > 500) return false;
                const seen = new Set<number>();
                return e.assessments.every((a: MoveAssessment) => {
                    if (!a || seen.has(a.ply) || a.ply > e.session.moves.length) return false;
                    seen.add(a.ply);
                    return isAnalysisEvent({...a,type:'REVIEW_RESULT',requestId:'stored',sessionId:'stored',tabId:0});
                }) && e.attempts.every((a: PracticeRecord) => a && Number.isInteger(a.ply) && a.ply > 0 && a.ply <= e.session.moves.length && Number.isFinite(a.at) && ['solved','hinted','revealed','skipped','missed'].includes(a.outcome));
            }) : [];
            return work(entries);
        });
        this.serial = task.catch(() => {}); return task;
    }
    list(): Promise<LibraryEntry[]> { return this.transact(async entries => structuredClone(entries)); }
    async open(session: ReviewSession): Promise<ReviewState> {
        return this.transact(async entries => {
            const existing = entries.find(e => e.key === reviewFingerprint(session) && matchingGame(e.session, session));
            return { session: { ...session, selectedPly: existing?.session.selectedPly ?? session.selectedPly }, assessments: structuredClone(existing?.assessments ?? []), preferences: { ...DEFAULT_REVIEW_PREFERENCES, ...existing?.preferences }, running: false, updatedAt: Date.now(), attempts: structuredClone(existing?.attempts ?? []) };
        });
    }
    save(state: ReviewState): Promise<void> {
        const snapshot = structuredClone(state);
        return this.transact(async entries => {
            const key = reviewFingerprint(snapshot.session);
            const deleted = (await chrome.storage.local.get(DELETED))[DELETED];
            if (Array.isArray(deleted) && deleted.includes(key)) return;
            entries = entries.filter(e => e.key !== key);
            entries.unshift({ ...snapshot, running: false, practicePly: undefined, key, version: SCORING_VERSION });
            entries = entries.slice(0, 50);
            let remaining = 500;
            for (const entry of entries) { entry.attempts = remaining ? entry.attempts.slice(-remaining) : []; remaining -= entry.attempts.length; }
            while (entries.length && new TextEncoder().encode(JSON.stringify(entries)).length > MAX_BYTES) entries.pop();
            if (!entries.some(e => e.key === key)) throw new Error('This review is too large to save. You can continue reviewing without saved history.');
            await chrome.storage.local.set({ [KEY]: entries });
        });
    }
    allow(session: ReviewSession): Promise<void> { return this.transact(async () => {
        const deleted = (await chrome.storage.local.get(DELETED))[DELETED];
        if (Array.isArray(deleted)) await chrome.storage.local.set({[DELETED]:deleted.filter(key=>key!==reviewFingerprint(session))});
    }); }
    remove(key?: string): Promise<void> { return this.transact(async entries => {
        const previous=(await chrome.storage.local.get(DELETED))[DELETED];
        const deleted=[...new Set([...(Array.isArray(previous)?previous.filter(k=>typeof k==='string'):[]),...(key?[key]:entries.map(e=>e.key))])].slice(-500);
        await chrome.storage.local.set({ [KEY]: key ? entries.filter(e => e.key !== key) : [], [DELETED]:deleted });
    }); }
}
export function recordAssessment(state: ReviewState, assessment: MoveAssessment) {
    state.assessments = [...state.assessments.filter(a => a.ply !== assessment.ply), { ply: assessment.ply, before: assessment.before, after: assessment.after, feedback: assessment.feedback, pendingConfirmation:assessment.pendingConfirmation, opening:assessment.opening }]; state.updatedAt = Date.now();
}
export function recordPractice(state: ReviewState, attempt: PracticeRecord) { state.attempts.push(attempt); state.attempts = state.attempts.slice(-500); state.updatedAt = Date.now(); }
