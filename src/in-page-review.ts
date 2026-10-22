import { matchesBoard, type Position } from './adapters';
import type { Card } from './card';
import type { Overlay } from './overlay';
import { reviewInsight, reviewProblem, reviewLabel } from './review-insights';
import { readableMove } from './readable-move';
import { resolveReviewPly } from './site-review';
import type { NativeReviewSnapshot } from './site-review-types';
import type { ReviewEvent, ReviewSession } from './review-types';
import { buildBoardContext } from './board-context';
import type { OpeningContext } from './opening-context';
import { explanationStatus, type ExplanationProgress } from './explanation-state';

type Result = Extract<ReviewEvent, { type: 'REVIEW_RESULT' }>;
type Send = (message: object) => Promise<any>;

/** Owns analysis for a verified position on the website's existing board. */
export class InPageReviewController {
    private currentSession?: ReviewSession;
    private position?: Position;
    private snapshot?: NativeReviewSnapshot;
    private selected?: number;
    private signature = '';
    private failedSelection?: { signature: string; text: string };
    private retrySelected = false;
    private request?: { id: string; ply: number; ai: boolean; background: boolean; signature: string; explanation?: { text: string; provider?: string } };
    private selectedTimer?: ReturnType<typeof setTimeout>;
    private results = new Map<number, Result>();
    private insights = new WeakMap<Result, ReturnType<typeof reviewInsight>>();
    private aiText = new Map<string, { text: string; provider?: string; progress: ExplanationProgress; expires: number }>();
    private openings = new Map<number, OpeningContext>();
    private sweep = false;
    onRequestRefresh = () => {};
    get active() { return !!this.currentSession; }
    get session() { return this.currentSession; }

    constructor(private card: Card, private overlay: Overlay, private send: Send) {
        card.onReviewAI = () => {
            this.sweep = false; this.progress();
            if (this.verified() && this.selected !== undefined) this.analyze(this.selected, true);
        };
        card.onReviewSweep = () => {
            this.sweep = !this.sweep; this.progress();
            if (this.sweep) this.next();
            else { this.cancel(); this.card.status.textContent = 'Whole-game analysis paused.'; }
        };
        card.onReviewStop = () => { this.stop(); this.onRequestRefresh(); };
        card.onReviewRetry = () => {
            if (!this.active || !this.failedSelection) return;
            this.failedSelection = undefined; this.signature = ''; this.retrySelected = true; this.card.reviewRetry.hidden = true;
            this.onRequestRefresh();
        };
        card.onReviewLayers = () => { this.draw(); };
        card.onReviewIssue = ply => { void this.selectIssue(ply); };
    }

    start(session: ReviewSession) {
        this.stop(); this.currentSession = session;
        this.card.setReviewMode(true); this.card.clear('Use the website’s move controls to select a position.');
        this.progress(); this.onRequestRefresh();
    }

    update(position: Position | undefined, snapshot: NativeReviewSnapshot | undefined) {
        if (!this.active) return;
        if (snapshot && this.gameReplaced(snapshot)) { this.stop(); this.onRequestRefresh(); return; }
        this.position = position; this.snapshot = snapshot;
        const ply = this.currentSession && snapshot ? resolveReviewPly(this.currentSession, snapshot) : undefined;
        if (ply === undefined || !position?.allowed || !position.fen || position.fen !== snapshot?.fen || !this.visibleBoard(position, snapshot)) {
            this.invalidate('Waiting for the selected move and board to match.'); return;
        }
        this.selected = ply; this.currentSession!.selectedPly = ply;
        const signature = `${this.currentSession!.id}|${ply}|${snapshot.path ?? ''}|${position.fen}`;
        if (this.failedSelection && this.failedSelection.signature !== signature) this.failedSelection = undefined;
        if (signature !== this.signature) {
            this.cancel(); this.signature = signature; this.overlay.clear();
            this.card.clear('Stockfish is checking this selected move…');
            this.render();
            if (this.retrySelected) { this.retrySelected = false; this.analyze(ply); }
            else if (this.failedSelection?.signature === signature) {
                this.card.status.textContent = this.failedSelection.text; this.card.reviewRetry.hidden = false;
            } else if (!this.cachedExplanation()) this.scheduleSelected(ply);
            else if (this.sweep) this.next();
        } else this.draw();
    }

