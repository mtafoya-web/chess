import {reviewProgress} from './review-progress';
import type { ReviewState } from './review-model';
import type { ReviewRequest } from './review-types';

export type ReviewRunStatus = 'analyzing' | 'paused' | 'complete' | 'stopped' | 'error';
export type ReviewRunAction = 'pause' | 'resume' | 'stop' | 'hide' | 'show';
interface Entry { state: ReviewState; requested: boolean; visible: boolean }
interface Job { tabId: number; requestId: string }
interface Hooks {
    dispatch(request: ReviewRequest, tabId: number): Promise<void>;
    cancel(requestId: string): Promise<void>;
    changed(tabId: number, requested: boolean, flush?: boolean): void;
}

/** Owns the whole-game queue, independently of native-board selection and AI. */
export class ReviewCoordinator {
    private entries = new Map<number, Entry>();
    private job?: Job;
    private foreground?: Job;
    private pumping = false;

    constructor(private hooks: Hooks) {}
    owns(requestId?: string) { return !!requestId && this.job?.requestId === requestId; }
    ownsSelection(requestId: string, tabId: number) { return this.foreground?.requestId === requestId && this.foreground.tabId === tabId; }
    requested(tabId: number) { return this.entries.get(tabId)?.requested ?? false; }
    async attach(tabId: number, state: ReviewState, requested: boolean, visible = false) {
        if (this.entries.get(tabId)?.state.session.id !== state.session.id) await this.remove(tabId);
        this.entries.set(tabId, { state, requested, visible });
        state.active = state.active !== false;
        this.publish(tabId); this.wake();
    }
    async control(tabId: number, action: ReviewRunAction) {
        const entry = this.entries.get(tabId);
        if (!entry) return;
        if (action === 'show' || action === 'hide') entry.visible = action === 'show';
        else entry.requested = action === 'resume';
        if (action === 'stop') entry.state.active = false;
        if (action === 'resume') { entry.state.active = true; entry.state.runError = undefined; }
        if ((!entry.visible || !entry.requested) && this.job?.tabId === tabId) {
            const id = this.job.requestId; this.job = undefined;
            await this.hooks.cancel(id);
        }
        this.publish(tabId); this.wake();
    }
    /** Selected positions preempt a sweep, which resumes at its unfinished ply. */
    async select(requestId: string, tabId: number) {
        this.foreground = {requestId,tabId};
        if (this.job) {
            const id = this.job.requestId; this.job = undefined;
            await this.hooks.cancel(id);
        }
    }
    release(requestId?: string) {
        if (requestId && this.foreground?.requestId !== requestId) return;
        this.foreground = undefined; this.wake();
    }
    settled(requestId: string, error?: string) {
        if (this.job?.requestId === requestId) {
            const { tabId } = this.job; this.job = undefined;
            const entry = this.entries.get(tabId);
            if (entry) {
                if (error) { entry.requested = false; entry.state.runError = error; }
                this.publish(tabId);
            }
        }
        if (this.foreground?.requestId === requestId) {
            const tabId = this.foreground.tabId; this.foreground = undefined; this.publish(tabId);
        }
        this.wake();
    }
    async remove(tabId: number) {
        const job = this.job?.tabId === tabId ? this.job : undefined;
        if (this.entries.has(tabId)) this.hooks.changed(tabId,this.requested(tabId),true);
        this.entries.delete(tabId);
        if (job) { this.job = undefined; await this.hooks.cancel(job.requestId); }
    }
    private publish(tabId: number) {
        const entry = this.entries.get(tabId);
        if (!entry) return;
        const { state } = entry;
        const progress = reviewProgress(state.session.moves.length,state.assessments);
        const phaseChanged = state.phase !== progress.phase;
        state.phase = progress.phase;
        const done = progress.complete;
        state.running = entry.requested && entry.visible && state.active !== false && !done;
        state.runStatus = state.active === false ? 'stopped' : done ? 'complete' : state.runError ? 'error' : state.running ? 'analyzing' : 'paused';
        state.updatedAt = Date.now();
        this.hooks.changed(tabId, entry.requested, phaseChanged || !state.running);
    }
    private wake() { void this.pump(); }
    private async pump() {
        if (this.pumping || this.job || this.foreground) return;
        this.pumping = true;
        try {
            for (const [tabId, entry] of this.entries) {
                if (!entry.requested || !entry.visible || entry.state.active === false) continue;
                const { state } = entry;
                const assessments = new Map(state.assessments.map(a=>[a.ply,a]));
                const missing = state.session.moves.find(move=>!assessments.has(move.ply));
                const priority = (a:typeof state.assessments[number]) => ['Missed mate'].includes(a.feedback?.label??'') || [a.before?.engineScore,a.after.engineScore].some(s=>s?.kind==='mate'||s?.kind==='terminal'&&!!s.winner) ? 1000+(a.feedback?.lossWinPercent??0) : a.feedback?.lossWinPercent??0;
                const refinement = missing ? undefined : reviewProgress(state.session.moves.length,state.assessments).remaining.sort((a,b)=>priority(b)-priority(a)||a.ply-b.ply)[0];
                const ply = missing?.ply ?? refinement?.ply;
                if (ply === undefined) { this.publish(tabId); continue; }
                const requestId = `sweep-${crypto.randomUUID()}`;
                this.job = { tabId, requestId };
                this.publish(tabId);
                try {
                    await this.hooks.dispatch({ type: 'REVIEW_ANALYZE', sessionId: state.session.id, requestId, initialFen: state.session.initialFen,
                        moves: state.session.moves.map(m => m.uci), ply, profile:missing?'quick':'standard', ai: false, background: true }, tabId);
                } catch {
                    if (this.job?.requestId === requestId) {
                        this.job = undefined; entry.requested = false;
                        state.runError = 'Game analysis could not continue. Choose Resume analysis to retry.';
                        this.publish(tabId);
                    }
                }
                break;
            }
        } finally {
            this.pumping = false;
            // A fast cached result can finish while dispatch is still awaiting its ack.
            if (!this.job && !this.foreground && [...this.entries.values()].some(e => e.state.running)) queueMicrotask(() => this.wake());
        }
    }
}
