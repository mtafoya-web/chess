import {reviewProgress,canCoach} from './review-progress';
import type {SearchProfile} from './review-scoring';
import { DEFAULT_REVIEW_PREFERENCES, type ReviewPreferences } from './review-scoring';
import { matchingGame, summarizeReview, coachingText, type ReviewState } from './review-model';
import type { ReviewControl } from './messages';
import type { ReviewAction } from './review-tools';
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
import { providerFailureText } from './provider-failures';

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
    private assessmentSignatures = new Map<number,string>();
    private insights = new WeakMap<Result, ReturnType<typeof reviewInsight>>();
    private aiText = new Map<string, { text: string; provider?: string; progress: ExplanationProgress; expires: number }>();
    private openings = new Map<number, OpeningContext>();
    private sweep = false;
    private syncingState = false;
    private syncAgain = false;
    private preferences: ReviewPreferences = { ...DEFAULT_REVIEW_PREFERENCES };
    private explanationRequest?: NonNullable<InPageReviewController['request']>;
    private why = false;
    private teaching?: { ply: number; uci: string; san: string; pv: string };
    private practice?: { move: ReviewSession['moves'][number]; assessment: Result; revealed: boolean; solved: boolean };
    private publishedView = '';
    private get state(): ReviewState { return {session:this.currentSession!,assessments:[...this.results.values()],preferences:this.preferences,running:this.sweep,updatedAt:Date.now(),attempts:[]}; }

    onRequestRefresh = () => {};
    get active() { return !!this.currentSession; }
    get session() { return this.currentSession; }

    constructor(private card: Card, private overlay: Overlay, private send: Send) {
        card.learning.onAction = (action, value) => { void this.learningAction(action, value); };
        card.onReviewAI = () => {
             this.progress();
            if (this.verified() && this.selected !== undefined) this.analyze(this.selected, true);
        };
        card.onReviewSweep = () => {
            if (!this.currentSession) return;
            void this.send({type:'REVIEW_RUN_CONTROL',sessionId:this.currentSession.id,action:this.sweep?'pause':'resume'}).then(() => this.syncState());
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
        this.stop(true, true); this.currentSession = session;
        this.card.setReviewMode(true); this.card.clear('Analyzing the completed game. Select a move using the website controls.');
        void this.send({type:'REVIEW_RUN_CONTROL',sessionId:session.id,action:document.visibilityState==='hidden'?'hide':'show'}).then(() => this.syncState());
        this.onRequestRefresh();
    }

    /** Results can arrive while the website has no verifiable selected position. */
    async syncState() {
        if (!this.currentSession) return;
        if (this.syncingState) { this.syncAgain = true; return; }
        const id = this.currentSession.id;
        this.syncingState = true;
        try {
            const response = await this.send({type:'GET_REVIEW_STATE'}), state = response?.state as ReviewState | undefined;
            if (!state || this.currentSession?.id !== id || state.session.id !== id || !matchingGame(this.currentSession,state.session)) return;
            if (state.active === false) { this.stop(true,true); this.onRequestRefresh(); return; }
            let redraw = this.preferences.level !== state.preferences.level;
            this.preferences = {...DEFAULT_REVIEW_PREFERENCES,...state.preferences}; this.sweep = state.running;
            for (const assessment of state.assessments) {
                const key = JSON.stringify(assessment);
                if (this.assessmentSignatures.get(assessment.ply)===key) continue;
                this.assessmentSignatures.set(assessment.ply,key);
                redraw ||= assessment.ply===this.selected;
                const previous = this.results.get(assessment.ply);
                this.results.set(assessment.ply,{type:'REVIEW_RESULT',sessionId:id,requestId:previous?.requestId??`restored:${assessment.ply}`,tabId:this.currentSession.source?.tabId??-1,...assessment});
                if (assessment.opening) this.openings.set(assessment.ply,assessment.opening);
            }
            this.progress(); if (redraw) this.render();
            if (state.runError) this.card.status.textContent = state.runError;
            else if (state.runStatus === 'complete' && !this.request && !this.explanationRequest) this.card.status.textContent = 'Game review complete. Browse the moves, key moments, and overview.';
        } finally {
            this.syncingState = false;
            if (this.syncAgain) { this.syncAgain = false; void this.syncState(); }
        }
    }

    visibility(visible: boolean) {
        if (this.currentSession) void this.send({type:'REVIEW_RUN_CONTROL',sessionId:this.currentSession.id,action:visible?'show':'hide'});
    }

    update(position: Position | undefined, snapshot: NativeReviewSnapshot | undefined) {
        if (!this.active) return;
        if (snapshot && this.gameReplaced(snapshot)) { this.stop(true); this.onRequestRefresh(); return; }
        this.position = position; this.snapshot = snapshot;
        const ply = this.currentSession && snapshot ? resolveReviewPly(this.currentSession, snapshot) : undefined;
        if (ply === undefined || !position?.allowed || !position.fen || position.fen !== snapshot?.fen || !this.visibleBoard(position, snapshot)) {
            this.invalidate(this.sweep ? 'Analyzing the game. Select a mainline move on the website to see its explanation.' : 'Select a mainline move on the website to see its explanation.'); return;
        }
        this.selected = ply; this.currentSession!.selectedPly = ply;
        const signature = `${this.currentSession!.id}|${ply}|${snapshot.path ?? ''}|${position.fen}`;
        if (this.practice) {
            if (ply !== this.practice.move.ply && ply !== this.practice.move.ply-1) this.endPractice();
            else {
                this.signature=signature;this.overlay.clear();
                if (!this.request) this.card.status.textContent='Practice ready. Enter a move or choose its squares.';
                this.card.learning.boardNote(ply===this.practice.move.ply-1 ? 'The website board shows the exercise position.' : "The exercise starts one move earlier than the board. Use the website's previous-move control to view it; your answer is checked from that earlier position.");
                this.progress();return;
            }
        }
        if (this.teaching && ply !== this.teaching.ply-1) this.teaching=undefined;

        if (this.failedSelection && this.failedSelection.signature !== signature) this.failedSelection = undefined;
        if (signature !== this.signature) {
            this.cancel(); this.signature = signature; this.overlay.clear();
            this.card.clear('Stockfish is checking this selected move…');
            this.render();
            if (this.retrySelected) { this.retrySelected = false; this.analyze(ply); }
            else if (this.failedSelection?.signature === signature) {
                this.card.status.textContent = this.failedSelection.text; this.card.reviewRetry.hidden = false;
            } else if (this.teaching) this.draw();
            else if (!this.cachedExplanation()) this.scheduleSelected(ply);
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
        const request = this.request?.id === event.requestId ? this.request : this.explanationRequest?.id === event.requestId ? this.explanationRequest : undefined;
        if (!this.currentSession || !request || event.sessionId !== this.currentSession.id) return;
        if ((event.type === 'REVIEW_RESULT' || event.type === 'REVIEW_TEXT' || event.type === 'REVIEW_EXPLANATION_STATE')
            && ('ply' in event) && (event.ply !== this.selected || !this.verified())) return;
        if (!this.verified()) { this.invalidate('Position changed. Waiting for the website’s selected move.'); return; }
        if (event.type === 'REVIEW_PRACTICE_RESULT') {
            if (!this.practice || event.ply!==this.practice.move.ply) return;
            this.request=undefined;this.card.learning.setPending(false);
            if (event.uncertain) this.card.learning.message('The searches disagree. This answer needs deeper analysis and will not count toward your progress.');
            else if (event.accepted) {
                this.practice.solved=true;
                this.card.learning.message("Good solution. This move keeps the position close to the engine's preferred continuation.");
                this.recordAttempt(this.card.learning.hinted?'hinted':'solved');
                this.card.learning.complete();
            } else { this.card.learning.message('There is a stronger move. Compare forcing replies, try a hint, or enter another answer.'); this.recordAttempt('missed'); }
            return;
        }
        if (event.type === 'REVIEW_ENGINE_COMPLETE') {
            if (event.ply!==request.ply) return;
            if (this.request?.id===request.id) { if (request.ai) this.explanationRequest=request;this.request=undefined; }
            return;
        }
        if (event.type === 'REVIEW_RESULT') {
            if (event.ply !== request.ply) return;
            if (event.ply !== this.selected || !this.verified()) return;
            if (event.opening) this.openings.set(event.ply, event.opening);
            if (event.ply === this.selected) { this.failedSelection = undefined; this.card.reviewRetry.hidden = true; }
            this.results.set(event.ply, event); this.progress();
            if (event.ply === this.selected) this.render();
            if (event.pendingConfirmation && event.ply===this.selected) this.card.status.textContent='Preliminary feedback is ready. Stockfish is checking it more deeply.';
            if (!request.ai && !event.pendingConfirmation && this.request?.id===request.id) { this.request = undefined;  }
        } else if (event.type === 'REVIEW_TEXT') {
            if (request.ply !== this.selected || !this.verified()) return;
            request.explanation = { text: event.text, provider: event.provider };
            if (request.ply === this.selected && !this.practice && !this.results.get(request.ply)?.feedback?.provisional) this.card.showReviewAI(event.text, event.provider);
            this.onRequestRefresh();
        } else if (event.type === 'REVIEW_EXPLANATION_STATE') {
            const expectedFen = request.ply ? this.currentSession.moves[request.ply - 1]?.afterFen : this.currentSession.initialFen;
            if (event.ply !== request.ply || event.fen !== expectedFen) return;
            if (request.ply === this.selected) {
                this.card.reviewExplanationStatus.textContent = event.state==='ready' ? '' : explanationStatus(event);
                if(event.attempts?.length)this.card.reviewAIText.textContent=[this.card.reviewAIText.textContent,event.attempts.map(providerFailureText).join(' ')].filter(Boolean).join(' ');
            }
            if (event.state === 'pending') { this.card.reviewAI.disabled = true; return; }
            if (event.state === 'ready' && request.explanation) {
                this.aiText.delete(request.signature);
                this.aiText.set(request.signature, { ...request.explanation, progress: event, expires: Date.now() + 300000 });
                while (this.aiText.size > 40) this.aiText.delete(this.aiText.keys().next().value!);
            }
            if (this.request?.id===request.id) this.request=undefined; else this.explanationRequest=undefined;
            this.card.reviewAI.disabled = !this.results.has(this.selected!);
            if (event.state === 'failed') {
                this.failedSelection = { signature: this.signature, text: explanationStatus(event) };
                this.signature = ''; this.card.reviewRetry.hidden = false;
            }

        } else if (event.type === 'REVIEW_ERROR') {
            if (this.practice) {
                this.request=undefined;this.card.learning.setPending(false);this.card.learning.message('Your answer could not be checked. Retry it or return to the game.');return;
            }
            this.request = undefined;  this.progress();
            const text = this.results.has(this.selected!) ? 'Stockfish feedback is ready. Additional analysis is unavailable.' : event.text;
            if (!request.background) {
                this.failedSelection = { signature: this.signature, text }; this.signature = '';
                this.card.reviewRetry.hidden = false;
            }
            this.card.reviewAI.disabled = !this.results.get(this.selected!)?.feedback;
            this.card.status.textContent = text;
        } else if ('text' in event && !request.background) {
            if(request.ai)this.card.reviewExplanationStatus.textContent='Preparing an explanation…';
            else this.card.status.textContent = event.text;
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
        this.card.status.textContent = this.results.has(ply) ? '' : 'Checking this move…';
        this.selectedTimer = setTimeout(() => {
            this.selectedTimer = undefined;
            if (this.verified() && this.selected === ply) {
                const cached = this.results.get(ply);
                if (!cached) this.analyze(ply,false,false,'quick');
                else this.analyze(ply,true,false,cached.profile==='quick'&&cached.refinement!=='pending'?'quick':'standard');
            }
        }, 180);
    }

    stop(preserve = false, switching = false) {
        if (this.currentSession && !switching) {
            void this.send({type:'REVIEW_RUN_CONTROL',sessionId:this.currentSession.id,action:preserve?'hide':'stop'});
        }
        this.cancel(); this.currentSession = undefined; this.position = undefined; this.snapshot = undefined;
        this.selected = undefined; this.signature = ''; this.sweep = false; this.results.clear(); this.assessmentSignatures.clear(); this.aiText.clear(); this.openings.clear();
        this.failedSelection = undefined; this.retrySelected = false;this.teaching=undefined;this.practice=undefined;this.card.learning.stop();this.card.host.removeAttribute('data-practice');this.publishedView='';
        this.overlay.clear(); this.card.setReviewIssues([]); this.card.setReviewMode(false); this.card.clear('Review stopped.');
    }

    private cancel(explanations = true) {
        clearTimeout(this.selectedTimer); this.selectedTimer = undefined;
        if (this.request) void this.send({type:'CANCEL',requestId:this.request.id}).catch(()=>{});
        if (explanations && this.explanationRequest) void this.send({type:'CANCEL',requestId:this.explanationRequest.id}).catch(()=>{});
        this.request = undefined;
        if (explanations) this.explanationRequest=undefined;
        this.card.learning.setPending(false);
    }

    private invalidate(text: string) {
        this.cancel(); this.signature = ''; this.selected = undefined;
        this.overlay.clear(); this.card.clear(text); this.progress();
    }

    private visibleBoard(position: Position, snapshot: NativeReviewSnapshot) {
        return snapshot.allowed && snapshot.url === location.href && document.visibilityState !== 'hidden' && position.board.isConnected && !!position.fen && matchesBoard(position.board, position.fen, new URL(snapshot.url).hostname === 'lichess.org', position.orientation);
    }

    private gameReplaced(snapshot: NativeReviewSnapshot) {
        const source = this.currentSession?.source;
        if (!source || snapshot.url !== location.href) return false;
        if (!snapshot.allowed && document.querySelector('.rclock.running,.clock-component.clock-player-turn')) return true;
        try {
            const selected = new URL(snapshot.url), original = new URL(source.url);
            if (selected.protocol !== 'https:') return false;
            if (selected.hostname !== original.hostname) return true;
            if (snapshot.gameId) {
                return snapshot.gameId !== source.gameId;
            }
            return source.gameId === 'study' && selected.pathname !== original.pathname;
        } catch { return false; }
    }

    private verified() {
        return !!this.position && !!this.snapshot && this.selected !== undefined && !!this.currentSession && this.position.fen === this.snapshot.fen && resolveReviewPly(this.currentSession, this.snapshot) === this.selected && this.visibleBoard(this.position, this.snapshot);
    }

    private analyze(ply: number, ai = true, background = false, profile: SearchProfile = this.results.get(ply)?.profile==='quick'&&this.results.get(ply)?.refinement!=='pending'?'quick':'standard') {
        if (!this.currentSession || !this.verified()) return;
        this.cancel(!background);
        // A user action can retry directly after an error, before another update.
        this.signature = `${this.currentSession.id}|${this.selected}|${this.snapshot?.path ?? ''}|${this.position!.fen}`;
        if (ai) this.aiText.delete(this.signature);
        const id = crypto.randomUUID(); this.request = { id, ply, ai, background, signature: this.signature };
        if (!background) { this.failedSelection = undefined; this.card.reviewRetry.hidden = true; }
        const session = this.currentSession;
        if (ai) this.card.reviewAI.disabled = true;
        if (!background) {
            this.card.status.textContent = this.results.has(ply) ? '' : 'Checking this move…';
            this.card.reviewExplanationStatus.textContent = ai ? 'Preparing an explanation…' : '';
        }
        void this.send({ type: 'REVIEW_ANALYZE', sessionId: session.id, requestId: id, initialFen: session.initialFen, moves: session.moves.map(move => move.uci), ply, ai, background, profile }).then(response => {
            if (this.request?.id !== id || !response?.error) return;
            this.handle({ type: 'REVIEW_ERROR', sessionId: session.id, requestId: id, tabId: session.source?.tabId ?? -1, text: response.error });
        }).catch(() => {
            if (this.request?.id !== id) return;
            this.handle({ type: 'REVIEW_ERROR', sessionId: session.id, requestId: id, tabId: session.source?.tabId ?? -1, text: 'Extension unavailable. Refresh this page.' });
        });
    }

    private render() {
        if (!this.verified()) return;
        this.progress();
        if (this.practice) return;
        if (this.teaching && this.selected===this.teaching.ply-1) {
            this.card.heading.textContent=`Before move ${this.teaching.ply % 2 ? Math.ceil(this.teaching.ply/2)+'.' : Math.ceil(this.teaching.ply/2)+'...'} - Better alternative`;
            this.card.explanation.textContent=`The engine preferred ${this.teaching.san}. One searched continuation: ${this.teaching.pv}`;
            this.card.reviewCueExplanation.hidden=true;this.draw();return;
        }
        const result = this.results.get(this.selected!);
        this.card.learning.update(this.currentSession!.moves[this.selected!-1],result,this.preferences);
        if (result) {
            this.card.showReview(result.after, result.feedback, result.before, this.currentSession!.moves[this.selected! - 1], result.feedback && canCoach(result) ? this.insight(result) : undefined);
            const reviewedMove=this.currentSession!.moves[this.selected!-1];
            if (reviewedMove) this.card.explanation.textContent=coachingText(reviewedMove,result,this.preferences,this.currentSession);
            this.card.reviewCueExplanation.hidden=!this.why;

            this.card.showPositionFacts(buildBoardContext(this.position!.fen!, { sessionId: this.currentSession!.id, initialFen: this.currentSession!.initialFen, moves: this.currentSession!.moves.map(move => move.uci), ply: this.selected! }));
            this.card.showOpening(this.openings.get(this.selected!));
            const ai = this.cachedExplanation();
            if (ai && !result.feedback?.provisional) { this.card.showReviewAI(ai.text, ai.provider); this.card.reviewExplanationStatus.textContent = ''; }
            if (this.request?.ai && this.request.ply === this.selected) this.card.reviewAI.disabled = true;
        }
        this.draw(); this.onRequestRefresh();
    }

    private progress() {
        const progress = reviewProgress(this.currentSession?.moves.length??0,[...this.results.values()]);
        this.card.setReviewProgress(progress.scanned,progress.total,this.sweep,progress.text+(!this.sweep&&!progress.complete?' - paused':''));
        const issues = [...this.results.values()].filter(result => canCoach(result) && reviewProblem(result.feedback?.label)).sort((a,b)=>a.ply-b.ply).flatMap(result => {
            const move=this.currentSession?.moves[result.ply-1];
            return move && result.feedback ? [{ply:result.ply,name:`${move.beforeFen.split(' ')[5]}${move.color==='w'?'.':'...'} ${readableMove(move.beforeFen,move.uci)}`,label:result.feedback.label,summary:this.insight(result).summary}] : [];
        });
        this.card.setReviewIssues(issues,this.selected);
        if (this.currentSession && this.selected !== undefined) {
            const view=JSON.stringify([this.currentSession.id,this.selected??0,this.sweep,this.practice?.move.ply]);
            if (view!==this.publishedView) {
                this.publishedView=view;
                void this.send({type:'REVIEW_VIEW',sessionId:this.currentSession.id,ply:this.selected??0,running:this.sweep,practicePly:this.practice?.move.ply}).catch(()=>{});
            }
        }

    }

    private async selectIssue(ply: number) {
        if (!this.verified() || !this.currentSession || !this.results.has(ply)) return;
        const session=this.currentSession.id, url=location.href;
         this.cancel(); this.progress(); this.overlay.clear();
        this.card.status.textContent='Selecting the played move on the website...';
        const response=await this.send({type:'NATIVE_REVIEW_NAVIGATE',direction:'select',ply}).catch(()=>({ok:false}));
        if(this.currentSession?.id!==session || location.href!==url)return;
        this.onRequestRefresh();
        if(!response?.ok)this.card.status.textContent=this.navigationHelp("Use the website's move list to select this played move.");
    }

    private insight(result: Result) {
        let insight = this.insights.get(result);
        if (!insight) {
            insight = reviewInsight(this.currentSession!.moves[result.ply - 1], result.feedback!, result.before, result.after);
            this.insights.set(result, insight);
        }
        return insight;
    }

    control(command: ReviewControl & {sessionId:string}) {
        if (command.sessionId!==this.currentSession?.id) return;
        if (command.action==='preferences' && command.preferences) {
            const levelChanged=this.preferences.level!==command.preferences.level;
            this.preferences=command.preferences;
            if(levelChanged){this.refreshExplanations();this.onRequestRefresh();}
            this.render();return;
        }
        if (command.action==='select' && command.ply!==undefined) {void this.navigate(command.ply);return;}
        if (command.action==='sweep') {this.card.onReviewSweep();return;}
        void this.learningAction(command.action as ReviewAction);
    }
    private async navigate(ply: number) {
        if (!this.currentSession || ply<0 || ply>this.currentSession.moves.length) return false;
        if (!this.verified()) {this.card.status.textContent="Use the website's move controls to select a mainline position before navigating from Kibitz.";return false;}
        const id=this.currentSession.id,url=location.href;
        const response=await this.send({type:'NATIVE_REVIEW_NAVIGATE',direction:'select',ply}).catch(()=>({ok:false}));
        if (this.currentSession?.id!==id || location.href!==url) return false;
        this.onRequestRefresh();
        if (!response?.ok) this.card.status.textContent = this.navigationHelp(`Use the website's move controls to select ${ply === 0 ? 'the starting position' : `move ${Math.ceil(ply/2)}${ply%2?'.':'...'}`}.`);
        return response?.ok===true;
    }
    private navigationHelp(fallback: string) {
        return location.hostname==='lichess.org' && document.querySelector('.round__app')
            ? 'Choose Analysis board on Lichess to continue reviewing this game.' : fallback;
    }
    private recordAttempt(outcome: 'solved'|'hinted'|'revealed'|'skipped'|'missed') {
        if (!this.currentSession || !this.practice) return;
        void this.send({type:'REVIEW_PRACTICE_RECORD',sessionId:this.currentSession.id,ply:this.practice.move.ply,outcome}).catch(()=>{});
    }
    private endPractice() {
        this.cancel();this.practice=undefined;this.card.learning.stop();this.card.host.removeAttribute('data-practice');this.signature='';this.progress();
    }
    private async learningAction(action: ReviewAction, value?: string | ReviewPreferences) {
        if (!this.currentSession) return;
        if (action==='preferences' && value && typeof value!=='string') {
            this.preferences=value;this.aiText.clear();this.render();
            await this.send({type:'REVIEW_CONTROL',sessionId:this.currentSession.id,action:'preferences',preferences:value}).catch(()=>{});return;
        }
        if (action==='cancel' || action==='skip') {
            const ply=this.practice?.move.ply;
            if(action==='skip'&&!this.practice?.solved)this.recordAttempt('skipped');
            this.endPractice();if(ply!==undefined)await this.navigate(ply);this.onRequestRefresh();return;
        }
        if (action==='hint') {this.card.learning.hint();return;}
        if (action==='reveal') {if(this.practice&&!this.practice.revealed&&!this.practice.solved){this.recordAttempt('revealed');this.practice.revealed=true;}this.card.learning.reveal();return;}
        if (action==='check' && typeof value==='string' && this.practice && !this.practice.solved && !this.practice.revealed && this.verified()) {
            this.cancel();this.card.learning.setPending(true);this.card.learning.message('Checking your move with a deeper engine search...');
            const session=this.currentSession,id=crypto.randomUUID(),ply=this.practice.move.ply;
            this.request={id,ply,ai:false,background:false,signature:this.signature};
            const response=await this.send({type:'REVIEW_ANALYZE',sessionId:session.id,requestId:id,initialFen:session.initialFen,moves:session.moves.map(m=>m.uci),ply,ai:false,background:false,profile:'confirm',attempt:value}).catch(()=>({error:'Extension unavailable. Retry your answer.'}));
            if (response?.error && this.request?.id===id) {this.request=undefined;this.card.learning.setPending(false);this.card.learning.message(response.error);}return;
        }
        if (action==='check' && this.practice) { this.card.learning.message('Return to the exercise position on the website before checking your move.');return; }
        if (action==='next') {
            if (!this.verified()) return;
            const moments=summarizeReview(this.state).moments;
            const ply=moments.find(p=>p>(this.selected??0))??moments[0];
            if(ply===undefined){this.card.status.textContent=this.results.size>=this.currentSession.moves.length?'No confirmed key moments for this selection. Browse the game or change the player filter.':'Key moments will appear as analysis finishes.';return;}
            this.cancel();if(!await this.navigate(ply))this.card.status.textContent=this.navigationHelp(`Use the website's move list to select move ${Math.ceil(ply/2)}${ply%2?'.':'...'}.`);return;
        }
        if (action==='why') {
            const assessment=this.results.get(this.selected!);
            if(!assessment?.feedback || !canCoach(assessment) || !this.insight(assessment).cues.length)return;
            this.why=!this.why;this.card.learning.element.querySelector('[data-action="why"]')!.setAttribute('aria-pressed',String(this.why));this.render();return;
        }
        if (action==='deeper' && this.selected!==undefined) {this.analyze(this.selected,true,false,'confirm');return;}
        if (action==='better') {
            if(this.teaching){const ply=this.teaching.ply;this.teaching=undefined;await this.navigate(ply);this.onRequestRefresh();return;}
            const a=this.results.get(this.selected!),best=a?.before?.candidates[0];
            if(!best || this.selected===undefined)return;
            this.cancel();this.teaching={ply:this.selected,uci:best.uci,san:best.san,pv:best.pv};
            if(!await this.navigate(this.selected-1)){this.teaching=undefined;this.card.details.open=true;this.card.status.textContent=this.navigationHelp("The better move is in Details. Use the website's controls to view the previous position; no arrow was drawn.");}return;
        }
        if (action==='practice' && this.selected && this.verified()) {
            const assessment=this.results.get(this.selected);const move=this.currentSession.moves[this.selected-1];
            if(!assessment || !move || !canCoach(assessment) || !reviewProblem(assessment.feedback?.label))return;
            void this.send({type:'REVIEW_RUN_CONTROL',sessionId:this.currentSession.id,action:'pause'});
            this.cancel();this.teaching=undefined;
            this.card.learning.update(move,assessment,this.preferences);this.card.learning.resetForm();
            if(!this.card.learning.start())return;
            this.practice={move,assessment,revealed:false,solved:false};this.card.host.setAttribute('data-practice','');this.overlay.clear();this.progress();
            if(!await this.navigate(move.ply-1))this.card.learning.boardNote(this.navigationHelp("Use the website's previous-move control to view the exercise position. Your answer is checked from before the played move."));return;
        }
    }

    private draw() {
        if (!this.verified()) { this.overlay.clear(); return; }
        if (this.practice) {this.overlay.clear();return;}
        if (this.teaching && this.selected===this.teaching.ply-1) {
            this.overlay.setLayers(this.position!.board,this.position!.orientation,{heatmap:[],arrows:this.preferences.visuals?[{uci:this.teaching.uci,kind:'best',rank:1}]:[],reviewCues:[]});return;
        }
        const result = this.results.get(this.selected!);
        if (!result) { this.overlay.clear(); return; }
        const move = this.currentSession!.moves[this.selected! - 1];
        const feedback=result.feedback, problem=reviewProblem(feedback?.label);
        const marker=move && feedback ? {square:move.uci.slice(2,4),label:reviewLabel(feedback.label),grade:feedback.provisional || feedback.label==='Review' ? 'unknown' as const : problem ?? 'good' as const} : undefined;
        const reviewCues: import('./overlay-model').ReviewCue[]=[];
        if(move && feedback && problem && canCoach(result)){
            reviewCues.push(...this.insight(result).cues.filter(c=>c.kind!=='consequence'||this.why));
        }
        this.overlay.setLayers(this.position!.board, this.position!.orientation, { heatmap:[], arrows:[], marker:this.preferences.visuals?marker:undefined, reviewCues:this.preferences.visuals?reviewCues:[] });
        this.card.reviewLegend.textContent='';
        this.card.reviewLegend.title=reviewCues.map(cue=>cue.label).join('\n');
    }
}
