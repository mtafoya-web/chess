import { ReviewLibrary, recordAssessment, recordPractice, validPreferences } from './review-library';
import { DEFAULT_REVIEW_PREFERENCES } from './review-scoring';
import { reviewFingerprint, type ReviewState } from './review-model';
import { playUci } from './chess';
import { Chess } from 'chess.js';
import { diagnostic } from './diagnostics';
import { loadExecutionSettings, loadPanelSettings, savePanelSettings } from './settings';
import { type BackgroundRequest, record, publicTypes, isBackgroundRequest, isAnalysisEvent, contextFor, canSendRequest } from './messages';
import { normalizedFen } from './chess';
import { readPageFen } from './page-position';
import { ORIGINS, type AnalysisEvent, type MoveAnalysisRequest } from './types';
import { readGameSnapshot, captureSession, completeGameSnapshot } from './game-capture';
import { sessionFromMoves } from './review-session';
import { sessionFromPgn } from './review-session';
import type { ReviewEvent, ReviewRequest, ReviewSession } from './review-types';
import { readNativeReview, resolveReviewPly, navigateNativeReview } from './site-review';
import { readNativeEngine } from './site-engine';
import { normalizeNativeEngine } from './analysis-sources';
import { isSiteTheme, themePageUrl } from './theme';

class SafeRequestError extends Error {}
let creating: Promise<void> | undefined;
let serial = Promise.resolve();
let generation = 0;
let pendingTabId: number | undefined;
let active: { requestId: string; tabId: number; manual: boolean; sessionId?: string } | undefined;
const panels = new Set<chrome.runtime.Port>();
const library = new ReviewLibrary();
const reviewStates = new Map<number, ReviewState>();
const stateLoads = new Map<number, Promise<ReviewState | undefined>>();
const deletedReviews = new Set<string>();
const reviewJobs = new Map<string, { tabId: number; sessionId: string; ai: boolean }>();
const saveTimers = new Map<number, ReturnType<typeof setTimeout>>();
async function stateFor(tabId: number): Promise<ReviewState | undefined> {
    const loading = stateLoads.get(tabId);
    if (loading) return loading;
    const work = loadState(tabId).finally(() => stateLoads.delete(tabId));
    stateLoads.set(tabId, work);
    return work;
}
async function loadState(tabId: number): Promise<ReviewState | undefined> {
    const saved = (await chrome.storage.session.get(`siteReview:${tabId}`))[`siteReview:${tabId}`] as ReviewSession | undefined;
    if (!saved) return;
    let state = reviewStates.get(tabId);
    if (!state || state.session.id !== saved.id) {
        state = await library.open(saved);
        const preferences = (await chrome.storage.local.get('reviewPreferencesV2')).reviewPreferencesV2;
        if (validPreferences(preferences)) state.preferences = preferences;
        reviewStates.set(tabId, state);
    }
    return state;
}
function saveReview(tabId: number) {
    clearTimeout(saveTimers.get(tabId));
    saveTimers.set(tabId, setTimeout(() => {
        saveTimers.delete(tabId); const state = reviewStates.get(tabId);
        if (state && !deletedReviews.has(reviewFingerprint(state.session))) void library.save(state).catch(() => {
            for (const port of panels) { try { port.postMessage({type:'REVIEW_ERROR',sessionId:state.session.id,requestId:'storage',tabId,manual:false,text:'Review is ready, but history could not be saved. Free storage or clear old reviews.'}); } catch {} }
        });
    }, 350));
}

