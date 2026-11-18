import { Chess } from 'chess.js';
import { playUci } from './chess';
import type { MoveAssessment, ReviewMove } from './review-types';
import { lessonFor } from './review-model';
import { DEFAULT_REVIEW_PREFERENCES, type ReviewPreferences } from './review-scoring';

export type ReviewAction = 'next' | 'practice' | 'why' | 'better' | 'deeper' | 'hint' | 'reveal' | 'skip' | 'cancel' | 'check' | 'preferences';
export const reviewStyles = `
article{font-size:16px}.status,.lines,.review-ai-text{font-size:14px;opacity:1}.review-grade{display:inline-block;font-size:14px;font-weight:600;padding:2px 6px;border:1px solid var(--k-border,#7777);border-radius:4px;vertical-align:middle}
:host{--k-space:8px} .review-tools{border-top:1px solid var(--k-border,#7775);margin-top:12px;padding-top:12px;font-size:14px;line-height:1.5}
.review-tools .toolbar{display:flex;gap:8px;flex-wrap:wrap}.review-tools button{margin:0;border:1px solid var(--k-border,#7777);padding:9px 12px;font-size:14px;line-height:1.3;min-height:44px;border-radius:6px}.review-tools .primary{background:var(--k-accent,#79b5d6);color:var(--k-bg,#262421);border-color:transparent;font-weight:650}
.review-tools label{display:block;font-size:14px}.review-tools select,.review-tools input{box-sizing:border-box;max-width:100%;width:100%;padding:9px 10px;min-height:44px;background:var(--k-bg,#262421);color:var(--k-fg,#eeeae3);border:1px solid var(--k-border,#777);border-radius:6px;font:inherit}.review-tools input:focus-visible,.review-tools select:focus-visible{outline:2px solid var(--k-accent,#79b5d6);outline-offset:2px}
.review-tools .preferences{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px}.review-tools h3{font-size:17px;line-height:1.35;margin:0 0 8px}.review-tools .squares{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}.review-tools .practice-result{min-height:22px}.review-tools .exercise-context{font-size:14px}.review-tools .practice-actions{margin-top:12px}.review-tools [hidden]{display:none!important}
.review-tools .visual-preference{display:flex;align-items:center;gap:8px;min-height:44px;margin-bottom:8px}.review-tools .visual-preference input{width:18px;min-height:18px;height:18px;margin:0}
:host([data-practice]) .visual-preference,:host([data-practice]) .recommendation,:host([data-practice]) .explanation,:host([data-practice]) .review-ai-text,:host([data-practice]) .review-cue-explanation,:host([data-practice]) .review-issues,:host([data-practice]) #guidance>details,:host([data-practice]) .review-legend,:host([data-practice]) .preview-note,:host([data-practice]) [data-ai],:host([data-practice]) [data-sweep]{display:none!important}
@media(prefers-reduced-motion:no-preference){.review-tools button{transition:background-color .12s ease}}
@media(forced-colors:active){.review-tools button{border:1px solid ButtonText}.review-tools .primary{background:ButtonFace;color:ButtonText}}
`;
export class ReviewTools {
    readonly element = document.createElement('section');
    onAction = (_action: ReviewAction, _value?: string | ReviewPreferences) => {};
    private move?: ReviewMove;
    private assessment?: MoveAssessment;
    private exercise?: ReviewMove;
    private hints = 0;
    private preferences: ReviewPreferences = {...DEFAULT_REVIEW_PREFERENCES};
    get practicing() { return !!this.exercise; }
    get hinted() { return this.hints > 0; }
    constructor() {
        this.element.className = 'review-tools'; this.element.setAttribute('aria-label', 'Guided review and practice');
        this.element.innerHTML = `<div class="preferences"><label>Learning level<select data-level><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option></select></label><label>Review moves for<select data-side><option value="both">Both players</option><option value="w">White</option><option value="b">Black</option></select></label></div>
<label class="visual-preference"><input type="checkbox" data-visuals checked> Show teaching cues on board</label>
<div class="toolbar" data-browse><button type="button" class="primary" data-action="next">Next key moment</button><button type="button" data-action="practice">Try a better move</button><button type="button" data-action="why" aria-pressed="false">Show why</button><button type="button" data-action="better">Show better move</button><button type="button" data-action="deeper">Analyze deeper</button></div>
<section data-exercise hidden aria-labelledby="exercise-heading"><h3 id="exercise-heading">Find a better move</h3><p class="exercise-context"></p><p data-board-note></p><form data-attempt><label>Enter a move, such as Nf3<input data-san maxlength="32" autocomplete="off" spellcheck="false"></label><p>Or choose its squares:</p><div class="squares"><label>From<select data-from aria-label="Move from square"></select></label><label>To<select data-to aria-label="Move to square"></select></label><label>Promote to<select data-promotion><option value="q">Queen</option><option value="r">Rook</option><option value="b">Bishop</option><option value="n">Knight</option></select></label></div><button type="submit" class="primary" style="margin-top:12px">Check my move</button></form><p class="practice-result" role="status" aria-atomic="true"></p><div class="toolbar practice-actions"><button type="button" data-action="hint">Hint</button><button type="button" data-action="reveal">Reveal answer</button><button type="button" data-action="skip">Skip</button><button type="button" data-action="cancel">Return to game</button></div></section>`;
        this.element.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(button => button.addEventListener('click', () => this.onAction(button.dataset.action as ReviewAction)));
        const preferences = () => this.onAction('preferences', { ...this.preferences, level: this.level.value as ReviewPreferences['level'], side: this.side.value as ReviewPreferences['side'], visuals:this.element.querySelector<HTMLInputElement>('[data-visuals]')!.checked });
        this.level.addEventListener('change', preferences); this.side.addEventListener('change', preferences);
        this.element.querySelector('[data-visuals]')!.addEventListener('change',preferences);
        this.from.addEventListener('change', () => this.updateDestinations());
        this.element.querySelector('form')!.addEventListener('submit', e => {
            e.preventDefault(); if (!this.exercise) return;
            try {
                const board = new Chess(this.exercise.beforeFen);
                const san = this.element.querySelector<HTMLInputElement>('[data-san]')!.value.trim();
                const move = san ? board.move(san) : board.move({ from: this.from.value, to: this.to.value, promotion: this.element.querySelector<HTMLSelectElement>('[data-promotion]')!.value });
                this.onAction('check', move.lan);
            } catch { this.message('That move is not legal in the exercise position. Check the piece and destination.'); }
        });
    }
    private get level() { return this.element.querySelector<HTMLSelectElement>('[data-level]')!; }
    private get side() { return this.element.querySelector<HTMLSelectElement>('[data-side]')!; }
    private get from() { return this.element.querySelector<HTMLSelectElement>('[data-from]')!; }
    private get to() { return this.element.querySelector<HTMLSelectElement>('[data-to]')!; }
    update(move: ReviewMove | undefined, assessment: MoveAssessment | undefined, preferences: ReviewPreferences) {
        this.move = move; this.assessment = assessment; this.level.value = preferences.level; this.side.value = preferences.side;
        this.preferences = preferences;
        this.element.querySelector<HTMLInputElement>('[data-visuals]')!.checked=preferences.visuals;
        const problem = !!move && !!assessment && !!lessonFor(move, assessment);
        for (const action of ['practice', 'better']) this.element.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!.hidden = !problem;
        this.element.querySelector<HTMLButtonElement>('[data-action="deeper"]')!.disabled = !move;
    }
    start() {
        if (!this.move || !this.assessment) return false;
        this.exercise = this.move; this.hints = 0;
        this.element.querySelector<HTMLElement>('[data-browse]')!.hidden = true;
        this.element.querySelector<HTMLElement>('[data-exercise]')!.hidden = false;
        this.element.querySelector<HTMLElement>('.preferences')!.hidden = true;
        this.element.querySelector<HTMLElement>('.exercise-context')!.textContent = `${this.move.color === 'w' ? 'White' : 'Black'} to move before ${this.move.beforeFen.split(' ')[5]}${this.move.color === 'w' ? '.' : '...'} ${this.move.san}. Find an improvement. Your answer is checked from that position.`;
        this.element.querySelector<HTMLInputElement>('[data-san]')!.value = '';
        const sources = [...new Set(new Chess(this.move.beforeFen).moves({verbose:true}).map(m => m.from))].sort();
        this.from.replaceChildren(new Option('Choose', ''), ...sources.map(s => new Option(s.toUpperCase(), s))); this.updateDestinations();
        this.message(''); this.setPending(false);
        this.element.querySelector<HTMLInputElement>('[data-san]')!.focus({preventScroll:true}); return true;
    }
    stop() {
        this.exercise = undefined;
        this.element.querySelector<HTMLElement>('[data-browse]')!.hidden = false;
        this.element.querySelector<HTMLElement>('[data-exercise]')!.hidden = true;
        this.element.querySelector<HTMLElement>('.preferences')!.hidden = false;
        this.setPending(false);
        this.element.querySelector<HTMLButtonElement>('[data-action="practice"]')!.focus({preventScroll:true});
    }
    private updateDestinations() {
        const destinations = this.exercise ? [...new Set(new Chess(this.exercise.beforeFen).moves({verbose:true}).filter(m => m.from === this.from.value).map(m => m.to))].sort() : [];
        this.to.replaceChildren(new Option('Choose', ''), ...destinations.map(s => new Option(s.toUpperCase(), s)));
    }
    boardNote(text: string) { this.element.querySelector<HTMLElement>('[data-board-note]')!.textContent = text; }
    message(text: string) { this.element.querySelector<HTMLElement>('.practice-result')!.textContent = text; }
    setPending(pending: boolean) { this.element.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('[data-attempt] input,[data-attempt] select,[data-attempt] button,[data-action="hint"],[data-action="reveal"],[data-action="skip"]').forEach(e => e.disabled = pending); this.element.querySelector('form')!.setAttribute('aria-busy', String(pending)); }
    hint() {
        if (!this.exercise || !this.assessment) return;
        this.hints++;
        const lesson = lessonFor(this.exercise, this.assessment);
        const best = this.assessment.before?.candidates[0];
        if (this.hints > 1 && best) {
            const board = new Chess(this.exercise.beforeFen);
            try { const piece = playUci(board,best.uci); this.message(`Look at the ${({p:'pawn',n:'knight',b:'bishop',r:'rook',q:'queen',k:'king'})[piece.piece]} on ${piece.from.toUpperCase()}.`); } catch { this.message(lesson?.text ?? 'Compare checks, captures, and threats.'); }
        } else this.message(lesson?.text ?? 'Compare checks, captures, and threats.');
    }
    reveal() {
        if (!this.exercise || !this.assessment) return;
        const best = this.assessment.before?.candidates[0];
        this.message(best ? `One engine improvement is ${best.san}. ${best.pv ? `One searched line: ${best.pv}.` : ''}` : 'A reliable better move is not available yet. Return to the game and analyze deeper.');
        this.element.querySelector<HTMLFormElement>('form')!.hidden = true;
    }
    complete() {
        this.element.querySelector<HTMLFormElement>('form')!.hidden = true;
        this.element.querySelector<HTMLButtonElement>('[data-action="cancel"]')!.focus({preventScroll:true});
    }
    resetForm() { this.element.querySelector<HTMLFormElement>('form')!.hidden = false; }
}
