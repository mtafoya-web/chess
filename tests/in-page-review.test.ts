// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://www.chess.com/game/live/123"}
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Chess } from 'chess.js';
import { Card } from '../src/card';
import { InPageReviewController } from '../src/in-page-review';
import { sessionFromMoves, fenAt } from '../src/review-session';
import { evaluation } from '../src/chess';
import type { Position } from '../src/adapters';
import type { Overlay } from '../src/overlay';
import type { NativeReviewSnapshot } from '../src/site-review-types';
import type { ReviewEvent, ReviewSession } from '../src/review-types';
import type { ExplanationProgress } from '../src/explanation-state';

let card: Card, controller: InPageReviewController, session: ReviewSession, board: HTMLElement;
const send = vi.fn(async (_message: any): Promise<any> => ({}));
const layers = vi.fn(), clear = vi.fn();
const requests = () => send.mock.calls.map(([message]) => message).filter(message => message.type === 'REVIEW_ANALYZE');
const last = () => requests().at(-1)!;

function position(ply: number, orientation: Position['orientation'] = 'white'): Position {
    const fen = fenAt(session, ply), chess = new Chess(fen); board.replaceChildren();
    chess.board().flat().forEach(piece => {
        if (!piece) return;
        const element = document.createElement('div');
        element.className = `piece ${piece.color}${piece.type} square-${piece.square.charCodeAt(0) - 96}${piece.square[1]}`;
        board.append(element);
    });
    return { board, orientation, fen, allowed: true, status: 'Ready' };
}
const snapshot = (ply: number): NativeReviewSnapshot => ({ url: location.href, gameId: '123', fen: fenAt(session, ply), ply, allowed: true, orientation: 'white', path: `mainline:${ply}` });
function update(ply: number) { controller.update(position(ply), snapshot(ply)); vi.advanceTimersByTime(180); }
function progress(value: ExplanationProgress, request = last()) {
    controller.handle({type:'REVIEW_EXPLANATION_STATE', sessionId:session.id, requestId:request.requestId, tabId:1, ply:request.ply, fen:fenAt(session,request.ply), ...value});
}
function result(request = last(), extra: Partial<Extract<ReviewEvent, { type: 'REVIEW_RESULT' }>> = {}, complete = true) {
    const chess = new Chess(fenAt(session, request.ply));
    const best = chess.moves({ verbose: true })[0], uci = best ? `${best.from}${best.to}${best.promotion ?? ''}` : '';
    const after = evaluation(best ? [{ uci, san: best.san, pv: best.san, score: 0.2, uciPv: [uci, 'g1f3'], sanPv: [best.san, 'Nf3'] }] : []);
    controller.handle({ type: 'REVIEW_RESULT', sessionId: session.id, requestId: request.requestId, tabId: 1, ply: request.ply, after, feedback: request.ply ? { label: 'Good', summary: `Factual feedback for move ${request.ply}.` } : undefined, ...extra });
    if (request.ai && complete) progress({state:'fallback',provider:'facts'},request);
}