async function nativeAdvice(tabId: number, fen: string, url?: string) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([readNativeAdvice(tabId, fen, url), new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), 500); })]); }
    finally { clearTimeout(timer); }
}
async function readNativeAdvice(tabId: number, fen: string, url?: string) {
    if (!url?.startsWith('https://lichess.org/')) return;
    try {
        const before = (await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: readNativeReview }))[0]?.result;
        if (!before?.allowed || before.url !== url || !before.fen || normalizedFen(before.fen) !== fen) return;
        const raw = (await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: readNativeEngine }))[0]?.result;
        if (!raw) return;
        const after = (await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: readNativeReview }))[0]?.result;
        if (!after?.allowed || after.url !== url || !after.fen || normalizedFen(after.fen) !== fen || after.path !== before.path) return;
        return normalizeNativeEngine(raw, { fen, url, path: after.path })?.evaluation;
    } catch { return; }
}
async function ensureOffscreen() {
    const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
    if (contexts.length) return;
    if (!creating) creating = chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: [chrome.offscreen.Reason.WORKERS], justification: 'Run locally packaged Stockfish in a Web Worker.' }).finally(() => { creating = undefined; });
    await creating;
}
async function currentTab() { return (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]; }
async function cancel(tabId?: number) {
    if (tabId !== undefined && active?.tabId !== tabId && pendingTabId !== tabId) return;
    if (active?.sessionId) broadcast({ type: 'REVIEW_ERROR', requestId: active.requestId, sessionId: active.sessionId, tabId: active.tabId, text: 'Review paused. Select a move or restart game analysis to continue.' }, active.manual);
    reviewJobs.clear();
    generation++; active = undefined; pendingTabId = undefined;
    await chrome.storage.session.remove('activeAnalysis');
    await chrome.runtime.sendMessage({ target: 'offscreen', type: 'ENGINE_CANCEL' }).catch(() => {});
}
function broadcast(event: AnalysisEvent | ReviewEvent, manual: boolean) {
    if (!manual) void chrome.tabs.sendMessage(event.tabId, event).catch(() => {});
    for (const panel of panels) { try { panel.postMessage({ ...event, manual }); } catch { panels.delete(panel); } }
}
async function start(request: MoveAnalysisRequest, tabId: number, manual: boolean) {
    if (active?.sessionId) broadcast({ type: 'REVIEW_ERROR', requestId: active.requestId, sessionId: active.sessionId, tabId: active.tabId, text: 'Review paused for position analysis. Select a move to resume.' }, active.manual);
    reviewJobs.clear();
    const turn = ++generation;
    pendingTabId = tabId;
    const fen = normalizedFen(request.fen);
    await ensureOffscreen();
    if (turn !== generation) return;
    await chrome.runtime.sendMessage({ target: 'offscreen', type: 'ENGINE_CANCEL' });
    const settings = await loadExecutionSettings();
    if (turn !== generation) return;
    const nativeEvaluation = !manual && settings.analysisSource !== 'local' ? await nativeAdvice(tabId, fen, (await chrome.tabs.get(tabId)).url) : undefined;
    if (turn !== generation) return;
    active = { requestId: request.requestId, tabId, manual };
    pendingTabId = undefined;
    await chrome.storage.session.set({ activeAnalysis: active });
    if (turn !== generation) return;
    await chrome.runtime.sendMessage({ ...request, target: 'offscreen', type: 'ENGINE_START', fen, tabId, manual, settings, nativeEvaluation });
}
function enqueue(request: MoveAnalysisRequest, tabId: number, manual: boolean) {
    if (active?.manual && !manual) return;
    // Start immediately; generation guards async setup, offscreen cancels the preceding search.
    void start(request, tabId, manual).catch(() => broadcast({ type: 'ERROR', requestId: request.requestId, tabId, text: 'Unable to start analysis.' }, manual));
}
async function captureGame(tab: chrome.tabs.Tab | undefined) {
    if (!tab?.id || !tab.url || !/^https:\/\/(www\.chess\.com|lichess\.org)\//.test(tab.url)) throw new SafeRequestError('Select a completed game from your Chess.com or Lichess game history first.');
    const identity = tab.url;
    const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: readGameSnapshot });
    let snapshot = results[0]?.result;
    if (!snapshot) throw new SafeRequestError('Open the finished game itself from history, then try again. You can also import its PGN.');
    if (snapshot.url !== identity) throw new SafeRequestError('The selected game changed. Open it and try again.');
    if (!snapshot.completed) throw new SafeRequestError('A finished game is not ready on this page yet. Wait for it to load, or import its PGN.');
    snapshot = await completeGameSnapshot(snapshot);
    const [after, confirmed] = await Promise.all([chrome.tabs.get(tab.id), chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: readGameSnapshot })]);
    const fresh = confirmed[0]?.result;
    if (after.url !== identity || !fresh?.completed || fresh.gameId !== snapshot.gameId || fresh.url !== identity || (fresh.result && snapshot.result && fresh.result !== snapshot.result)) throw new SafeRequestError('The selected game changed. Open it and try again.');
    const session = captureSession(snapshot);
    deletedReviews.delete(reviewFingerprint(session));
    await library.allow(session);
    session.source = { ...session.source!, tabId: tab.id };
    await chrome.storage.session.set({ [`siteReview:${tab.id}`]: session });
    return session;
}
async function startReview(request: ReviewRequest, tabId: number, turn = ++generation) {
    pendingTabId = tabId;
    if (typeof request.sessionId !== 'string' || request.sessionId.length > 120 || typeof request.requestId !== 'string' || request.requestId.length > 120 || !Array.isArray(request.moves) || request.moves.length > 1500 || !Number.isInteger(request.ply) || request.ply < 0 || request.ply > request.moves.length) throw new SafeRequestError('Invalid review request.');
    // Replay independently in the trusted context before sending work to Stockfish.
    sessionFromMoves(request.moves, request.initialFen);
    await ensureOffscreen();
    if (turn !== generation) return;
    if (!request.background) { reviewJobs.clear(); await chrome.runtime.sendMessage({ target: 'offscreen', type: 'ENGINE_CANCEL' }); }
    const settings = await loadExecutionSettings();
    if (turn !== generation) return;
    const reviewState = await stateFor(tabId);
    if (turn !== generation) return;
    request = {...request,level:reviewState?.preferences.level??'beginner'};
    reviewJobs.set(request.requestId, { tabId, sessionId: request.sessionId, ai: request.ai !== false && !request.attempt });
    active = { requestId: request.requestId, tabId, manual: false, sessionId: request.sessionId };
    pendingTabId = undefined;
    await chrome.storage.session.set({ activeAnalysis: active });
    if (turn !== generation) return;
    await chrome.runtime.sendMessage({ target: 'offscreen', type: 'REVIEW_START', request, tabId, manual: false, settings });
}
void chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
void chrome.storage.sync.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
void chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
chrome.action.onClicked.addListener(tab => { if (tab.id) void chrome.tabs.sendMessage(tab.id, { type: 'REOPEN' }).catch(() => {}); });
chrome.runtime.onConnect.addListener(port => {
    if (port.name !== 'panel' || !port.sender || contextFor(port.sender) !== 'panel') return;
    panels.add(port);
    port.onDisconnect.addListener(() => {
        panels.delete(port);
        if (!panels.size && active?.manual) void cancel();
    });
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (!record(message)) { respond({ error: 'Invalid request.', diagnostic: diagnostic('PROTOCOL_INVALID') }); return; }
    if (message.target === 'offscreen') return;
    const context = contextFor(sender);
    const panel = context === 'panel';
    const offscreen = context === 'offscreen';
    if (message.type === 'PROVIDER_PERMISSION') {
        if (!offscreen) { respond({ error: 'Unauthorized request.', diagnostic: diagnostic('PROTOCOL_UNAUTHORIZED') }); return; }
        if (typeof message.origin !== 'string' || !Object.values(ORIGINS).includes(message.origin)) { respond({ error: 'Invalid request.', diagnostic: diagnostic('PROTOCOL_INVALID') }); return; }
        void chrome.permissions.contains({ origins: [message.origin] }).then(granted => respond({ granted }), () => respond({ granted: false }));
        return true;
    }
    if (message.target === 'background' && message.event) {
        if (!offscreen) { respond({ error: 'Unauthorized request.', diagnostic: diagnostic('PROTOCOL_UNAUTHORIZED') }); return; }
        if (!isAnalysisEvent(message.event) || typeof message.manual !== 'boolean') { respond({ error: 'Invalid request.', diagnostic: diagnostic('PROTOCOL_INVALID') }); return; }
        const eventGeneration = generation;
        serial = serial.then(async () => {
            const incoming = message.event as AnalysisEvent | ReviewEvent;
            if (eventGeneration !== generation && !reviewJobs.has(incoming.requestId)) return;
            const saved = (await chrome.storage.session.get('activeAnalysis')).activeAnalysis as typeof active;
            if (eventGeneration !== generation && !reviewJobs.has(incoming.requestId)) return;
            if (!active && saved && typeof saved.requestId === 'string' && typeof saved.tabId === 'number' && typeof saved.manual === 'boolean') active = saved;
            const event = message.event as AnalysisEvent | ReviewEvent;
            const reviewJob = reviewJobs.get(event.requestId);
            const authorizedReview = 'sessionId' in event && reviewJob?.tabId === event.tabId && reviewJob.sessionId === event.sessionId && message.manual === false;
            if (authorizedReview || active?.requestId === event.requestId && active.tabId === event.tabId && active.manual === message.manual && (!('sessionId' in event) || event.sessionId === active.sessionId)) {
                if (event.type === 'REVIEW_RESULT') {
                    const state = await stateFor(event.tabId);
                    if (state?.session.id === event.sessionId) { recordAssessment(state, event); saveReview(event.tabId); }
                }
                if (event.type === 'REVIEW_OPENING') {
                    const state = await stateFor(event.tabId);
                    const assessment = state?.assessments.find(a=>a.ply===event.ply);
                    if (state?.session.id===event.sessionId && assessment) {assessment.opening=event.opening;state.updatedAt=Date.now();saveReview(event.tabId);}
                }
                broadcast(event, authorizedReview ? false : active!.manual);
                if (event.type === 'REVIEW_EXPLANATION_STATE' && event.state !== 'pending' || event.type === 'REVIEW_ERROR' || event.type === 'REVIEW_PRACTICE_RESULT') reviewJobs.delete(event.requestId);
                if (event.type === 'REVIEW_ENGINE_COMPLETE' && reviewJob && !reviewJob.ai) reviewJobs.delete(event.requestId);
                if (active?.manual && !active.sessionId && (event.type === 'ERROR' || event.type === 'ENGINE_RESULT' && event.result.terminal || event.type === 'EXPLANATION_STATE' && event.state !== 'pending')) {
                    active = undefined; await chrome.storage.session.remove('activeAnalysis');
                }
            }
        }).catch(() => {});
        return;
    }
    if (typeof message.type !== 'string' || !publicTypes.has(message.type)) return;
    if (!isBackgroundRequest(message)) { respond({ error: 'Invalid request.', diagnostic: diagnostic('PROTOCOL_INVALID') }); return; }
    if ((context !== 'panel' && context !== 'content') || !canSendRequest(message, context)) { respond({ error: 'Unauthorized request.', diagnostic: diagnostic('PROTOCOL_UNAUTHORIZED') }); return; }
    const request = message as BackgroundRequest;
    const run = async () => {
        const tab = await currentTab();
        if (!panel && tab?.id !== sender.tab?.id) return { error: 'Unauthorized request.' };
        if (request.type === 'GET_REVIEW_PREFERENCES') return {preferences:(await chrome.storage.local.get('reviewPreferencesV2')).reviewPreferencesV2??DEFAULT_REVIEW_PREFERENCES};
        if (request.type === 'SET_REVIEW_PREFERENCES') {
            await chrome.storage.local.set({reviewPreferencesV2:request.preferences});
            if(tab?.id){const state=await stateFor(tab.id);if(state){state.preferences=request.preferences;saveReview(tab.id);await chrome.tabs.sendMessage(tab.id,{type:'REVIEW_CONTROL',sessionId:state.session.id,action:'preferences',preferences:request.preferences}).catch(()=>{});}}
            return {ok:true};
        }
        if (request.type === 'DISMISS_LEVEL_SUGGESTION') { await chrome.storage.local.set({levelSuggestionAfter:request.after});return {ok:true}; }
        if (request.type === 'GET_REVIEW_STATE') {
            const state = tab?.id ? await stateFor(tab.id) : undefined;
            if (!state || !tab?.url || !state.session.source) return {};
            const page = new URL(tab.url), source = new URL(state.session.source.url);
            return page.origin === source.origin && page.pathname === source.pathname ? {state} : {};
        }
        if (request.type === 'GET_LEARNING_HISTORY') return { history: await library.list(), suggestionAfter:(await chrome.storage.local.get('levelSuggestionAfter')).levelSuggestionAfter??0 };
        if (request.type === 'DELETE_LEARNING_HISTORY') {
            for (const [id, state] of reviewStates) {
                const key = reviewFingerprint(state.session);
                if (!request.key || key === request.key) { deletedReviews.add(key); clearTimeout(saveTimers.get(id)); saveTimers.delete(id); state.attempts = []; }
            }
            await library.remove(request.key);
            return { ok: true };
        }
        if (request.type === 'REVIEW_VIEW' || request.type === 'REVIEW_PRACTICE_RECORD' || request.type === 'REVIEW_CONTROL') {
            if (!tab?.id) return {error:'Open the reviewed game first.'};
            const state = await stateFor(tab.id);
            if (!state || state.session.id !== request.sessionId) return {error:'The selected game changed. Start its review again.'};
            if (request.type === 'REVIEW_VIEW') {
                if (request.ply > state.session.moves.length) return {error:'Invalid selected move.'};
                if (request.practicePly !== undefined && request.practicePly > state.session.moves.length) return {error:'Invalid exercise.'};
                state.session.selectedPly=request.ply;state.running=request.running;state.practicePly=request.practicePly;state.active=request.active??true;saveReview(tab.id);return {ok:true};
            }
            if (request.type === 'REVIEW_PRACTICE_RECORD') {
                if (request.ply > state.session.moves.length) return {error:'Invalid exercise.'};
                recordPractice(state,{ply:request.ply,outcome:request.outcome,at:Date.now()});saveReview(tab.id);return {ok:true};
            }
            if (request.action === 'preferences' && request.preferences) {
                state.preferences=request.preferences;await chrome.storage.local.set({reviewPreferencesV2:request.preferences});saveReview(tab.id);
            }
            await chrome.tabs.sendMessage(tab.id,request);return {ok:true};
        }
        if (request.type === 'GET_SETTINGS') return loadPanelSettings();
        if (request.type === 'TEST_AI') {
            await ensureOffscreen();
            return chrome.runtime.sendMessage({target:'offscreen',type:'EXPLANATION_TEST',settings:await loadExecutionSettings()});
        }
        if (request.type === 'SAVE_SETTINGS') return savePanelSettings(request);
        if (request.type === 'GET_OVERLAY_PREFERENCES') {
            const saved = (await chrome.storage.local.get('overlayPreferences')).overlayPreferences as { heatmap?: boolean; arrows?: boolean } | undefined;
            return { heatmap: saved?.heatmap !== false, arrows: saved?.arrows !== false };
        }
        if (request.type === 'SET_OVERLAY_PREFERENCES' && (panel || sender.frameId === 0 && tab?.id === sender.tab?.id)) {
            if (typeof request.heatmap !== 'boolean' || typeof request.arrows !== 'boolean') throw new SafeRequestError('Invalid overlay preferences.');
            await chrome.storage.local.set({ overlayPreferences: { heatmap: request.heatmap, arrows: request.arrows } });
            return { ok: true };
        }
        if (!panel && request.type === 'SITE_THEME' && sender.frameId === 0 && tab?.id === sender.tab?.id && isSiteTheme(request.theme)) {
            if (!sender.url || !tab.url || themePageUrl(sender.url) !== themePageUrl(tab.url)) return { ok: false };
            const url = themePageUrl(sender.url);
            await chrome.storage.session.set({ [`siteTheme:${tab.id}`]: { url, theme: request.theme } });
            for (const port of panels) { try { port.postMessage({ type: 'SITE_THEME', tabId: tab.id, url, theme: request.theme }); } catch {} }
            return { ok: true };
        }
        if (panel && request.type === 'GET_SITE_THEME') {
            const saved = (tab?.id ? (await chrome.storage.session.get(`siteTheme:${tab.id}`))[`siteTheme:${tab.id}`] : undefined) as { url?: string; theme?: unknown } | undefined;
            const url = themePageUrl(tab?.url ?? '');
            return { tabId: tab?.id ?? -1, url, theme: saved?.url && themePageUrl(saved.url) === url && isSiteTheme(saved.theme) ? saved.theme : undefined };
        }
        if (panel && request.type === 'CAPTURE_GAME') return { session: await captureGame(tab) };
        if (panel && (request.type === 'START_PAGE_REVIEW' || request.type === 'IMPORT_PAGE_REVIEW')) {
            if (!tab?.id || !tab.url || !/^https:\/\/(www\.chess\.com|lichess\.org)\//.test(tab.url)) throw new SafeRequestError('Open a supported completed game or study board first.');
            let session: ReviewSession;
            if (request.type === 'IMPORT_PAGE_REVIEW') {
                const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: readNativeReview });
                const native = results[0]?.result;
                if (!native?.allowed) throw new SafeRequestError('Open a completed game or study board before applying a PGN.');
                session = sessionFromPgn(request.pgn, { url: tab.url, gameId: native.gameId ?? 'study', tabId: tab.id });
                deletedReviews.delete(reviewFingerprint(session));
                await library.allow(session);
                if (resolveReviewPly(session, native) === undefined) throw new SafeRequestError('This PGN does not match the position selected on the website. Select a matching mainline move and try again.');
                await chrome.storage.session.set({ [`siteReview:${tab.id}`]: session });
            } else session = await captureGame(tab);
            await chrome.tabs.sendMessage(tab.id, { type: 'REVIEW_LOADED', session });
            return { ok: true, title: session.title };
        }
        if (!panel && request.type === 'REVIEW_AVAILABILITY' && tab?.id === sender.tab!.id && sender.frameId === 0) {
            const results = await chrome.scripting.executeScript({ target: { tabId: tab.id! }, world: 'MAIN', func: readGameSnapshot });
            const snapshot = results[0]?.result;
            return { completed: snapshot?.completed === true, url: snapshot?.url };
        }
        if (!panel && request.type === 'OPEN_REVIEW' && tab?.id === sender.tab!.id && sender.frameId === 0) {
            return { session: await captureGame(tab) };
        }
        if (!panel && request.type === 'NATIVE_REVIEW_REQUEST' && tab?.id === sender.tab!.id && sender.frameId === 0) {
            const result = await chrome.scripting.executeScript({ target: { tabId: tab.id! }, world: 'MAIN', func: readNativeReview });
            return { snapshot: result[0]?.result };
        }
        if (!panel && request.type === 'NATIVE_REVIEW_NAVIGATE' && tab?.id === sender.tab!.id && sender.frameId === 0) {
            if (!['previous', 'next', 'first', 'last', 'select'].includes(request.direction)) throw new SafeRequestError('Invalid native navigation request.');
            const result = await chrome.scripting.executeScript({ target: { tabId: tab.id! }, world: 'MAIN', func: navigateNativeReview, args: [{ direction: request.direction, ply: request.ply, expectedUrl: sender.url! }] });
            if (!result[0]?.result?.ok) return {ok:false};
            const saved=(await chrome.storage.session.get(`siteReview:${tab.id}`))[`siteReview:${tab.id}`] as ReviewSession | undefined;
            for (let attempt=0;attempt<6;attempt++) {
                const snapshot=(await chrome.scripting.executeScript({target:{tabId:tab.id!},world:'MAIN',func:readNativeReview}))[0]?.result;
                if (saved && snapshot && resolveReviewPly(saved,snapshot) === (request.direction === 'first' ? 0 : request.ply)) return {ok:true};
                await new Promise(resolve=>setTimeout(resolve,60));
            }
            return {ok:false};
        }
        if (!panel && request.type === 'REVIEW_ANALYZE' && tab?.id === sender.tab!.id && sender.frameId === 0) {
            const turn = ++generation;
            pendingTabId = tab.id;
            const key = `siteReview:${tab.id}`;
            const saved = (await chrome.storage.session.get(key))[key] as ReviewSession | undefined;
            if (turn !== generation) return { ok: true };
            if (!saved || saved.id !== request.sessionId || saved.initialFen !== request.initialFen || JSON.stringify(saved.moves.map(move => move.uci)) !== JSON.stringify(request.moves)) throw new SafeRequestError('Start review for this selected game first.');
            const results = await chrome.scripting.executeScript({ target: { tabId: tab.id! }, world: 'MAIN', func: readNativeReview });
            const native = results[0]?.result;
            if (turn !== generation) return { ok: true };
            if (!native?.allowed || resolveReviewPly(saved, native) === undefined) throw new SafeRequestError('Waiting for a verified position on the website board.');
            // Full-game jobs may evaluate other plies but never navigate the native board.
            if (request.attempt) {
                const selected=resolveReviewPly(saved,native);
                if (!request.ply || selected !== request.ply && selected !== request.ply-1) throw new SafeRequestError('Return to the exercise position before checking your answer.');
                const board=new Chess(saved.moves[request.ply-1].beforeFen);playUci(board,request.attempt);
            }
            if (!request.attempt && !request.background && resolveReviewPly(saved, native) !== request.ply) throw new SafeRequestError('The selected move changed.');
            await startReview(request as ReviewRequest, tab.id!, turn);
            return { ok: true };
        }
        if (request.type === 'POSITION_REQUEST' && !panel && tab?.id === sender.tab!.id && sender.frameId === 0) {
            const results = await chrome.scripting.executeScript({ target: { tabId: tab.id! }, world: 'MAIN', func: readPageFen });
            const fen = results[0]?.result;
            return { fen: typeof fen === 'string' ? normalizedFen(fen) : undefined };
        } else if (request.type === 'ANALYSIS_REQUEST') {
            if (typeof request.requestId !== 'string' || typeof request.fen !== 'string' || request.fen.length > 200) throw new SafeRequestError('Invalid analysis request.');
            if (panel) {
                if (!panels.size) throw new SafeRequestError('Open the side panel first.');
                enqueue(request, tab?.id ?? -1, true);
            } else if (tab?.id === sender.tab!.id && sender.frameId === 0) enqueue(request, sender.tab!.id!, false);
        } else if (request.type === 'CANCEL') {
            if (panel || !active?.manual) await cancel(panel ? undefined : sender.tab!.id);
        }
        else if (panel && request.type === 'REOPEN' && tab?.id) await chrome.tabs.sendMessage(tab.id, { type: 'REOPEN' });
        else if (panel && request.type === 'SETTINGS_CHANGED') {
            await cancel();
            await chrome.runtime.sendMessage({ target: 'offscreen', type: 'EXPLANATION_RESET' }).catch(() => {});
            const tabs = await chrome.tabs.query({ url: ['https://www.chess.com/*', 'https://lichess.org/*'] });
            await Promise.allSettled(tabs.filter(t => t.id !== undefined).map(t => chrome.tabs.sendMessage(t.id!, { type: 'REFRESH' })));
        }
        return { ok: true };
    };
    void run().then(respond, error => respond({
        error: error instanceof SafeRequestError ? error.message : request.type === 'SAVE_SETTINGS' ? 'Could not save settings. Try again.' : 'Request failed. Try again.',
        diagnostic: diagnostic(request.type === 'SAVE_SETTINGS' ? 'SETTINGS_SAVE_FAILED' : 'PROTOCOL_INVALID'),
    }));
    return true;
});
chrome.tabs.onActivated.addListener(() => {
    if (active?.sessionId && active.manual) return;
    void cancel().then(async () => { const tab = await currentTab(); if (tab?.id) await chrome.tabs.sendMessage(tab.id, { type: 'REFRESH' }).catch(() => {}); });
});
chrome.tabs.onRemoved.addListener(tabId => { void cancel(tabId); });
chrome.windows.onFocusChanged.addListener(() => { if (active?.sessionId && active.manual) return; void cancel().then(async () => { const tab = await currentTab(); if (tab?.id) await chrome.tabs.sendMessage(tab.id, { type: 'REFRESH' }).catch(() => {}); }); });
