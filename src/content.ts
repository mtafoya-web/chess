import { readPosition, guidanceMode, type Position } from './adapters';
import { Card } from './card';
import { Overlay, candidateHeatmap, candidateArrows, rankedCandidates } from './overlay';
import { Chess } from 'chess.js';
import type { AnalysisEvent, Evaluation } from './types';
import { CardPlacement } from './card-placement';
import { InPageReviewController } from './in-page-review';
import type { NativeReviewSnapshot } from './site-review-types';
import type { ReviewEvent } from './review-types';
import { normalizedFen } from './chess';
import { resolveReviewPly, bindCapturedPosition } from './site-review';
import { buildBoardContext } from './board-context';
import { buildExplanationFacts } from './explanation-facts';
import { renderExplanation } from './coach-prompt';
import { isContentMessage, isBackgroundSender, isReviewSession } from './messages';
import { createDiagnosticReporter, diagnostic } from './diagnostics';
import { explanationStatus } from './explanation-state';
import { ContentRuntime } from './content-runtime';

const reportDiagnostic = createDiagnosticReporter(value => console.warn(value.code));
performance.mark('kibitz:content-init:start');

function normalizeSnapshot(snapshot?: NativeReviewSnapshot) {
    if (snapshot?.fen) {
        try { snapshot.fen = normalizedFen(snapshot.fen); }
        catch { snapshot.fen = undefined; snapshot.allowed = false; }
    }
    return snapshot;
}