    handle(event: ReviewEvent) {
        if (event.type === 'REVIEW_OPENING') {
            const result = this.results.get(event.ply);
            if (this.currentSession?.id !== event.sessionId || result?.requestId !== event.requestId || !this.verified()) return;
            this.openings.set(event.ply, event.opening);
            if (event.ply === this.selected) this.card.showOpening(event.opening);
            return;
        }
        const request = this.request;
        if (!this.currentSession || !request || event.sessionId !== this.currentSession.id || event.requestId !== request.id) return;
        if (!this.verified()) { this.invalidate('Position changed. Waiting for the website’s selected move.'); return; }
        if (event.type === 'REVIEW_RESULT') {
            if (event.ply !== request.ply) return;
            if (event.opening) this.openings.set(event.ply, event.opening);
            if (event.ply === this.selected) { this.failedSelection = undefined; this.card.reviewRetry.hidden = true; }
            this.results.set(event.ply, event); this.progress();
            if (event.ply === this.selected) this.render();
            if (!request.ai) { this.request = undefined; this.next(); }
        } else if (event.type === 'REVIEW_TEXT') {
            request.explanation = { text: event.text, provider: event.provider };
            if (request.ply === this.selected) this.card.showReviewAI(event.text, event.provider);
            this.onRequestRefresh();
        } else if (event.type === 'REVIEW_EXPLANATION_STATE') {
            const expectedFen = request.ply ? this.currentSession.moves[request.ply - 1]?.afterFen : this.currentSession.initialFen;
            if (event.ply !== request.ply || event.fen !== expectedFen) return;
            if (request.ply === this.selected) this.card.status.textContent = explanationStatus(event);
            if (event.state === 'pending') { this.card.reviewAI.disabled = true; return; }
            if (event.state === 'ready' && request.explanation) {
                this.aiText.delete(request.signature);
                this.aiText.set(request.signature, { ...request.explanation, progress: event, expires: Date.now() + 300000 });
                while (this.aiText.size > 40) this.aiText.delete(this.aiText.keys().next().value!);
            }
            this.request = undefined;
            this.card.reviewAI.disabled = !this.results.has(this.selected!);
            if (event.state === 'failed') {
                this.failedSelection = { signature: this.signature, text: explanationStatus(event) };
                this.signature = ''; this.card.reviewRetry.hidden = false;
            }
            this.next();
        } else if (event.type === 'REVIEW_ERROR') {
            this.request = undefined; this.sweep = false; this.progress();
            const text = this.results.has(this.selected!) ? 'Stockfish feedback is ready. Additional analysis is unavailable.' : event.text;
            if (!request.background) {
                this.failedSelection = { signature: this.signature, text }; this.signature = '';
                this.card.reviewRetry.hidden = false;
            }
            this.card.reviewAI.disabled = !this.results.get(this.selected!)?.feedback;
            this.card.status.textContent = text;
        } else {
            this.card.status.textContent = event.text;
        }
    }

    refreshExplanations() {
        this.cancel(); this.aiText.clear(); this.signature = ''; this.failedSelection = undefined;
    }

    private cachedExplanation() {
        const entry = this.aiText.get(this.signature);
        if (entry && entry.expires > Date.now()) return entry;
        this.aiText.delete(this.signature);
    }

    private scheduleSelected(ply: number) {
        this.card.status.textContent = 'Preparing an AI explanation…';
        this.selectedTimer = setTimeout(() => {
            this.selectedTimer = undefined;
            if (this.verified() && this.selected === ply) this.analyze(ply);
        }, 180);
    }

