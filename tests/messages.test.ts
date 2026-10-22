import { beforeEach, expect, it, vi } from 'vitest';
import { Chess } from 'chess.js';
import { evaluation } from '../src/chess';
import { DEFAULT_SETTINGS } from '../src/types';
import { canSendRequest, contextFor, isAnalysisEvent, isBackgroundRequest, isBackgroundSender, isContentMessage, isOffscreenCommand } from '../src/messages';
const fen = new Chess().fen();
const analysis = { type: 'ANALYSIS_REQUEST', requestId: 'opaque', fen, orientation: 'white' };
it('validates explanation completion states and their position, source and review selection', () => {
    const state = {type:'EXPLANATION_STATE',requestId:'opaque',tabId:1,fen,state:'ready',provider:'chrome'};
    expect(isAnalysisEvent(state)).toBe(true);
    expect(isAnalysisEvent({...state,state:'fallback',provider:'facts'})).toBe(true);
    expect(isAnalysisEvent({...state,state:'pending',provider:undefined})).toBe(true);
    for (const bad of [{...state,provider:'facts'},{...state,state:'fallback'},{...state,state:'pending'},
        {...state,state:'complete'},{...state,fen:'wrong'}, {...state,type:'REVIEW_EXPLANATION_STATE',sessionId:'game'}]) expect(isAnalysisEvent(bad)).toBe(false);
    expect(isAnalysisEvent({...state,type:'REVIEW_EXPLANATION_STATE',sessionId:'game',ply:1})).toBe(true);
});
it('bounds opening metadata without accepting malformed nested matches', () => {
    const event = {type:'REVIEW_OPENING',requestId:'opaque',sessionId:'game',tabId:1,ply:1,opening:{current:{eco:'B00',name:"King's Pawn",ply:1,match:'sequence'}}};
    expect(isAnalysisEvent(event)).toBe(true);
    expect(isAnalysisEvent({...event,opening:{current:{...event.opening.current,name:'x'.repeat(501)}}})).toBe(false);
    expect(isAnalysisEvent({...event,opening:{current:{...event.opening.current,ply:-1}}})).toBe(false);
    expect(isAnalysisEvent({...event,opening:{current:{...event.opening.current,match:'guessed'}}})).toBe(false);
});
beforeEach(() => vi.stubGlobal('chrome', { runtime: { id: 'kibitz', getURL: (p: string) => `chrome-extension://kibitz/${p}` } }));
it('rejects malformed/oversized public inputs before dispatch', () => {
    expect(isBackgroundRequest({type:'NATIVE_REVIEW_NAVIGATE',direction:'select',ply:3})).toBe(true);
    for(const ply of [undefined,0,-1,1501,1.2,'3'])expect(isBackgroundRequest({type:'NATIVE_REVIEW_NAVIGATE',direction:'select',ply})).toBe(false);
    expect(isBackgroundRequest(analysis)).toBe(true);
    for (const bad of [null, [], { ...analysis, fen: '8/8/8/8/8/8/8/8 w' }, { ...analysis, requestId: 'x'.repeat(121) }, { ...analysis, orientation: 'w' }, { type: 'SET_OVERLAY_PREFERENCES', heatmap: true, arrows: 1 }, { type: 'IMPORT_PAGE_REVIEW', pgn: 'x'.repeat(262145) }]) expect(isBackgroundRequest(bad)).toBe(false);
    const review = { type: 'REVIEW_ANALYZE', sessionId: 'session', requestId: 'opaque', initialFen: fen, moves: ['e2e4'], ply: 1 };
    expect(isBackgroundRequest(review)).toBe(true);
    for (const bad of [{ ...review, moves: ['e4'] }, { ...review, ply: 2 }, { ...review, moves: Array(1501).fill('e2e4') }, { ...review, background: 'true' }]) expect(isBackgroundRequest(bad)).toBe(false);
});
it('validates nested result scores and bounded diagnostics', () => {
    const event = { type: 'ENGINE_RESULT', requestId: 'opaque', tabId: 1, result: evaluation([]) };
    expect(isAnalysisEvent(event)).toBe(true);
    expect(isAnalysisEvent({ ...event, result: { ...event.result, whiteScore: Infinity } })).toBe(false);
    expect(isAnalysisEvent({ type: 'STREAM_CHUNK', requestId: 'opaque', tabId: 1, textDelta: '', isComplete: true })).toBe(true);
    expect(isAnalysisEvent({ type: 'STREAM_CHUNK', requestId: 'opaque', tabId: 1, textDelta: '' })).toBe(false);
    const error = { type: 'ERROR', requestId: 'opaque', tabId: 1, text: 'Unavailable.', diagnostic: { code: 'PROVIDER_UNAVAILABLE', provider: 'openai' } };
    expect(isAnalysisEvent(error)).toBe(true);
    expect(isAnalysisEvent({ ...error, diagnostic: { ...error.diagnostic, key: 'secret' } })).toBe(false);
    expect(isContentMessage({ type: 'REVIEW_LOADED', session: {} })).toBe(false);
});
it('separates execution credentials from panel preferences', () => {
    expect(isBackgroundRequest({ type: 'SAVE_SETTINGS', settings: DEFAULT_SETTINGS, credentials: { openai: null } })).toBe(true);
    expect(isBackgroundRequest({ type: 'SAVE_SETTINGS', settings: { ...DEFAULT_SETTINGS, keys: {} } })).toBe(false);
    expect(isBackgroundRequest({ type: 'SAVE_SETTINGS', settings: DEFAULT_SETTINGS, credentials: { unknown: 'secret' } })).toBe(false);
    const job = { ...analysis, type: 'ENGINE_START', target: 'offscreen', tabId: 1, manual: false, settings: { ...DEFAULT_SETTINGS, keys: { gemini: 'secret' } } };
    expect(isOffscreenCommand(job)).toBe(true);
    expect(isOffscreenCommand({ ...job, settings: { ...DEFAULT_SETTINGS, keys: { unknown: 'secret' } } })).toBe(false);
});
it('authenticates identity, top frame, HTTPS origins and extension execution contexts', () => {
    const sender = { id: 'kibitz', url: 'https://lichess.org/analysis', frameId: 0, tab: { id: 1 } as chrome.tabs.Tab };
    expect(contextFor(sender)).toBe('content');
    for (const bad of [{ ...sender, id: 'other' }, { ...sender, frameId: 1 }, { ...sender, url: 'http://lichess.org/analysis' }, { ...sender, url: 'https://lichess.org.evil/analysis' }]) expect(contextFor(bad)).toBeUndefined();
    expect(contextFor({ id: 'kibitz', url: 'chrome-extension://kibitz/sidepanel.html' })).toBe('panel');
    expect(contextFor({ id: 'kibitz', url: 'chrome-extension://kibitz/sidepanel.html', tab: { id: 1 } as chrome.tabs.Tab })).toBe('panel');
    expect(canSendRequest({ type: 'GET_SETTINGS' }, 'content')).toBe(false);
    expect(canSendRequest({ type: 'POSITION_REQUEST' }, 'panel')).toBe(false);
    expect(isBackgroundSender({ id: 'kibitz', url: 'chrome-extension://kibitz/background.js' })).toBe(true);
    expect(isBackgroundSender({ id: 'kibitz', url: 'chrome-extension://kibitz/sidepanel.html' })).toBe(false);
});