let closed = false;
let revision = 0;
let position: Position | undefined;
let signature = '';
let requestId = '';
let text = '';
let result: Evaluation | undefined;
let reviewEvents = Promise.resolve();
const overlay = new Overlay();
const runtime = new ContentRuntime();
const send = (message: object) => runtime.send(message);
const card = new Card(() => {
    const cancelId = requestId;
    review.stop();
    closed = true; revision++; signature = ''; requestId = ''; result = undefined;
    card.host.remove(); overlay.clear(); if(cancelId)void send({ type: 'CANCEL',requestId:cancelId });
});
const placement = new CardPlacement(card.host);
const review = new InPageReviewController(card, overlay, send);
review.onRequestRefresh = () => { void update(); };
const reviewLayerChange = card.onReviewLayers;
card.onReviewLayers = () => {
    void send({ type: 'SET_OVERLAY_PREFERENCES', heatmap: card.heatmapToggle.checked, arrows: card.arrowsToggle.checked });
    if (review.active) reviewLayerChange(); else arrows();
};
void send({ type: 'GET_OVERLAY_PREFERENCES' }).then(preferences => {
    if (!runtime.available) return;
    card.heatmapToggle.checked = preferences?.heatmap !== false;
    card.arrowsToggle.checked = preferences?.arrows !== false;
    if (review.active) reviewLayerChange(); else arrows();
});
let publishedTheme = '';
function arrows() {
    if (review.active) { void update(); return; }
    if (guidanceMode(new URL(location.href)) !== 'analysis') { overlay.clear(); return; }
    if (position?.allowed && position.fen && result && !closed) {
        const heatmap = card.heatmapToggle.checked ? candidateHeatmap(rankedCandidates(result.candidates, new Chess(position.fen).turn(), position.fen), new Chess(position.fen).turn()) : [];
        overlay.setLayers(position.board, position.orientation, { heatmap, arrows: card.arrowsToggle.checked ? candidateArrows(result.candidates, position.fen) : [] });
        card.reviewLegend.textContent = result.candidates.length ? 'Arrows 1-3 rank alternative next moves; 1 is preferred. Colored destinations are analyzed candidates, not square safety ratings.' : '';
    }
    else overlay.clear();
}
card.onDetails = arrows;
card.onReview = () => {
    reviewNotice = '';
    card.status.textContent = 'Loading this completed game…';
    void send({ type: 'OPEN_REVIEW' }).then(response => {
        if (!runtime.available || closed) return;
        if (response?.error) card.status.textContent = response.error;
        else if (isReviewSession(response?.session)) { invalidate('Starting review…'); review.start(response.session); void update(true); }
    });
};
let reviewNotice = '';
let reviewUrl = '', reviewCheckedAt = 0, checkingReview = false;
async function reviewAvailability() {
    if (closed || document.visibilityState !== 'visible' || review.active || checkingReview) return;
    const page = location.href.split('#')[0];
    if (reviewUrl !== page) { reviewUrl = page; reviewCheckedAt = 0; reviewNotice = ''; }
    if (Date.now() - reviewCheckedAt < 2000) return;
    reviewCheckedAt = Date.now(); checkingReview = true;
    try {
        const response = await send({type:'REVIEW_AVAILABILITY'});
        if (closed || review.active || location.href.split('#')[0] !== page) return;
        card.reviewButton.hidden = response?.completed !== true;
        reviewNotice = response?.completed && response.error ? response.error : '';
        if (isReviewSession(response?.session)) {
            invalidate('Starting game review...'); review.start(response.session); void update(true);
        } else if (response?.completed && response.error) card.status.textContent = response.error;
    } finally { checkingReview = false; }
}
function attach(board: HTMLElement) {
    const lichess = location.hostname === 'lichess.org';
    placement.attach(board, lichess);
    const theme = card.theme(board, lichess);
    const key = JSON.stringify([location.href.split('#')[0], theme]);
    if (key !== publishedTheme) { publishedTheme = key; void send({ type: 'SITE_THEME', theme }); }
}
function invalidate(status: string) {
    if (requestId) void send({ type: 'CANCEL',requestId });
    requestId = ''; signature = ''; text = ''; result = undefined; overlay.clear(); card.clear(status);
}
async function update(force = false) {
    if (!runtime.available || closed) return;
    const updateRevision = ++revision;
    position = readPosition();
    // Home, account and history-list pages normally have no board.
    if (!position) { review.update(undefined, undefined); invalidate('Open a study board to begin.'); card.host.remove(); return; }
    attach(position.board);
    void reviewAvailability();
    if (document.visibilityState !== 'visible') { review.update(undefined, undefined); invalidate('Paused while this tab is hidden.'); return; }
    let native: NativeReviewSnapshot | undefined;
    if (review.active || !position.fen || !position.allowed) {
        const response = await send({ type: 'NATIVE_REVIEW_REQUEST' });
        if (closed || updateRevision !== revision) return;
        native = normalizeSnapshot(response?.snapshot);
        if (native && review.session) native = bindCapturedPosition(review.session,native,position);
        position = readPosition(document, new URL(location.href), native?.fen, native);
        if (!position) { invalidate('Waiting for a board…'); return; }
    }
    if (review.active) { review.update(position, native); return; }
    const analysis = guidanceMode(new URL(location.href)) === 'analysis';
    card.layerControls.hidden = !analysis;
    if (!analysis) { invalidate(reviewNotice || 'Finished games are reviewed automatically. You can also choose Review with Kibitz.'); return; }
    if (!position.allowed || !position.fen) { reportDiagnostic(diagnostic('UNSUPPORTED_BOARD_STATE')); invalidate(position.status); return; }
    const next = `${location.href}|${position.fen}`;
    if (next === signature && !force) { arrows(); return; }
    invalidate('Finding a move…');
    signature = next; requestId = crypto.randomUUID();
    const id = requestId;
    const response = await send({ type: 'ANALYSIS_REQUEST', requestId, fen: position.fen, orientation: position.orientation });
    if (response?.error && requestId === id) card.status.textContent = response.error;
}
const onMessage = (payload: unknown, sender: chrome.runtime.MessageSender) => {
    if (!runtime.available || !isBackgroundSender(sender) || !isContentMessage(payload)) return;
    const message = payload;
    if (message.type === 'REVIEW_STATE_CHANGED') { if (review.session?.id===message.sessionId) void review.syncState(); return; }
    if (message.type === 'REVIEW_CONTROL') { review.control(message); return; }
    if (message.type === 'REVIEW_LOADED') {
        closed = false; invalidate('Starting review…'); review.start(message.session); void update(true); return;
    }
    if (message.type.startsWith('REVIEW_')) {
        const event = message as ReviewEvent;
        if (event.requestId.startsWith('sweep-')) return;
        // Keep final provider status behind the asynchronous position checks for
        // facts/text; otherwise a fast cached response can finish before its text.
        reviewEvents = reviewEvents.then(async () => {
            if (closed || !review.active) return;
            if (event.type === 'REVIEW_PRACTICE_RESULT' || event.type === 'REVIEW_RESULT' || event.type === 'REVIEW_TEXT' || event.type === 'REVIEW_EXPLANATION_STATE') {
                const expectedUrl = location.href;
                const response = await send({ type: 'NATIVE_REVIEW_REQUEST' });
                if (closed || location.href !== expectedUrl || !review.active) return;
                let native = normalizeSnapshot(response?.snapshot);
                if (native && review.session && position) native = bindCapturedPosition(review.session,native,position);
                position = readPosition(document, new URL(location.href), native?.fen, native);
                review.update(position, native);
            }
            review.handle(event);
        }).catch(() => { if (review.active) card.status.textContent = 'Waiting for a verified website position.'; });
        return;
    }
    if (message.type === 'REOPEN') { closed = false; void update(true); return; }
    if (message.type === 'REFRESH') { review.visibility(document.visibilityState==='visible'); review.refreshExplanations(); void update(true); return; }
    const event = message as AnalysisEvent;
    if (closed || event.requestId !== requestId || document.visibilityState !== 'visible') return;
    if (event.type === 'ENGINE_RESULT') {
        result = event.result; card.show(result, position?.fen);
        if (position?.fen) {
            card.showPositionFacts(buildBoardContext(position.fen));
            const catalog = buildExplanationFacts(position.fen, result);
            card.showOpening(catalog.opening);
            card.explain(renderExplanation(catalog));
        }
        arrows();
    }
    if (event.type === 'STATUS') card.status.textContent = event.text;
    if (event.type === 'EXPLANATION_STATE' && event.fen === position?.fen) {
        card.status.textContent = explanationStatus(event);
        if (event.state === 'ready' || event.state === 'fallback') card.reviewAIText.textContent = explanationStatus(event);
    }
    if (event.type === 'ERROR') card.status.textContent = result ? 'Move ready. Check explanation settings.' : 'Analysis unavailable. Check settings to try again.';
    if (event.type === 'STREAM_CHUNK') {
        text += event.textDelta; card.explain(text);
        if (event.isComplete) card.status.textContent = '';
    }
};
chrome.runtime.onMessage.addListener(onMessage);
let timer: ReturnType<typeof setTimeout>;
const schedule = () => {
    if (!runtime.available) return;
    clearTimeout(timer); timer = setTimeout(() => { void update(); }, 250);
};
const observer = new MutationObserver(mutations => {
    if (!runtime.available) return;
    if (mutations.some(m => !card.host.contains(m.target) && m.target !== overlay.svg && !overlay.svg.contains(m.target))) {
        // Clear outdated recommendations immediately, before the debounce settles.
        if (mutations.some(m => position?.board.contains(m.target))) {
            if (review.active) review.update(undefined, undefined);
            const next = readPosition(document, new URL(location.href), position?.fen);
            if (requestId && (!next?.allowed || next.fen !== position?.fen)) invalidate('Position changed…');
        }
        if (review.active && mutations.some(m => m.target instanceof Element && m.target.closest('.move-list,.vertical-move-list,.analyse__moves,.tview2,.round__moves'))) review.update(undefined, undefined);
        schedule();
    }
});
observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
const onVisibility = () => { if (runtime.available) { review.visibility(document.visibilityState==='visible'); void update(true); } };
document.addEventListener('visibilitychange', onVisibility);
window.addEventListener('resize', schedule, { passive: true });
const colorScheme = window.matchMedia('(prefers-color-scheme: dark)');
colorScheme.addEventListener('change', schedule);
// Site panels can resize the board without resizing the browser window.
let observedBoard: HTMLElement | undefined;
const boardResize = new ResizeObserver(schedule);
const heartbeat = setInterval(() => {
    if (!runtime.available) return;
    if (url !== location.href) { url = location.href; schedule(); }
    if (position?.board) void reviewAvailability();
    if (position?.board !== observedBoard) {
        boardResize.disconnect(); observedBoard = position?.board;
        if (observedBoard) {
            boardResize.observe(observedBoard);
            if (observedBoard.parentElement) boardResize.observe(observedBoard.parentElement);
        }
    }
}, 750);
window.addEventListener('popstate', schedule);
let disposed = false;
function dispose() {
    if (disposed) return;
    disposed = true; closed = true; revision++;
    clearInterval(heartbeat); clearTimeout(timer);
    observer.disconnect(); boardResize.disconnect();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('popstate', schedule);
    window.removeEventListener('pagehide', dispose);
    colorScheme.removeEventListener('change', schedule);
    try { chrome.runtime.onMessage.removeListener(onMessage); } catch { /* Already unloaded. */ }
    review.stop(true); placement.destroy(); overlay.destroy(); card.host.remove();
    if(requestId)void send({ type: 'CANCEL',requestId });
    requestId = ''; position = undefined; result = undefined;
}
window.addEventListener('pagehide', dispose);
runtime.onInvalidated(dispose);
// pushState does not emit popstate. A slow URL-only check covers SPA navigation.
let url = location.href;
performance.mark('kibitz:content-init:end');
performance.measure('kibitz:content-init', 'kibitz:content-init:start', 'kibitz:content-init:end');
void (async () => {
    // Restore a captured session for this game. Selected-move guidance still
    // requires an independently verified native position.
    try {
        const response = await send({type:'GET_REVIEW_STATE'});
        if (response?.state?.active !== false && isReviewSession(response?.state?.session)) {
            const native = normalizeSnapshot((await send({type:'NATIVE_REVIEW_REQUEST'}))?.snapshot);
            if (native && (native.gameId===response.state.session.source?.gameId || response.state.session.source?.gameId==='study' && resolveReviewPly(response.state.session,native)!==undefined) && !closed) {
                if (response.state.session.selectedPly!==resolveReviewPly(response.state.session,native)) await send({type:'NATIVE_REVIEW_NAVIGATE',direction:'select',ply:response.state.session.selectedPly});
                review.start(response.state.session);
            }
        }
    } catch { /* Ordinary study remains available without saved state. */ }
    await update();
})();