beforeEach(() => {
    vi.useFakeTimers();
    send.mockReset(); send.mockResolvedValue({}); layers.mockClear(); clear.mockClear();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    history.replaceState({}, '', '/game/live/123');
    document.body.replaceChildren(); board = document.createElement('div'); document.body.append(board);
    session = sessionFromMoves(['e4', 'e5', 'Nf3'], undefined, { url: location.href, gameId: '123', tabId: 1 }, '1-0');
    card = new Card(() => {}); document.body.append(card.host);
    controller = new InPageReviewController(card, { setLayers: layers, clear } as unknown as Overlay, send);
    controller.start(session);
});
it('accepts late opening metadata for a cached matching result and ignores stale requests', () => {
    update(1); const request=last(); result();
    const event: ReviewEvent={type:'REVIEW_OPENING',sessionId:session.id,requestId:request.requestId,tabId:1,ply:1,opening:{current:{eco:'B00',name:"King's Pawn",ply:1,match:'sequence'}}};
    controller.handle({...event,requestId:'old'}); expect(card.opening.hidden).toBe(true);
    controller.handle(event); expect(card.opening.textContent).toContain("King's Pawn");
    update(2); result(); controller.handle(event); expect(card.opening.hidden).toBe(true);
    update(1); expect(card.opening.textContent).toContain("King's Pawn");
    controller.stop(); controller.handle(event); expect(card.opening.hidden).toBe(true);
});
it('starts a queued whole-game sweep on typed completion after its text', () => {
    update(1); result(); card.reviewAI.click(); const ai=last(); result(ai,{},false);
    controller.handle({type:'REVIEW_TEXT',sessionId:session.id,requestId:ai.requestId,tabId:1,text:'Verified wording.'});
    card.reviewSweep.click(); expect(last().requestId).toBe(ai.requestId);
    progress({state:'ready',provider:'chrome'},ai);
    expect(last()).toMatchObject({ply:2,background:true,ai:false});
});
it('collects problematic moves, displays visual cues, and attempts native selection from the issue list',async()=>{
    update(1); const first=last(); result(first,{feedback:{label:'Inaccuracy',summary:'First consequence.'}});
    expect(layers.mock.calls.at(-1)?.[2].reviewCues.map((c:{kind:string})=>c.kind)).toEqual(['origin','destination']);
    update(2); result(last(),{feedback:{label:'Mistake',summary:'Second consequence.'}});
    expect(card.reviewIssues.querySelectorAll('li')).toHaveLength(2);
    expect(card.reviewIssues.textContent).toContain('do not establish a specific tactical or positional reason');
    card.reviewIssues.querySelector<HTMLButtonElement>('[data-issue-ply="1"]')!.click();
    await Promise.resolve();
    expect(send).toHaveBeenCalledWith({type:'NATIVE_REVIEW_NAVIGATE',direction:'select',ply:1});
    controller.update(undefined,undefined);expect(clear).toHaveBeenCalled();
    controller.stop();expect(card.reviewIssues.querySelectorAll('li')).toHaveLength(0);
});
it('debounces rapid native navigation and explains only the final verified selection', () => {
    controller.update(position(1), snapshot(1));
    vi.advanceTimersByTime(100);
    controller.update(position(2), snapshot(2));
    vi.advanceTimersByTime(179); expect(requests()).toHaveLength(0);
    vi.advanceTimersByTime(1); expect(requests()).toHaveLength(1);
    expect(last()).toMatchObject({ply:2,ai:true,background:false});
});
it('retries an AI fallback when a move is revisited and invalidates successful wording on settings refresh', () => {
    update(1); result(); update(2); result(); update(1);
    expect(requests()).toHaveLength(3);
    result(last(),{},false);
    controller.handle({type:'REVIEW_TEXT',sessionId:session.id,requestId:last().requestId,tabId:1,text:'Validated AI wording.',provider:'Chrome AI'});
    progress({state:'ready',provider:'chrome'});
    update(2); result(); update(1);
    expect(requests()).toHaveLength(4); expect(card.explanation.textContent).toBe('Validated AI wording.');
    controller.refreshExplanations(); update(1);
    expect(requests()).toHaveLength(5); expect(last().ai).toBe(true);
    expect(card.explanation.textContent).not.toBe('Validated AI wording.');
});
it('ignores status wording and mismatched completion events while an AI request remains pending', () => {
    update(1); result(last(),{},false); const selected = last();
    card.reviewSweep.click();
    controller.handle({type:'REVIEW_STATUS',sessionId:session.id,requestId:selected.requestId,tabId:1,text:'Explanation by Chrome AI'});
    controller.handle({type:'REVIEW_EXPLANATION_STATE',sessionId:session.id,requestId:selected.requestId,tabId:1,ply:2,fen:fenAt(session,2),state:'ready',provider:'chrome'});
    controller.handle({type:'REVIEW_EXPLANATION_STATE',sessionId:session.id,requestId:selected.requestId,tabId:1,ply:1,fen:fenAt(session,2),state:'ready',provider:'chrome'});
    expect(requests()).toHaveLength(1);
    progress({state:'fallback',provider:'facts'},selected);
    expect(last()).toMatchObject({ply:2,ai:false,background:true});
});
afterEach(() => { controller.stop(); vi.useRealTimers(); document.body.replaceChildren(); });