    stop() {
        this.cancel(); this.currentSession = undefined; this.position = undefined; this.snapshot = undefined;
        this.selected = undefined; this.signature = ''; this.sweep = false; this.results.clear(); this.aiText.clear(); this.openings.clear();
        this.failedSelection = undefined; this.retrySelected = false;
        this.overlay.clear(); this.card.setReviewIssues([]); this.card.setReviewMode(false); this.card.clear('Review stopped.');
    }

    private cancel() {
        clearTimeout(this.selectedTimer); this.selectedTimer = undefined;
        if (this.request) void this.send({ type: 'CANCEL' }).catch(() => {});
        this.request = undefined;
    }

    private invalidate(text: string) {
        this.cancel(); this.signature = ''; this.selected = undefined; this.sweep = false;
        this.overlay.clear(); this.card.clear(text); this.progress();
    }

    private visibleBoard(position: Position, snapshot: NativeReviewSnapshot) {
        return snapshot.allowed && snapshot.url === location.href && document.visibilityState !== 'hidden' && position.board.isConnected && !!position.fen && matchesBoard(position.board, position.fen, new URL(snapshot.url).hostname === 'lichess.org', position.orientation);
    }

    private gameReplaced(snapshot: NativeReviewSnapshot) {
        const source = this.currentSession?.source;
        if (!source || !snapshot.allowed || snapshot.url !== location.href) return false;
        try {
            const selected = new URL(snapshot.url), original = new URL(source.url);
            if (selected.protocol !== 'https:') return false;
            if (selected.hostname !== original.hostname) return true;
            if (snapshot.gameId) {
                const id = selected.hostname === 'lichess.org' ? /^\/([a-zA-Z0-9]{8})(?:[a-zA-Z0-9]{4})?(?:\/(?:white|black))?\/?$/.exec(selected.pathname)?.[1]
                    : /^\/(?:game\/(?:live|daily)|live\/game|analysis\/game\/(?:live|daily))\/(\d+)(?:\/|$)/.exec(selected.pathname)?.[1];
                return id === snapshot.gameId && snapshot.gameId !== source.gameId;
            }
            return source.gameId === 'study' && selected.pathname !== original.pathname;
        } catch { return false; }
    }

    private verified() {
        return !!this.position && !!this.snapshot && this.selected !== undefined && !!this.currentSession && this.position.fen === this.snapshot.fen && resolveReviewPly(this.currentSession, this.snapshot) === this.selected && this.visibleBoard(this.position, this.snapshot);
    }

    private analyze(ply: number, ai = true, background = false) {
        if (!this.currentSession || !this.verified()) return;
        this.cancel();
        // A user action can retry directly after an error, before another update.
        this.signature = `${this.currentSession.id}|${this.selected}|${this.snapshot?.path ?? ''}|${this.position!.fen}`;
        if (ai) this.aiText.delete(this.signature);
        const id = crypto.randomUUID(); this.request = { id, ply, ai, background, signature: this.signature };
        if (!background) { this.failedSelection = undefined; this.card.reviewRetry.hidden = true; }
        const session = this.currentSession;
        if (ai) this.card.reviewAI.disabled = true;
        this.card.status.textContent = background ? `Analyzing move ${ply} of ${session.moves.length}…` : ai ? 'Preparing an AI explanation…' : 'Stockfish is checking this selected move…';
        void this.send({ type: 'REVIEW_ANALYZE', sessionId: session.id, requestId: id, initialFen: session.initialFen, moves: session.moves.map(move => move.uci), ply, ai, background }).then(response => {
            if (this.request?.id !== id || !response?.error) return;
            this.handle({ type: 'REVIEW_ERROR', sessionId: session.id, requestId: id, tabId: session.source?.tabId ?? -1, text: response.error });
        }).catch(() => {
            if (this.request?.id !== id) return;
            this.handle({ type: 'REVIEW_ERROR', sessionId: session.id, requestId: id, tabId: session.source?.tabId ?? -1, text: 'Extension unavailable. Refresh this page.' });
        });
    }

