import { ReviewLibrary, recordAssessment, recordPractice, validPreferences } from './review-library';
import { DEFAULT_REVIEW_PREFERENCES } from './review-scoring';
import { reviewFingerprint, matchingGame, type ReviewState } from './review-model';
import { playUci } from './chess';
import { Chess } from 'chess.js';
import { diagnostic } from './diagnostics';
import { loadExecutionSettings, loadPanelSettings, savePanelSettings } from './settings';
import { type BackgroundRequest, record, publicTypes, isBackgroundRequest, isAnalysisEvent, contextFor, canSendRequest } from './messages';
import { normalizedFen } from './chess';
import { ORIGINS, type AnalysisEvent, type MoveAnalysisRequest } from './types';
import { captureSession, completeGameSnapshot } from './game-capture';
import { sessionFromPgn } from './review-session';
import type { ReviewEvent, ReviewRequest, ReviewSession } from './review-types';
import { readNativeReview, resolveReviewPly, navigateNativeReview, bindCapturedSnapshot } from './site-review';
import { readNativeEngine } from './site-engine';
import { normalizeNativeEngine } from './analysis-sources';
import { isSiteTheme, themePageUrl } from './theme';
import { ReviewCoordinator } from './review-coordinator';
import { readSiteSnapshot, type SiteSnapshot } from './site-snapshot';
import { parseLichessGameUrl } from './site-game-route';

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
const lastSaved = new Map<number,number>();
const saveTimers = new Map<number, ReturnType<typeof setTimeout>>();
const snapshotReads = new Map<number, { url?: string; at: number; work: Promise<SiteSnapshot> }>();
const captures = new Map<number, Promise<ReviewSession>>();
const automaticFailures = new Map<string,{count:number;error:string}>();
interface StoredReviewRun { gameId?: string; requested: boolean; active: boolean; selectedPly?: number }
async function runControl(tabId: number): Promise<StoredReviewRun | undefined> {
    const value = (await chrome.storage.session.get(`reviewRun:${tabId}`))[`reviewRun:${tabId}`];
    if (!record(value) || typeof value.requested !== 'boolean' || value.gameId !== undefined && typeof value.gameId !== 'string') return;
    return {gameId:value.gameId as string|undefined,requested:value.requested,active:value.active!==false,
        selectedPly:Number.isInteger(value.selectedPly) && Number(value.selectedPly)>=0 && Number(value.selectedPly)<=1500 ? Number(value.selectedPly) : undefined};
}
const pageIdentity = (url: string) => url.split('#')[0];
const gameIdentity = (snapshot: { url: string; gameId?: string }) => `${new URL(snapshot.url).hostname}:${snapshot.gameId}`;
async function snapshotFor(tab: chrome.tabs.Tab, fresh = false): Promise<SiteSnapshot> {
    const previous = snapshotReads.get(tab.id!);
    if (!fresh && previous && previous.url === tab.url && Date.now() - previous.at < 200) return previous.work;
    const work = chrome.scripting.executeScript({ target: { tabId: tab.id! }, world: 'MAIN', func: readSiteSnapshot }).then(results => {
        const value = results[0]?.result;
        if (!value || pageIdentity(value.pageUrl) !== pageIdentity(tab.url ?? '')) throw new SafeRequestError('The selected page changed. Try again.');
        return value;
    });
    snapshotReads.set(tab.id!, { url: tab.url, at: Date.now(), work });
    return work;
}
async function cancelReviewJob(requestId: string) {
    reviewJobs.delete(requestId);
    if (active?.requestId === requestId) { active = undefined; pendingTabId = undefined; generation++; await chrome.storage.session.remove('activeAnalysis'); }
    await chrome.runtime.sendMessage({target:'offscreen',type:'REVIEW_CANCEL',requestId}).catch(() => {});
}
function notifyReview(tabId: number, requested: boolean, flush = false) {
    const state = reviewStates.get(tabId);
    if (!state) return;
    void chrome.storage.session.set({[`reviewRun:${tabId}`]:{sessionId:state.session.id,gameId:state.session.source?.gameId,requested,active:state.active,selectedPly:state.session.selectedPly}});
    const message = {type:'REVIEW_STATE_CHANGED',sessionId:state.session.id,tabId};
    void chrome.tabs.sendMessage(tabId,message).catch(() => {});
    for (const port of panels) { try {port.postMessage(message);} catch {panels.delete(port);} }
    saveReview(tabId,flush);
}
const coordinator = new ReviewCoordinator({
    cancel: cancelReviewJob,
    changed: notifyReview,
    dispatch: async (request, tabId) => {
        const tab = await chrome.tabs.get(tabId), snapshot = await snapshotFor(tab);
        const state = reviewStates.get(tabId);
        if (!state || !coordinator.owns(request.requestId)) return;
        if (snapshot.gameId && snapshot.gameId !== state.session.source?.gameId || snapshot.running && !snapshot.completed || !snapshot.gameId && pageIdentity(snapshot.pageUrl) !== pageIdentity(state.session.source?.url ?? '')) throw new SafeRequestError('The selected game changed.');
        await startReview(request, tabId);
    },
});
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
        const control = await runControl(tabId);
        const compatible = !!control && control.gameId === saved.source?.gameId;
        if (compatible) { state.active = control.active !== false; state.session.selectedPly = control.selectedPly ?? state.session.selectedPly; }
        await coordinator.attach(tabId, state, compatible ? control.requested !== false && control.active !== false : true);
    }
    return state;
}
function saveReview(tabId: number, flush = false) {
    if (!flush && saveTimers.has(tabId)) return;
    clearTimeout(saveTimers.get(tabId));
    const write = () => {
        lastSaved.set(tabId,Date.now());
        saveTimers.delete(tabId); const state = reviewStates.get(tabId);
        if (state && !deletedReviews.has(reviewFingerprint(state.session))) void library.save(state).catch(() => {
            for (const port of panels) { try { port.postMessage({type:'REVIEW_ERROR',sessionId:state.session.id,requestId:'storage',tabId,manual:false,text:'Review is ready, but history could not be saved. Free storage or clear old reviews.'}); } catch {} }
        });
    };
    if (flush) write();
    else saveTimers.set(tabId,setTimeout(write,Math.max(0,2000-(lastSaved.get(tabId)??0))));
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
    for (const id of reviewStates.keys()) if (tabId === undefined || id === tabId) await coordinator.control(id,'hide');
    coordinator.release();
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
    const savedPreferences = (await chrome.storage.local.get('reviewPreferencesV2')).reviewPreferencesV2;
    const level = validPreferences(savedPreferences) ? savedPreferences.level : DEFAULT_REVIEW_PREFERENCES.level;
    if (turn !== generation) return;
    const nativeEvaluation = !manual && settings.analysisSource !== 'local' ? await nativeAdvice(tabId, fen, (await chrome.tabs.get(tabId)).url) : undefined;
    if (turn !== generation) return;
    active = { requestId: request.requestId, tabId, manual };
    pendingTabId = undefined;
    await chrome.storage.session.set({ activeAnalysis: active });
    if (turn !== generation) return;
    await chrome.runtime.sendMessage({ ...request, target: 'offscreen', type: 'ENGINE_START', fen, tabId, manual, settings, nativeEvaluation, level });
}
function enqueue(request: MoveAnalysisRequest, tabId: number, manual: boolean) {
    if (active?.manual && !manual) return;
    // Start immediately; generation guards async setup, offscreen cancels the preceding search.
    void coordinator.select(request.requestId,tabId).then(() => start(request, tabId, manual)).catch(() => {coordinator.settled(request.requestId);broadcast({ type: 'ERROR', requestId: request.requestId, tabId, text: 'Unable to start analysis.' }, manual);});
}
async function captureGame(tab: chrome.tabs.Tab | undefined, automatic = false): Promise<ReviewSession> {
    if (!tab?.id || !tab.url || !/^https:\/\/(www\.chess\.com|lichess\.org)\//.test(tab.url)) throw new SafeRequestError('Open a completed Chess.com or Lichess game first.');
    const pending = captures.get(tab.id);
    if (pending) return pending;
    const work = captureSelectedGame(tab, automatic).finally(() => captures.delete(tab.id!));
    captures.set(tab.id, work);
    return work;
}
async function captureSelectedGame(tab: chrome.tabs.Tab, automatic: boolean): Promise<ReviewSession> {
    const identity = pageIdentity(tab.url!);
    let snapshot = await snapshotFor(tab, true);
    if (!snapshot.gameId || !snapshot.completed) throw new SafeRequestError('A finished game is not ready on this page. Wait for its result, or import its PGN.');
    if (!automatic) automaticFailures.delete(gameIdentity(snapshot));
    const control = await runControl(tab.id!);
    if (automatic && control?.gameId === snapshot.gameId && control.active === false) throw new SafeRequestError('Automatic review dismissed. Choose Review with Kibitz to restart.');
    snapshot = { ...snapshot, ...await completeGameSnapshot({...snapshot, moves: snapshot.pgn ? snapshot.moves : undefined}) };
    const session = captureSession(snapshot);
    const key = reviewFingerprint(session);
    const fresh = await snapshotFor(tab, true);
    const after = await chrome.tabs.get(tab.id!);
    if (pageIdentity(after.url ?? '') !== identity || !fresh.completed || gameIdentity(fresh) !== gameIdentity(snapshot) || fresh.result !== snapshot.result) throw new SafeRequestError('The selected game changed. Try again.');
    // Compare legal history, not PGN formatting or optional metadata. A site
    // navigation may leave the previous board/export alive briefly.
    if (fresh.pgn || fresh.moves) {
        let confirmed: ReviewSession;
        try { confirmed = captureSession(fresh); }
        catch { throw new SafeRequestError('The game history changed during capture. Try again.'); }
        if (confirmed.result !== session.result || !matchingGame(session, confirmed)) throw new SafeRequestError('The game history changed during capture. Try again.');
    } else if (new URL(snapshot.url).hostname === 'www.chess.com' && snapshot.pgn) {
        throw new SafeRequestError('The game export is still loading. Try again.');
    }
    const previous = await stateFor(tab.id!);
    if (previous?.session.source && previous.session.source.gameId === snapshot.gameId && new URL(previous.session.source.url).origin === new URL(snapshot.url).origin && previous.session.result === session.result && matchingGame(previous.session, session)) {
        if (!automatic) { deletedReviews.delete(key); await library.allow(previous.session); await coordinator.control(tab.id!,'resume'); }
        else if (previous.active === false || deletedReviews.has(key) || await library.isDeleted(previous.session)) throw new SafeRequestError('Automatic review dismissed. Choose Review with Kibitz to restart.');
        previous.session.source.url = parseLichessGameUrl(snapshot.pageUrl)?.publicUrl ?? snapshot.pageUrl;
        previous.session.source.canonicalGameUrl = snapshot.canonicalGameUrl;
        await chrome.storage.session.set({[`siteReview:${tab.id}`]:previous.session});
        await coordinator.control(tab.id!,'show');
        return previous.session;
    }
    if (automatic && (deletedReviews.has(key) || await library.isDeleted(session))) throw new SafeRequestError('This review was deleted. Choose Review with Kibitz to restart.');
    if (!automatic) { deletedReviews.delete(key); await library.allow(session); }
    session.source = { ...session.source!, tabId: tab.id };
    await coordinator.remove(tab.id!);
    await chrome.storage.session.set({ [`siteReview:${tab.id}`]: session, [`reviewRun:${tab.id}`]:{sessionId:session.id,gameId:session.source.gameId,requested:true,active:true} });
    await stateLoads.get(tab.id!);
    const state = await stateFor(tab.id!);
    if (state) await coordinator.control(tab.id!, 'show');
    return state?.session ?? session;
}
async function startReview(request: ReviewRequest, tabId: number, turn = ++generation) {
    pendingTabId = tabId;
    if (typeof request.sessionId !== 'string' || request.sessionId.length > 120 || typeof request.requestId !== 'string' || request.requestId.length > 120 || !Array.isArray(request.moves) || request.moves.length > 1500 || !Number.isInteger(request.ply) || request.ply < 0 || request.ply > request.moves.length) throw new SafeRequestError('Invalid review request.');
    // History was captured and replayed when the trusted session was created.
    // Offscreen validates the requested branch before each engine job.
    const current = () => turn === generation && (!request.background || coordinator.owns(request.requestId));
    await ensureOffscreen();
    if (!current()) return;
    if (!request.background) { reviewJobs.clear(); await chrome.runtime.sendMessage({ target: 'offscreen', type: 'ENGINE_CANCEL' }); }
    const settings = await loadExecutionSettings();
    if (!current()) return;
    const reviewState = await stateFor(tabId);
    if (!current()) return;
    request = {...request,level:reviewState?.preferences.level??'beginner'};
    reviewJobs.set(request.requestId, { tabId, sessionId: request.sessionId, ai: request.ai !== false && !request.attempt });
    active = { requestId: request.requestId, tabId, manual: false, sessionId: request.sessionId };
    pendingTabId = undefined;
    await chrome.storage.session.set({ activeAnalysis: active });
    if (!current()) return;
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
                    if (state?.session.id === event.sessionId) { recordAssessment(state, event); notifyReview(event.tabId,coordinator.requested(event.tabId)); }
                }
                if (event.type === 'REVIEW_OPENING') {
                    const state = await stateFor(event.tabId);
                    const assessment = state?.assessments.find(a=>a.ply===event.ply);
                    if (state?.session.id===event.sessionId && assessment) {assessment.opening=event.opening;state.updatedAt=Date.now();saveReview(event.tabId);}
                }
                broadcast(event, authorizedReview ? false : active!.manual);
                if (event.type === 'REVIEW_EXPLANATION_STATE' && event.state !== 'pending' || event.type === 'REVIEW_ERROR' || event.type === 'REVIEW_PRACTICE_RESULT') reviewJobs.delete(event.requestId);
                if (event.type === 'REVIEW_ENGINE_COMPLETE' && reviewJob && !reviewJob.ai) reviewJobs.delete(event.requestId);
                if (event.type === 'REVIEW_ENGINE_COMPLETE' || event.type === 'REVIEW_ERROR' || event.type === 'REVIEW_PRACTICE_RESULT') coordinator.settled(event.requestId,event.type === 'REVIEW_ERROR' ? event.text : undefined);
                if (active?.manual && !active.sessionId && (event.type === 'ERROR' || event.type === 'ENGINE_RESULT' && event.result.terminal || event.type === 'EXPLANATION_STATE' && event.state !== 'pending')) {
                    active = undefined; await chrome.storage.session.remove('activeAnalysis'); coordinator.release(event.requestId);
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
        if (request.type === 'REVIEW_RUN_CONTROL') {
            if (!tab?.id) return {error:'Open the reviewed game first.'};
            const state = await stateFor(tab.id);
            if (state?.session.id !== request.sessionId) return {error:'The selected game changed.'};
            await coordinator.control(tab.id,request.action);
            return {ok:true};
        }
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
            if (page.origin !== source.origin) return {};
            const currentGame = parseLichessGameUrl(page), savedGame = parseLichessGameUrl(source);
            if (currentGame || savedGame) return currentGame && savedGame && currentGame.gameId === savedGame.gameId && currentGame.gameId === state.session.source.gameId ? {state} : {};
            return page.pathname === source.pathname ? {state} : {};
        }
        if (request.type === 'GET_LEARNING_HISTORY') return { history: await library.list(), suggestionAfter:(await chrome.storage.local.get('levelSuggestionAfter')).levelSuggestionAfter??0 };
        if (request.type === 'DELETE_LEARNING_HISTORY') {
            for (const [id, state] of reviewStates) {
                const key = reviewFingerprint(state.session);
                if (!request.key || key === request.key) { await coordinator.control(id,'stop'); deletedReviews.add(key); clearTimeout(saveTimers.get(id)); saveTimers.delete(id); state.attempts = []; }
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
                state.session.selectedPly=request.ply;state.practicePly=request.practicePly;
                if (request.active === false) await coordinator.control(tab.id,'stop');
                else if (request.practicePly !== undefined) await coordinator.control(tab.id,'pause');
                notifyReview(tab.id,coordinator.requested(tab.id));return {ok:true};
            }
            if (request.type === 'REVIEW_PRACTICE_RECORD') {
                if (request.ply > state.session.moves.length) return {error:'Invalid exercise.'};
                recordPractice(state,{ply:request.ply,outcome:request.outcome,at:Date.now()});saveReview(tab.id);return {ok:true};
            }
            if (request.action === 'sweep') { await coordinator.control(tab.id,coordinator.requested(tab.id) ? 'pause' : 'resume');return {ok:true}; }
            if (request.action === 'preferences' && request.preferences) {
                state.preferences=request.preferences;await chrome.storage.local.set({reviewPreferencesV2:request.preferences});saveReview(tab.id);
            }
            await chrome.tabs.sendMessage(tab.id,request);return {ok:true};
        }
        if (request.type === 'GET_SETTINGS') return loadPanelSettings();
        if (request.type === 'TEST_AI') {
            if (tab?.id) await coordinator.control(tab.id,'pause');
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
                let native = results[0]?.result;
                if (!native?.allowed) throw new SafeRequestError('Open a completed game or study board before applying a PGN.');
                session = sessionFromPgn(request.pgn, { url: tab.url, gameId: native.gameId ?? 'study', tabId: tab.id });
                native = {...native,...bindCapturedSnapshot(session,native)};
                if (resolveReviewPly(session, native) === undefined) throw new SafeRequestError('This PGN does not match the position selected on the website. Select a matching mainline move and try again.');
                deletedReviews.delete(reviewFingerprint(session));
                await library.allow(session);
                await coordinator.remove(tab.id);
                await chrome.storage.session.set({ [`siteReview:${tab.id}`]: session, [`reviewRun:${tab.id}`]:{gameId:session.source?.gameId,requested:true,active:true} });
                await stateLoads.get(tab.id);
                await stateFor(tab.id);
                await coordinator.control(tab.id,'show');
            } else session = await captureGame(tab);
            await chrome.tabs.sendMessage(tab.id, { type: 'REVIEW_LOADED', session });
            return { ok: true, title: session.title };
        }
        if (!panel && request.type === 'REVIEW_AVAILABILITY' && tab?.id === sender.tab!.id && sender.frameId === 0) {
            const snapshot = await snapshotFor(tab);
            if (!snapshot.completed) return {completed:false,url:snapshot.pageUrl,gameId:snapshot.gameId};
            const {settings} = await loadPanelSettings();
            if (settings.autoReviewFinishedGames === false) return {completed:true,url:snapshot.pageUrl,gameId:snapshot.gameId};
            const key = gameIdentity(snapshot), previous = automaticFailures.get(key);
            if (previous && previous.count >= 3) return {completed:true,url:snapshot.pageUrl,gameId:snapshot.gameId,error:previous.error};
            try { return {completed:true,url:snapshot.pageUrl,gameId:snapshot.gameId,session:await captureGame(tab,true)}; }
            catch (error) {
                const text = error instanceof SafeRequestError ? error.message : 'Game history could not be read. Retry review or import its PGN.';
                if (automaticFailures.size >= 50) automaticFailures.delete(automaticFailures.keys().next().value!);
                automaticFailures.set(key,{count:(previous?.count??0)+1,error:text});
                return {completed:true,url:snapshot.pageUrl,gameId:snapshot.gameId,error:text};
            }
        }
        if (!panel && request.type === 'OPEN_REVIEW' && tab?.id === sender.tab!.id && sender.frameId === 0) {
            return { session: await captureGame(tab) };
        }
        if (!panel && request.type === 'NATIVE_REVIEW_REQUEST' && tab?.id === sender.tab!.id && sender.frameId === 0) {
            return { snapshot: await snapshotFor(tab) };
        }
        if (!panel && request.type === 'NATIVE_REVIEW_NAVIGATE' && tab?.id === sender.tab!.id && sender.frameId === 0) {
            if (!['previous', 'next', 'first', 'last', 'select'].includes(request.direction)) throw new SafeRequestError('Invalid native navigation request.');
            const saved=(await chrome.storage.session.get(`siteReview:${tab.id}`))[`siteReview:${tab.id}`] as ReviewSession | undefined;
            const result = await chrome.scripting.executeScript({ target: { tabId: tab.id! }, world: 'MAIN', func: navigateNativeReview, args: [{ direction: request.direction, ply: request.ply, expectedUrl: sender.url!, initialFen: saved?.initialFen, moves: saved?.moves.map(move=>move.san), gameId: saved?.source?.gameId }] });
            if (!result[0]?.result?.ok) return {ok:false};
            for (let attempt=0;attempt<6;attempt++) {
                const snapshot=(await chrome.scripting.executeScript({target:{tabId:tab.id!},world:'MAIN',func:readNativeReview}))[0]?.result;
                if (saved && snapshot && resolveReviewPly(saved,bindCapturedSnapshot(saved,snapshot)) === (request.direction === 'first' ? 0 : request.ply)) return {ok:true};
                await new Promise(resolve=>setTimeout(resolve,60));
            }
            return {ok:false};
        }
        if (!panel && request.type === 'REVIEW_ANALYZE' && tab?.id === sender.tab!.id && sender.frameId === 0) {
            if (request.background) throw new SafeRequestError('Whole-game analysis is managed automatically. Use the review pause or resume control.');
            await coordinator.select(request.requestId,tab.id!);
            const turn = ++generation;
            pendingTabId = tab.id;
            const key = `siteReview:${tab.id}`;
            const saved = (await chrome.storage.session.get(key))[key] as ReviewSession | undefined;
            if (turn !== generation) return { ok: true };
            if (!saved || saved.id !== request.sessionId || saved.initialFen !== request.initialFen || JSON.stringify(saved.moves.map(move => move.uci)) !== JSON.stringify(request.moves)) throw new SafeRequestError('Start review for this selected game first.');
            const native = bindCapturedSnapshot(saved,await snapshotFor(tab));
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
            const {fen} = await snapshotFor(tab);
            return {fen:fen ? normalizedFen(fen) : undefined};
        } else if (request.type === 'ANALYSIS_REQUEST') {
            if (typeof request.requestId !== 'string' || typeof request.fen !== 'string' || request.fen.length > 200) throw new SafeRequestError('Invalid analysis request.');
            if (panel) {
                if (!panels.size) throw new SafeRequestError('Open the side panel first.');
                enqueue(request, tab?.id ?? -1, true);
            } else if (tab?.id === sender.tab!.id && sender.frameId === 0) enqueue(request, sender.tab!.id!, false);
        } else if (request.type === 'CANCEL') {
            if (panel && active?.manual) await cancel();
            else if (!panel) {
                if (request.requestId) {
                    const id = request.requestId;
                    if (coordinator.ownsSelection(id,sender.tab!.id!)) {
                        if (pendingTabId === sender.tab!.id) {generation++;pendingTabId=undefined;}
                        await cancelReviewJob(id); coordinator.release(id);
                    } else if (reviewJobs.get(id)?.tabId === sender.tab!.id && !id.startsWith('sweep-') || active?.requestId===id && active.tabId===sender.tab!.id && !active.manual) await cancelReviewJob(id);
                } else {
                    const ids = [...reviewJobs].filter(([id,job])=>job.tabId===sender.tab!.id && !id.startsWith('sweep-')).map(([id])=>id);
                    if (active && active.tabId === sender.tab!.id && !active.manual && !active.sessionId) ids.push(active.requestId);
                    for (const id of ids) {await cancelReviewJob(id);coordinator.release(id);}
                }
            }
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
    void run().then(respond, error => {
        if (request.type === 'REVIEW_ANALYZE' || request.type === 'ANALYSIS_REQUEST') coordinator.settled(request.requestId);
        respond({
        error: error instanceof SafeRequestError ? error.message : request.type === 'SAVE_SETTINGS' ? 'Could not save settings. Try again.' : 'Request failed. Try again.',
        diagnostic: diagnostic(request.type === 'SAVE_SETTINGS' ? 'SETTINGS_SAVE_FAILED' : 'PROTOCOL_INVALID'),
    }); });
    return true;
});
chrome.tabs.onActivated.addListener(() => {
    if (active?.sessionId && active.manual) return;
    void cancel().then(async () => { const tab = await currentTab(); if (tab?.id) await chrome.tabs.sendMessage(tab.id, { type: 'REFRESH' }).catch(() => {}); });
});
chrome.tabs.onRemoved.addListener(tabId => { void coordinator.remove(tabId); void cancel(tabId); snapshotReads.delete(tabId); lastSaved.delete(tabId); reviewStates.delete(tabId); clearTimeout(saveTimers.get(tabId)); saveTimers.delete(tabId); void chrome.storage.session.remove([`siteReview:${tabId}`,`reviewRun:${tabId}`,`siteTheme:${tabId}`]); });
chrome.windows.onFocusChanged.addListener(() => { if (active?.sessionId && active.manual) return; void cancel().then(async () => { const tab = await currentTab(); if (tab?.id) await chrome.tabs.sendMessage(tab.id, { type: 'REFRESH' }).catch(() => {}); }); });