describe('review follows the website board', () => {
    it('waits for the verified native selection and never creates another chessboard', () => {
        expect(requests()).toHaveLength(0);
        update(2); expect(last()).toMatchObject({ ply: 2, ai: true, background: false });
        result();
        expect(card.heading.textContent).toBe('Pawn to E5 · Good');
        expect(card.explanation.textContent).toBe("Black's move stayed close to the previous evaluation in this search.");
        expect(document.querySelectorAll('wc-chess-board,cg-board,chess-board')).toHaveLength(0);
        expect(layers.mock.calls.at(-1)?.[0]).toBe(board);
    });
    it('cancels rapid move changes and ignores stale results', () => {
        update(1); const stale = last(); update(2); const current = last();
        expect(current.requestId).not.toBe(stale.requestId);
        expect(send).toHaveBeenCalledWith({ type: 'CANCEL' });
        result(stale); expect(card.heading.textContent).toBe('Ready to study');
        result(current); expect(card.heading.textContent).toBe('Pawn to E5 · Good');
    });
    it('rejects position, identity, and hidden-tab mismatches', () => {
        update(1); const old = last();
        controller.update(position(2), snapshot(1)); result(old);
        expect(layers).not.toHaveBeenCalled(); expect(card.explanation.textContent).toBe('');
        controller.update(position(1), { ...snapshot(1), gameId: 'another' });
        expect(requests()).toHaveLength(1);
        update(1); Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
        controller.update(position(1), snapshot(1)); result();
        expect(card.explanation.textContent).toBe(''); expect(clear).toHaveBeenCalled();
    });
    it('rechecks visible pieces when a result arrives during a board animation', () => {
        update(1); board.querySelector('.piece')!.remove(); result();
        expect(layers).not.toHaveBeenCalled(); expect(card.explanation.textContent).toBe('');
    });
    it('uses the native history index even when piece placement repeats', () => {
        session = sessionFromMoves(['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3'], undefined, { url: location.href, gameId: '123', tabId: 1 }, '1-0');
        controller.start(session); update(1); const firstOccurrence = last(); update(5);
        expect(last().ply).toBe(5); expect(last().requestId).not.toBe(firstOccurrence.requestId);
        result(firstOccurrence); expect(card.explanation.textContent).toBe('');
        result(); expect(card.explanation.textContent).toBe("White's move stayed close to the previous evaluation in this search.");
        controller.update(position(5), { ...snapshot(5), ply: 1 });
        expect(card.explanation.textContent).toBe('');
    });
    it('reuses cached grades and redraws on rotation without another search', () => {
        update(1); result(last(),{},false);
        controller.handle({type:'REVIEW_TEXT',sessionId:session.id,requestId:last().requestId,tabId:1,text:'A verified AI explanation.',provider:'Chrome AI'});
        progress({state:'ready',provider:'chrome'});
        update(2); result();
        update(1); expect(requests()).toHaveLength(2); expect(card.heading.textContent).toBe('Pawn to E4 · Good');
        controller.update(position(1, 'black'), snapshot(1));
        expect(layers.mock.calls.at(-1)?.[1]).toBe('black'); expect(requests()).toHaveLength(2);
    });
    it('shows only played-move review cues and keeps analysis preferences untouched', () => {
        update(1); result();
        const current = layers.mock.calls.at(-1)?.[2];
        expect(current.arrows).toEqual([]); expect(current.marker).toMatchObject({ square: 'e4', label: 'Good' });
        expect(current.heatmap).toEqual([]);
        expect(card.layerControls.hidden).toBe(true);
        expect(card.arrowsToggle.checked).toBe(true); expect(card.heatmapToggle.checked).toBe(true);
        expect(card.alternatives.textContent).toBe('');
        controller.stop(); expect(card.layerControls.hidden).toBe(false);
        expect(card.arrowsToggle.checked).toBe(true); expect(card.heatmapToggle.checked).toBe(true);
    });
});