    private next() {
        if (!this.sweep || this.request || this.selectedTimer || !this.currentSession || !this.verified()) return;
        const next = this.currentSession.moves.find(move => !this.results.has(move.ply));
        if (next) this.analyze(next.ply, false, true);
        else { this.sweep = false; this.progress(); this.card.reviewIssues.open = this.card.reviewIssues.querySelectorAll('li').length > 0; this.card.status.textContent = 'Game review complete. Open Moves to revisit to examine inaccuracies and mistakes.'; }
    }

    private render() {
        if (!this.verified()) return;
        this.progress();
        const result = this.results.get(this.selected!);
        if (result) {
            this.card.showReview(result.after, result.feedback, result.before, this.currentSession!.moves[this.selected! - 1], result.feedback ? this.insight(result) : undefined);
            this.card.showPositionFacts(buildBoardContext(this.position!.fen!, { sessionId: this.currentSession!.id, initialFen: this.currentSession!.initialFen, moves: this.currentSession!.moves.map(move => move.uci), ply: this.selected! }));
            this.card.showOpening(this.openings.get(this.selected!));
            const ai = this.cachedExplanation();
            if (ai) { this.card.showReviewAI(ai.text, ai.provider); this.card.status.textContent = explanationStatus(ai.progress); }
            if (this.request?.ai && this.request.ply === this.selected) this.card.reviewAI.disabled = true;
        }
        this.draw(); this.onRequestRefresh();
    }

    private progress() {
        this.card.setReviewProgress([...this.results.keys()].filter(ply => ply > 0).length, this.currentSession?.moves.length ?? 0, this.sweep);
        const issues = [...this.results.values()].filter(result => reviewProblem(result.feedback?.label)).sort((a,b)=>a.ply-b.ply).flatMap(result => {
            const move=this.currentSession?.moves[result.ply-1];
            return move && result.feedback ? [{ply:result.ply,name:`${move.beforeFen.split(' ')[5]}${move.color==='w'?'.':'...'} ${readableMove(move.beforeFen,move.uci)}`,label:result.feedback.label,summary:this.insight(result).summary}] : [];
        });
        this.card.setReviewIssues(issues,this.selected);
    }

    private async selectIssue(ply: number) {
        if (!this.verified() || !this.currentSession || !this.results.has(ply)) return;
        const session=this.currentSession.id, url=location.href;
        this.sweep=false; this.cancel(); this.progress(); this.overlay.clear();
        this.card.status.textContent='Selecting the played move on the website...';
        const response=await this.send({type:'NATIVE_REVIEW_NAVIGATE',direction:'select',ply}).catch(()=>({ok:false}));
        if(this.currentSession?.id!==session || location.href!==url)return;
        this.onRequestRefresh();
        if(!response?.ok)this.card.status.textContent="Use the website's move list to select this played move.";
    }

    private insight(result: Result) {
        let insight = this.insights.get(result);
        if (!insight) {
            insight = reviewInsight(this.currentSession!.moves[result.ply - 1], result.feedback!, result.before, result.after);
            this.insights.set(result, insight);
        }
        return insight;
    }

    private draw() {
        if (!this.verified()) { this.overlay.clear(); return; }
        const result = this.results.get(this.selected!);
        if (!result) { this.overlay.clear(); return; }
        const move = this.currentSession!.moves[this.selected! - 1];
        const feedback=result.feedback, problem=reviewProblem(feedback?.label);
        const marker=move && feedback ? {square:move.uci.slice(2,4),label:reviewLabel(feedback.label),grade:problem ?? 'good' as const} : undefined;
        const reviewCues: import('./overlay-model').ReviewCue[]=[];
        if(move && feedback && problem){
            reviewCues.push(...this.insight(result).cues);
        }
        this.overlay.setLayers(this.position!.board, this.position!.orientation, { heatmap:[], arrows:[], marker, reviewCues });
        this.card.reviewLegend.textContent='';
        this.card.reviewLegend.title=reviewCues.map(cue=>cue.label).join('\n');
    }
}
