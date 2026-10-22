import type { Evaluation } from './types';
import { renderMarkdown } from './markdown';
import { applySiteTheme, readSiteTheme, type SiteTheme } from './theme';
import type { BoardContext } from './board-context';
import type { MoveFeedback, ReviewMove } from './review-types';
import { readableMove } from './readable-move';
import { rankedCandidates, candidateWhiteMate } from './overlay-model';
import { Chess } from 'chess.js';
import { KIBITZ_MARK } from './wordmark';
import type { OpeningContext } from './opening-context';
import { reviewInsight, reviewLabel, type ReviewInsight } from './review-insights';
const candidateScore = (candidate: Evaluation['candidates'][number]) => {
    const mate = candidateWhiteMate(candidate);
    return mate !== undefined ? `${mate < 0 ? '-' : ''}M${Math.abs(mate)}` : `${candidate.score >= 0 ? '+' : ''}${candidate.score.toFixed(2)}`;
};
export class Card {
    private themePage = '';
    private pageTheme?: SiteTheme;
    readonly host = document.createElement('div');
    readonly root = this.host.attachShadow({ mode: 'open' });
    readonly details: HTMLDetailsElement;
    readonly heading: HTMLElement;
    readonly explanation: HTMLElement;
    readonly status: HTMLElement;
    readonly alternatives: HTMLElement;
    readonly evaluation: HTMLElement;
    readonly bar: HTMLElement;
    onDetails = () => {};
    onReview = () => {};
    onReviewAI = () => {};
    onReviewSweep = () => {};
    onReviewStop = () => {};
    onReviewRetry = () => {};
    onReviewLayers = () => {};
    onReviewIssue = (_ply: number) => {};
    readonly reviewControls: HTMLElement;
    readonly layerControls: HTMLElement;
    readonly sourceAttribution: HTMLElement;
    readonly opening: HTMLElement;
    readonly positionFacts: HTMLDetailsElement;
    readonly heatmapToggle: HTMLInputElement;
    readonly arrowsToggle: HTMLInputElement;
    readonly reviewLegend: HTMLElement;
    readonly reviewCueExplanation: HTMLElement;
    readonly reviewAI: HTMLButtonElement;
    readonly reviewRetry: HTMLButtonElement;
    readonly reviewSweep: HTMLButtonElement;
    readonly reviewProgress: HTMLElement;
    readonly reviewIssues: HTMLDetailsElement;
    readonly reviewAIText: HTMLElement;
    readonly reviewButton: HTMLButtonElement;
    constructor(close: () => void) {
        this.host.id = 'kibitz-card';
        this.host.style.cssText = 'display:block;position:relative;box-sizing:border-box;width:100%;min-width:0;max-width:min(560px,100%);margin:12px 0;clear:both;flex-shrink:1;container-type:inline-size;container-name:kibitz;';
        this.root.innerHTML = `<style>
            :host{font:inherit;color:var(--k-fg,#eee)}*{box-sizing:border-box}article{font:inherit;font-size:14px;line-height:1.5;background:var(--k-bg,#262421);border:2px solid var(--k-gold,#b38a30);border-radius:var(--k-radius,8px);padding:14px 16px;box-shadow:0 2px 7px #0000000a}
            header{display:flex;align-items:center;gap:9px}button{margin-left:auto;background:none;border:0;color:inherit;font:inherit;cursor:pointer;padding:2px 7px;border-radius:4px}.brand{margin:0;padding:0;display:inline-flex;align-items:center;gap:7px;font-size:16px;font-weight:650;letter-spacing:-.02em}.brand svg{width:24px;height:24px;color:var(--k-gold,#b38a30)}.disclosure{font-size:12px;opacity:.7}button:hover{background:#8882}button:focus-visible,summary:focus-visible{outline:2px solid var(--k-accent,#82a958);outline-offset:3px}[hidden]{display:none!important}
            .recommendation{display:flex;align-items:center;gap:12px;margin-top:6px}h2{font-size:22px;line-height:1.3;margin:0;font-weight:650}.eval{margin-left:auto;font-variant-numeric:tabular-nums;font-size:13px}.track{height:4px;width:48px;background:#777;border-radius:3px;overflow:hidden}.fill{height:100%;width:50%;background:var(--k-accent,#82a958)}p{margin:8px 0 0}p:empty{display:none}.status{font-size:12px;opacity:.75}details{margin-top:10px;font-size:12px}summary{cursor:pointer;opacity:.8;width:fit-content}.lines{white-space:pre-wrap;overflow-wrap:anywhere;margin-top:8px;opacity:.85}code{font:inherit}strong{font-weight:650}
            article{min-width:0;padding:12px;font-size:16px;overflow-wrap:anywhere}header{flex-wrap:wrap}.brand{margin-left:0;min-width:0;white-space:normal}button,summary{min-height:44px}button{min-width:44px}summary{display:flex;align-items:center;max-width:100%}.recommendation{flex-wrap:wrap;gap:8px}h2{flex:1 1 120px;min-width:0;overflow-wrap:anywhere}.eval{max-width:100%;overflow-wrap:anywhere}.track{flex:0 0 48px}.status,.lines{overflow-wrap:anywhere}.lines{max-width:100%}@container kibitz (min-width:360px){article{padding:14px 16px;font-size:14px}}
        </style><article aria-label="Kibitz chess guidance"><header><button class="brand" aria-expanded="true" aria-controls="guidance" title="Collapse guidance">${KIBITZ_MARK}<span>Kibitz</span><span class="disclosure" aria-hidden="true">&#9662;</span></button><button data-close aria-label="Close Kibitz and pause analysis" title="Pause analysis">×</button></header><div id="guidance"><div class="recommendation"><h2>Ready to study</h2><span class="eval"></span><div class="track" aria-hidden="true"><div class="fill"></div></div></div><p class="explanation" aria-live="polite" aria-atomic="true"></p><p class="status" role="status"></p><details><summary>Details</summary><div class="lines"></div></details></div></article>`;
        this.heading = this.root.querySelector('h2')!; this.explanation = this.root.querySelector('.explanation')!;
        this.status = this.root.querySelector('.status')!; this.alternatives = this.root.querySelector('.lines')!;
        this.evaluation = this.root.querySelector('.eval')!; this.bar = this.root.querySelector('.fill')!;
        this.details = this.root.querySelector('details')!;
        this.reviewControls = document.createElement('section');
        this.reviewControls.hidden = true;
        this.reviewControls.setAttribute('aria-label', 'Game review controls');
        this.reviewControls.innerHTML = `<style>.review-options{display:flex;gap:8px 14px;flex-wrap:wrap;margin-top:8px}.review-options label{display:flex;align-items:center;gap:5px;min-height:44px}.review-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.review-actions button{margin:0;border:1px solid var(--k-border,#555);padding:5px 9px;font-size:12px;max-width:100%}.review-legend,.review-progress,.preview-note{font-size:12px;opacity:.8;overflow-wrap:anywhere}.review-ai-text{font-size:13px}</style><div class="review-options"><label><input type="checkbox" data-heatmap checked aria-label="Show candidate heatmap on website board">Candidate heatmap</label><label><input type="checkbox" data-arrows checked aria-label="Show ranked candidate arrows on website board">Candidate arrows</label></div><p class="review-legend"></p><p class="preview-note">Use the website's move controls to explore the game. Better alternatives stay in Details.</p><div class="review-actions"><button type="button" data-retry hidden>Retry selected move</button><button type="button" data-ai disabled>Explain with AI</button><button type="button" data-sweep>Analyze whole game</button><button type="button" data-stop>Exit review</button></div><p class="review-progress" role="status"></p>`;
        this.details.before(this.reviewControls);
        this.root.append(this.reviewControls.querySelector('style')!);
        this.layerControls = document.createElement('section');
        this.layerControls.setAttribute('aria-label', 'Board overlays');
        this.layerControls.append(this.reviewControls.querySelector('.review-options')!, this.reviewControls.querySelector('.review-legend')!);
        this.reviewControls.before(this.layerControls);
        this.heatmapToggle = this.layerControls.querySelector('[data-heatmap]')!;
        this.arrowsToggle = this.layerControls.querySelector('[data-arrows]')!;
        this.reviewLegend = this.layerControls.querySelector('.review-legend')!;
        this.heatmapToggle.disabled = true; this.arrowsToggle.disabled = true;
        this.reviewLegend.textContent = 'Candidate heatmap compares suggested moves, not all attacked squares. Available after analysis.';
        this.sourceAttribution = document.createElement('p'); this.sourceAttribution.className = 'status'; this.details.append(this.sourceAttribution);
        this.opening = document.createElement('p'); this.opening.hidden = true; this.details.append(this.opening);
        this.positionFacts = document.createElement('details'); this.positionFacts.hidden = true; this.positionFacts.setAttribute('aria-label', 'Verified position facts'); this.details.append(this.positionFacts);
        this.reviewAI = this.reviewControls.querySelector('[data-ai]')!;
        this.reviewRetry = this.reviewControls.querySelector('[data-retry]')!;
        this.reviewSweep = this.reviewControls.querySelector('[data-sweep]')!;
        this.reviewProgress = this.reviewControls.querySelector('.review-progress')!;
        this.reviewIssues = document.createElement('details'); this.reviewIssues.className = 'review-issues';
        this.reviewIssues.innerHTML = '<summary>Moves to revisit</summary><p>No inaccuracies found in the analyzed moves yet.</p><ol style="padding-left:20px;max-height:240px;overflow:auto" aria-label="Inaccuracies and mistakes"></ol>';
        this.reviewCueExplanation = document.createElement('section');
        this.reviewCueExplanation.className = 'review-cue-explanation';
        this.reviewCueExplanation.setAttribute('aria-label', 'Explanation of board highlights');
        this.reviewCueExplanation.setAttribute('aria-live', 'polite');
        this.reviewCueExplanation.setAttribute('aria-atomic', 'true');
        this.reviewCueExplanation.hidden = true;
        this.reviewControls.prepend(this.reviewCueExplanation);
        const cueStyle = document.createElement('style');
        cueStyle.textContent = `.review-cue-explanation{margin:12px 0;border-top:1px solid var(--k-border,#7775);padding-top:8px}.review-cue-explanation h3{font:inherit;font-weight:650;margin:0}.cue-list{list-style:none;margin:8px 0;padding:0;display:grid;gap:8px}.cue-list li{display:flex;align-items:flex-start;gap:10px}.cue-sample{flex:0 0 20px;width:20px;height:20px;margin-top:2px;border:2px solid var(--cue-color);border-radius:3px;background:var(--cue-fill)}.cue-sample.origin{border-style:dashed}.cue-sample.consequence{border:3px dotted #f0b342;background:none}.cue-help p{font-size:inherit}.cue-help{font-size:inherit}`;
        this.root.append(cueStyle);
        this.reviewControls.append(this.reviewIssues);
        this.reviewAIText = document.createElement('p'); this.reviewAIText.className = 'review-ai-text';
        this.explanation.after(this.reviewAIText);
        this.reviewAI.addEventListener('click', () => this.onReviewAI());
        this.reviewRetry.addEventListener('click', () => this.onReviewRetry());
        this.reviewSweep.addEventListener('click', () => this.onReviewSweep());
        this.reviewControls.querySelector('[data-stop]')!.addEventListener('click', () => this.onReviewStop());
        this.heatmapToggle.addEventListener('change', () => this.onReviewLayers());
        this.arrowsToggle.addEventListener('change', () => this.onReviewLayers());
        this.reviewButton = document.createElement('button');
        this.reviewButton.type = 'button'; this.reviewButton.textContent = 'Review with Kibitz';
        this.reviewButton.hidden = true;
        this.reviewButton.style.cssText = 'display:block;margin:10px 0 0;border:1px solid var(--k-accent,#82a958);padding:6px 12px;';
        this.reviewButton.addEventListener('click', () => this.onReview());
        this.root.querySelector('article')!.append(this.reviewButton);
        this.details.addEventListener('toggle', () => this.onDetails());
        this.root.querySelector('[data-close]')!.addEventListener('click', close);
        const toggle = this.root.querySelector<HTMLButtonElement>('.brand')!;
        toggle.addEventListener('click', () => {
            const body = this.root.querySelector<HTMLElement>('#guidance')!;
            body.hidden = !body.hidden;
            toggle.setAttribute('aria-expanded', String(!body.hidden));
            toggle.querySelector('.disclosure')!.textContent = body.hidden ? '▸' : '▾';
            toggle.title = body.hidden ? 'Expand guidance' : 'Collapse guidance';
        });
    }
    clear(text: string) { this.reviewCueExplanation.hidden = true; this.reviewCueExplanation.replaceChildren(); this.showOpening(); this.positionFacts.hidden = true; this.positionFacts.replaceChildren(); this.heading.textContent = 'Ready to study'; this.explanation.replaceChildren(); this.reviewAIText.replaceChildren(); this.evaluation.textContent = ''; this.alternatives.textContent = ''; this.reviewLegend.textContent = 'Candidate heatmap colors compare legal candidate moves; they do not show every attacked square.'; this.sourceAttribution.textContent = ''; this.heatmapToggle.disabled = true; this.arrowsToggle.disabled = true; this.reviewAI.disabled = true; this.reviewRetry.hidden = true; this.status.textContent = text; this.bar.style.width = '50%'; }
    setReviewMode(active: boolean) {
        this.reviewControls.hidden = !active; this.layerControls.hidden = active;
        if (active) this.reviewControls.prepend(this.reviewLegend); else { this.layerControls.append(this.reviewLegend); this.reviewAIText.replaceChildren(); }
        this.reviewButton.hidden = active;
    }
    showReview(result: Evaluation, feedback?: MoveFeedback, before?: Evaluation, move?: ReviewMove, verifiedInsight?: ReviewInsight) {
        this.heading.textContent = move ? `${readableMove(move.beforeFen, move.uci)} · ${reviewLabel(feedback?.label)}` : 'Starting position';
        this.bar.style.width = `${50 + 48 * Math.tanh(result.whiteScore / 4)}%`;
        this.status.textContent = '';
        this.evaluation.textContent = `${before ? `${before.evaluation} → ` : ''}${result.evaluation}`;
        this.explanation.textContent = feedback?.summary ?? result.terminal ?? 'Select a played move to review what happened.';
        this.sourceAttribution.textContent = 'Move rating and consequences: local Stockfish comparison.';
        this.reviewAIText.replaceChildren(); this.reviewAI.disabled = !feedback;
        this.alternatives.textContent = '';
        this.reviewCueExplanation.hidden = true; this.reviewCueExplanation.replaceChildren();
        if (move && feedback) {
            try {
                const insight = verifiedInsight ?? reviewInsight(move,feedback,before,result);
                this.explanation.textContent = insight.summary;
                this.alternatives.textContent = [insight.continuation, insight.alternative, insight.evaluationNote].filter(Boolean).join('\n\n');
                if (insight.cues.length) {
                    const section = this.reviewCueExplanation;
                    section.hidden = false;
                    section.style.setProperty('--cue-color', feedback.label === 'Inaccuracy' ? '#a4750d' : '#b63c42');
                    section.style.setProperty('--cue-fill', feedback.label === 'Inaccuracy' ? '#d3a52d26' : '#c9454d26');
                    const heading = document.createElement('h3'), played = document.createElement('p'), grade = document.createElement('p'), list = document.createElement('ul');
                    heading.textContent = 'On the board'; played.textContent = insight.playedDescription; grade.textContent = insight.gradeExplanation ?? '';
                    list.className = 'cue-list';
                    for (const cue of insight.cues) {
                        const row = document.createElement('li'), sample = document.createElement('span'), label = document.createElement('span');
                        sample.className = `cue-sample ${cue.kind}`; sample.setAttribute('aria-hidden', 'true'); label.textContent = cue.label;
                        row.append(sample, label); list.append(row);
                    }
                    const help = document.createElement('details'); help.className = 'cue-help';
                    help.innerHTML = '<summary>What do the symbols and outlines mean?</summary><p>?! Inaccuracy: a small setback. ? Mistake: a significant setback. ?? Blunder: a major setback. M? Missed mate: a missed chance to force checkmate.</p><p>The dashed square shows where the piece moved from; the solid square shows where it moved to. The dotted gold outline marks an affected piece in the position shown. Grades compare engine evaluations; a possible continuation is not a prediction of what your opponent will play.</p>';
                    section.append(heading, played, grade, list, help);
                }
            } catch { /* Never render an alternative from an unverified move. */ }
        }
        this.heatmapToggle.disabled = true; this.arrowsToggle.disabled = true;
    }
    showReviewAI(text: string, provider?: string) { this.explanation.textContent = text; this.reviewAIText.textContent = provider ? `Explanation by ${provider}` : 'Verified explanation'; }
    setReviewProgress(analyzed: number, total: number, running: boolean) { this.reviewProgress.textContent = `${analyzed} of ${total} moves analyzed`; this.reviewSweep.textContent = running ? 'Pause analysis' : 'Analyze whole game'; }
    setReviewIssues(issues: {ply:number;name:string;label:string;summary:string}[], selected?: number) {
        const list=this.reviewIssues.querySelector('ol')!;
        const focused=(this.root.activeElement as HTMLElement | null)?.dataset.issuePly;
        list.replaceChildren(); this.reviewIssues.querySelector('summary')!.textContent=`Moves to revisit (${issues.length})`;
        this.reviewIssues.querySelector('p')!.hidden=issues.length>0;
        for(const issue of issues){
            const row=document.createElement('li'), button=document.createElement('button'), text=document.createElement('p');
            button.type='button'; button.dataset.issuePly=String(issue.ply); button.textContent=issue.name+' · '+issue.label;
            button.style.cssText='margin:0;text-align:left;max-width:100%;white-space:normal';
            if(issue.ply===selected)button.setAttribute('aria-current','step');
            button.addEventListener('click',()=>this.onReviewIssue(issue.ply));
            text.textContent=issue.summary; text.className='status'; row.append(button,text); list.append(row);
            if(focused===String(issue.ply))button.focus({preventScroll:true});
        }
    }
    show(result: Evaluation, fen?: string) {
        const candidates = fen ? rankedCandidates(result.candidates, new Chess(fen).turn(), fen) : result.candidates;
        this.heatmapToggle.disabled = !candidates.length; this.arrowsToggle.disabled = !candidates.length;
        this.reviewLegend.textContent = candidates.length ? 'Arrows 1-3 rank alternative next moves; 1 is preferred. Colored destinations are analyzed candidates, not square safety ratings.' : 'No candidate overlays: this position has finished.';
        this.sourceAttribution.textContent = result.source ? `Candidate moves: ${result.source.label}.` : 'Candidate moves: local Stockfish.';
        this.heading.textContent = result.terminal ?? (candidates[0] ? (fen ? readableMove(fen, candidates[0].uci) : candidates[0].san) : 'No move');
        this.evaluation.textContent = result.terminal ? '' : result.evaluation;
        this.evaluation.title = 'Evaluation from White’s perspective';
        this.bar.style.width = `${50 + 48 * Math.tanh(result.whiteScore / 4)}%`;
        this.showCandidates(result, fen);
        this.status.textContent = result.terminal ? 'Position finished.' : '';
    }
    private showCandidates(result: Evaluation, fen?: string) {
        const candidates = fen ? rankedCandidates(result.candidates, new Chess(fen).turn(), fen) : result.candidates.slice(0, 3);
        this.alternatives.textContent = candidates.map((c, i) => `${i + 1}. ${fen ? readableMove(fen, c.uci) : c.san} · ${candidateScore(c)} (White's perspective)\n${c.pv}`).join('\n') || 'No continuation: this position has finished.';
    }
    showOpening(context?: OpeningContext) {
        const notes: string[] = [];
        if (context?.current) notes.push(`Opening so far: ${context.current.name}. ${context.current.purpose ?? ''}`.trim());
        if (context?.entered && context.entered.name !== context.current?.name) notes.push(`Suggested move would enter: ${context.entered.name}. ${context.entered.purpose ?? ''}`.trim());
        this.opening.textContent = notes.join(' '); this.opening.hidden = !notes.length;
    }
    showPositionFacts(context: BoardContext) {
        const names = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
        const color = (c: string) => c === 'w' ? 'White' : 'Black';
        const summary = document.createElement('summary'); summary.textContent = 'Verified position facts';
        const lines: string[] = [`${color(context.turn)} to move${context.ply !== undefined ? ` · selected half-move ${context.ply}` : ''}.`];
        for (const side of ['w', 'b'] as const) {
            const pieces = Object.entries(names).flatMap(([type, name]) => {
                const squares = context.pieces.filter(p => p.color === side && p.type === type).map(p => p.square).sort();
                return squares.length ? [`${name}${squares.length > 1 ? 's' : ''}: ${squares.join(', ')}`] : [];
            });
            lines.push(`${color(side)} on board: ${pieces.join('; ')}.`);
        }
        if (context.historyCompleteness === 'position-only') lines.push('Capture history unknown: only this position is available.');
        else {
            lines.push(context.historyCompleteness === 'custom-start' ? 'Capture history starts at the imported position; earlier captures are unknown.' : 'Capture history verified from the standard starting position.');
            lines.push(context.captures.length ? `Captured through this move: ${context.captures.map(c => `${color(c.captured.color)} ${names[c.captured.type]} on ${c.square} (half-move ${c.ply})`).join('; ')}.` : 'No captures in the available history through this move.');
            if (context.promotions.length) lines.push(`Promotions: ${context.promotions.map(p => `${color(p.color)} pawn promoted to ${names[p.to]} on ${p.square} (half-move ${p.ply})`).join('; ')}.`);
        }
        const body = document.createElement('div'); body.className = 'lines'; body.textContent = lines.join('\n');
        this.positionFacts.replaceChildren(summary, body); this.positionFacts.hidden = false;
    }
    explain(text: string) { renderMarkdown(this.explanation, text); }
    theme(board: HTMLElement, lichess: boolean) {
        // Hashes can select moves; only arrival at another page permits resampling.
        const page = location.href.split('#')[0];
        if (this.pageTheme && this.themePage === page) return this.pageTheme;
        const theme = readSiteTheme(board, lichess, this.host.parentElement ?? board.parentElement ?? document.body);
        applySiteTheme(this.host, theme);
        this.themePage = page; this.pageTheme = theme;
        return theme;
    }
}