describe('optional whole-game and AI work', () => {
    it('offers an explicit retry after selected-job failure without a refresh retry loop', () => {
        update(1); const failed = last();
        controller.handle({ type: 'REVIEW_ERROR', sessionId: session.id, requestId: failed.requestId, tabId: 1, text: 'Engine unavailable.' });
        expect(card.reviewRetry.hidden).toBe(false);
        update(1); update(1); expect(requests()).toHaveLength(1);
        expect(card.status.textContent).toBe('Engine unavailable.');
        controller.onRequestRefresh = () => update(1);
        card.reviewRetry.click(); expect(requests()).toHaveLength(2);
        expect(card.reviewRetry.hidden).toBe(true);
        result(); expect(card.explanation.textContent).toBe("White's move stayed close to the previous evaluation in this search.");
    });
    it('reenables AI after an error while keeping facts, and can retry a cached selection', () => {
        update(1); result(); card.reviewAI.click(); result(last(),{},false);
        controller.handle({ type: 'REVIEW_ERROR', sessionId: session.id, requestId: last().requestId, tabId: 1, text: 'Review paused.' });
        expect(card.reviewAI.disabled).toBe(false);
        expect(card.explanation.textContent).toBe("White's move stayed close to the previous evaluation in this search.");
        update(1); expect(requests()).toHaveLength(2); expect(card.reviewRetry.hidden).toBe(false);
        controller.onRequestRefresh = () => update(1); card.reviewRetry.click();
        expect(requests()).toHaveLength(3); expect(last()).toMatchObject({ ply: 1, ai: true });
    });
    it('pauses a failed sweep without offering a selected-job retry', () => {
        update(1); result(); card.reviewSweep.click();
        controller.handle({ type: 'REVIEW_ERROR', sessionId: session.id, requestId: last().requestId, tabId: 1, text: 'Sweep paused.' });
        expect(card.reviewRetry.hidden).toBe(true);
        expect(card.reviewSweep.textContent).toBe('Analyze whole game');
        expect(card.explanation.textContent).toBe("White's move stayed close to the previous evaluation in this search.");
    });
    it('can request AI immediately after an error before another selection update', () => {
        update(1); result(); card.reviewAI.click();
        controller.handle({ type: 'REVIEW_ERROR', sessionId: session.id, requestId: last().requestId, tabId: 1, text: 'Paused.' });
        card.reviewAI.click(); const retry = last();
        update(1); result(retry,{},false);
        controller.handle({ type: 'REVIEW_TEXT', sessionId: session.id, requestId: retry.requestId, tabId: 1, text: 'Retry succeeded.' });
        expect(card.explanation.textContent).toBe('Retry succeeded.');
    });
    it('analyzes unselected moves without navigating or changing displayed feedback', () => {
        update(1); result(); const fen = board.innerHTML;
        card.reviewSweep.click(); expect(last()).toMatchObject({ ply: 2, background: true });
        result(); expect(last()).toMatchObject({ ply: 3, background: true });
        expect(card.heading.textContent).toBe('Pawn to E4 · Good'); expect(board.innerHTML).toBe(fen);
        card.reviewSweep.click(); expect(card.reviewSweep.textContent).toBe('Analyze whole game');
        expect(send).toHaveBeenCalledWith({ type: 'CANCEL' });
    });
    it('pauses a sweep before AI and keeps facts when AI is unavailable', () => {
        update(1); result(); card.reviewSweep.click(); const sweep = last();
        card.reviewAI.click(); const ai = last(); expect(ai).toMatchObject({ ply: 1, ai: true, background: false });
        expect(card.reviewSweep.textContent).toBe('Analyze whole game');
        result(sweep); result(ai,{},false);
        expect(last().requestId).toBe(ai.requestId);
        progress({state:'failed'},ai);
        expect(card.explanation.textContent).toBe("White's move stayed close to the previous evaluation in this search.");
        expect(card.reviewAI.disabled).toBe(false);
    });
    it('replaces the main explanation with validated optional wording and separate attribution', () => {
        update(1); result(); card.reviewAI.click(); result(last(),{},false);
        controller.handle({ type: 'REVIEW_TEXT', sessionId: session.id, requestId: last().requestId, tabId: 1, text: 'Short optional wording.', provider: 'Chrome AI' });
        expect(card.explanation.textContent).toBe('Short optional wording.');
        expect(card.reviewAIText.textContent).toBe('Explanation by Chrome AI');
    });
    it('clears and cancels on exit and replaces sessions without stale feedback', () => {
        update(1); const old = last(); controller.stop(); result(old);
        expect(controller.active).toBe(false); expect(card.reviewControls.hidden).toBe(true);
        expect(card.explanation.textContent).toBe('');
        controller.start({ ...session, id: 'new-session' }); update(1); result(old);
        expect(card.explanation.textContent).toBe(''); expect(last().sessionId).toBe('new-session');
    });
    it('exits an old review when another completed game identity is confirmed', () => {
        update(1); result();
        const refresh = vi.fn(); controller.onRequestRefresh = refresh;
        history.replaceState({}, '', '/game/live/456');
        controller.update(position(1), { ...snapshot(1), gameId: '456' });
        expect(controller.active).toBe(false); expect(card.reviewControls.hidden).toBe(true);
        expect(card.reviewButton.hidden).toBe(false); expect(card.explanation.textContent).toBe('');
        expect(refresh).toHaveBeenCalledOnce();
    });
    it('retains the same game across benign query and hash changes', () => {
        update(1); result();
        history.replaceState({}, '', '/game/live/123?view=analysis#move-1'); update(1);
        expect(controller.active).toBe(true); expect(requests()).toHaveLength(1);
        expect(card.explanation.textContent).toBe("White's move stayed close to the previous evaluation in this search.");
    });
});


it('makes cue meaning visible, preserves it with AI, and clears it on selection changes', () => {
    session = sessionFromMoves(['f3', 'e5', 'g4', 'Qh4#'], undefined, {url:location.href,gameId:'123',tabId:1}, '0-1');
    controller.start(session); update(3);
    const after = evaluation([{uci:'d8h4',san:'Qh4#',pv:'Qh4#',uciPv:['d8h4'],score:-100}]);
    result(last(), {after,feedback:{label:'Blunder',summary:'Opaque legacy feedback.',lossCp:250}});
    const section = card.reviewCueExplanation;
    expect(section.hidden).toBe(false);
    expect(section.textContent).toContain('White moved the pawn from G2 to G4');
    expect(section.textContent).toContain('Blunder: a major setback');
    expect(section.textContent).toContain("gold outline marks White's king");
    expect(section.textContent).toContain('Black can deliver checkmate with Qh4#');
    expect(section.querySelectorAll('.cue-sample')).toHaveLength(3);
    expect(section.querySelector('details')!.open).toBe(false);
    expect(card.alternatives.textContent).toContain('does not mean that many pawns were captured');
    expect(card.explanation.textContent).not.toContain('pawn units');
    card.showReviewAI('Optional explanation.');
    expect(section.hidden).toBe(false);
    controller.update(position(3, 'black'), snapshot(3));
    expect(section.textContent).toContain("gold outline marks White's king");
    update(2);
    expect(section.hidden).toBe(true); expect(section.textContent).toBe('');
    controller.stop(); expect(card.reviewControls.hidden).toBe(true);
});
