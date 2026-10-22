import { beforeEach, expect, it, vi } from 'vitest';
import { Chess } from 'chess.js';
import { sessionFromPgn } from '../src/review-session';

let listener: (message: any, sender: any, respond: (value: any) => void) => void;
let onActivated: () => void;
let onConnect: (port: any) => void;
let activeTab = 12;
let activeUrl = 'https://lichess.org/analysis';
const session: Record<string, unknown> = {};
const local: Record<string, unknown> = {};
const runtimeSend = vi.fn(async (_message: any) => ({ ok: true }));
const tabSend = vi.fn(async (_id: number, _event: any) => ({}));
const page = { id: 'kibitz', url: 'https://lichess.org/analysis', tab: { id: 12 }, frameId: 0 };
const engine = { id: 'kibitz', url: 'chrome-extension://kibitz/offscreen.html' };
const panel = { id: 'kibitz', url: 'chrome-extension://kibitz/sidepanel.html' };
const request = (requestId: string) => ({ type: 'ANALYSIS_REQUEST', requestId, fen: new Chess().fen(), orientation: 'white' });
const send = (message: any, sender: any = page) => new Promise<any>(resolve => listener(message, sender, resolve));
beforeEach(async () => {
    vi.resetModules(); runtimeSend.mockClear(); tabSend.mockClear(); activeTab = 12; activeUrl = 'https://lichess.org/analysis';
    for (const key of Object.keys(session)) delete session[key];
    for (const key of Object.keys(local)) delete local[key];
    vi.stubGlobal('chrome', {
        runtime: { id: 'kibitz', getURL: (p: string) => `chrome-extension://kibitz/${p}`,
            getContexts: async () => [{}], ContextType: { OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT' },
            sendMessage: runtimeSend, onMessage: { addListener: (fn: typeof listener) => { listener = fn; } }, onConnect: { addListener: (fn: typeof onConnect) => { onConnect = fn; } } },
        storage: {
            local: { setAccessLevel: vi.fn(), get: async () => ({ ...local }), set: async (value: object) => { Object.assign(local, value); } },
            sync: { set: vi.fn(async () => {}), setAccessLevel: vi.fn(), get: async () => ({ settings: { provider: 'ollama', keys: { openai: 'private-key' } } }) },
            session: { setAccessLevel: vi.fn(), get: async () => ({ ...session }),
                set: async (value: object) => { Object.assign(session, value); }, remove: async (key: string) => { delete session[key]; } },
        },
        tabs: { query: async () => [{ id: activeTab, url: activeUrl }], get: async () => ({ id: activeTab, url: activeUrl }), sendMessage: tabSend,
            onActivated: { addListener: (fn: () => void) => { onActivated = fn; } }, onRemoved: { addListener: vi.fn() } },
        windows: { onFocusChanged: { addListener: vi.fn() } },
        permissions: { contains: vi.fn(async () => true) },
        action: { onClicked: { addListener: vi.fn() } }, sidePanel: { setPanelBehavior: vi.fn() },
        scripting: { executeScript: vi.fn(async () => [{ result: new Chess().fen() }]) },
    });
    await import('../src/background');
});
it('persists independent overlay preferences without starting analysis and rejects invalid values', async () => {
    expect(await send({ type: 'GET_OVERLAY_PREFERENCES' })).toEqual({ heatmap: true, arrows: true });
    expect(await send({ type: 'SET_OVERLAY_PREFERENCES', heatmap: false, arrows: true })).toEqual({ ok: true });
    expect(await send({ type: 'GET_OVERLAY_PREFERENCES' })).toEqual({ heatmap: false, arrows: true });
    expect(await send({ type: 'SET_OVERLAY_PREFERENCES', heatmap: 'false', arrows: true })).toHaveProperty('error');
    expect(runtimeSend).not.toHaveBeenCalled();
});
it('relays only validated active-tab themes and does not reuse a palette on another URL', async () => {
    const port = connectPanel();
    const theme = { site: 'lichess', background: 'rgb(30, 30, 30)', foreground: '#eeeeee', accent: '#82a958', radius: '4px', fontFamily: 'sans-serif', dark: true };
    await send({ type: 'SITE_THEME', theme });
    expect(port).toHaveBeenCalledWith({ type: 'SITE_THEME', tabId:12,url:activeUrl,theme });
    expect(await send({ type: 'GET_SITE_THEME' }, panel)).toEqual({ tabId:12,url:activeUrl,theme });
    await send({ type: 'SITE_THEME', theme: { ...theme, background: 'url(bad)' } });
    expect(port).toHaveBeenCalledOnce();
    activeUrl = 'https://example.com/';
    expect(await send({ type: 'GET_SITE_THEME' }, panel)).toEqual({ tabId:12,url:activeUrl,theme: undefined });
});
it('preserves the cached card theme through move hashes and rejects themes from an old page or another tab', async () => {
    const post = connectPanel();
    const theme = { site:'lichess',background:'#181818',foreground:'#eeeeee',accent:'#82a958',radius:'4px',fontFamily:'sans-serif',dark:true };
    activeUrl = 'https://lichess.org/analysis#4';
    await send({type:'SITE_THEME',theme},{...page,url:activeUrl});
    activeUrl = 'https://lichess.org/analysis#8';
    expect(await send({type:'GET_SITE_THEME'},panel)).toEqual({tabId:12,url:'https://lichess.org/analysis',theme});
    activeUrl = 'https://lichess.org/other';
    expect(await send({type:'SITE_THEME',theme},page)).toEqual({ok:false});
    expect(post).toHaveBeenCalledOnce();
    expect((await send({type:'GET_SITE_THEME'},panel)).theme).toBeUndefined();
    activeTab = 99; activeUrl = 'https://lichess.org/analysis';
    expect(await send({type:'GET_SITE_THEME'},panel)).toEqual({tabId:99,url:activeUrl,theme:undefined});
});
it('routes verified Lichess candidates as advice while retaining the engine source identity', async () => {
    const fen = new Chess().fen();
    vi.mocked(chrome.scripting.executeScript).mockImplementation(async (args: any) => [{ result: args.func.name === 'readNativeEngine'
        ? { source: 'lichess-client', url: activeUrl, fen, evaluationFen: fen, path: '', ply: 0, variant: 'standard', perspective: 'white', capturedAt: Date.now(), depth: 18, candidates: [{ cp: 20, moves: ['e2e4', 'e7e5'] }] }
        : { url: activeUrl, allowed: true, fen, path: '', ply: 0, orientation: 'white' } }] as never);
    await send(request('native'));
    await vi.waitFor(() => expect(runtimeSend).toHaveBeenCalledWith(expect.objectContaining({ type: 'ENGINE_START', nativeEvaluation: expect.objectContaining({ bestMove: 'e2e4', source: expect.objectContaining({ kind: 'lichess-client' }) }) })));
});
it('falls back to local analysis when the native page does not respond promptly', async () => {
    vi.mocked(chrome.scripting.executeScript).mockImplementation(() => new Promise(() => {}));
    await send(request('native-timeout'));
    await vi.waitFor(() => expect(runtimeSend).toHaveBeenCalledWith(expect.objectContaining({ type: 'ENGINE_START', requestId: 'native-timeout', nativeEvaluation: undefined })), { timeout: 1500 });
});
function connectPanel() {
    const postMessage = vi.fn();
    onConnect({ name: 'panel', sender: panel, postMessage, onDisconnect: { addListener: vi.fn() } });
    return postMessage;
}
it('routes the request to offscreen with the correct command and private settings', async () => {
    await send(request('one'));
    await vi.waitFor(() => expect(runtimeSend).toHaveBeenCalledWith(expect.objectContaining({ type: 'ENGINE_START', target: 'offscreen', requestId: 'one', tabId: 12 })));
    expect(tabSend).not.toHaveBeenCalled();
});
it('checks cloud host permissions for the trusted offscreen document only', async () => {
    const message = { type: 'PROVIDER_PERMISSION', origin: 'https://api.openai.com/*' };
    expect(await send(message, engine)).toEqual({ granted: true });
    expect(chrome.permissions.contains).toHaveBeenCalledWith({ origins: [message.origin] });
    const respond = vi.fn();
    listener(message, { ...engine, url: 'chrome-extension://kibitz/untrusted.html' }, respond);
    listener({ ...message, origin: 'https://example.com/*' }, engine, respond);
    expect(respond).toHaveBeenNthCalledWith(1, expect.objectContaining({ error: 'Unauthorized request.' })); expect(respond).toHaveBeenNthCalledWith(2, expect.objectContaining({ error: 'Invalid request.' })); expect(chrome.permissions.contains).toHaveBeenCalledTimes(1);
});
it('reads only the active board FEN through the isolated page API reader', async () => {
    expect(await send({ type: 'POSITION_REQUEST' })).toEqual({ fen: new Chess().fen() });
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith(expect.objectContaining({ target: { tabId: 12 }, world: 'MAIN' }));
});
it('discards superseded results and forwards only current results to their tab', async () => {
    await send(request('old'));
    await vi.waitFor(() => expect(session.activeAnalysis).toMatchObject({ requestId: 'old' }));
    await send(request('new'));
    await vi.waitFor(() => expect(session.activeAnalysis).toMatchObject({ requestId: 'new' }));
    listener({ target: 'background', manual: false, event: { type: 'STREAM_CHUNK', requestId: 'old', tabId: 12, textDelta: 'stale', isComplete: false } }, engine, () => {});
    listener({ target: 'background', manual: false, event: { type: 'STREAM_CHUNK', requestId: 'new', tabId: 12, textDelta: 'current', isComplete: false } }, engine, () => {});
    await vi.waitFor(() => expect(tabSend).toHaveBeenCalledTimes(1));
    expect(tabSend.mock.calls[0]).toEqual([12, expect.objectContaining({ textDelta: 'current', isComplete: false })]);
    expect(JSON.stringify(tabSend.mock.calls)).not.toContain('private-key');
});
it('ignores requests from inactive tabs and subframes', async () => {
    activeTab = 99; await send(request('hidden'));
    activeTab = 12; await send(request('frame'), { ...page, frameId: 3 });
    expect(runtimeSend).not.toHaveBeenCalled();
});
it('cancels on a tab switch and suppresses late chunks', async () => {
    await send(request('one'));
    await vi.waitFor(() => expect(session.activeAnalysis).toBeTruthy());
    onActivated();
    await vi.waitFor(() => expect(session.activeAnalysis).toBeUndefined());
    await vi.waitFor(() => expect(tabSend).toHaveBeenCalledWith(12, { type: 'REFRESH' }));
    tabSend.mockClear();
    listener({ target: 'background', manual: false, event: { type: 'STREAM_CHUNK', requestId: 'one', tabId: 12, textDelta: 'late' } }, engine, () => {});
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(tabSend).not.toHaveBeenCalled();
});
it('routes review directly to its source page without a panel and pauses hidden tabs', async () => {
    activeUrl = 'https://lichess.org/abcdefgh';
    const source = { ...page, url: activeUrl };
    const saved = sessionFromPgn('[Result "1-0"]\n\n1. e4 e5 1-0', { url: activeUrl, gameId: 'abcdefgh', tabId: 12 });
    session['siteReview:12'] = saved;
    vi.mocked(chrome.scripting.executeScript).mockResolvedValue([{ result: { url: activeUrl, allowed: true, gameId: 'abcdefgh', fen: saved.moves[0].afterFen, ply: 1, orientation: 'white' } }] as never);
    const request = { type: 'REVIEW_ANALYZE', sessionId: saved.id, requestId: 'review-request', initialFen: saved.initialFen, moves: saved.moves.map(move => move.uci), ply: 1 };
    expect(await send(request, source)).toEqual({ ok: true });
    expect(runtimeSend).toHaveBeenCalledWith(expect.objectContaining({ type: 'REVIEW_START', manual: false, request: expect.objectContaining({ sessionId: saved.id }) }));
    listener({ target: 'background', manual: false, event: { type: 'REVIEW_STATUS', sessionId: 'wrong', requestId: 'review-request', tabId: 12, text: 'stale' } }, engine, () => {});
    listener({ target: 'background', manual: false, event: { type: 'REVIEW_STATUS', sessionId: saved.id, requestId: 'review-request', tabId: 12, text: 'current' } }, engine, () => {});
    await vi.waitFor(() => expect(tabSend).toHaveBeenCalledOnce());
    expect(tabSend).toHaveBeenCalledWith(12, expect.objectContaining({ text: 'current' }));
    onActivated();
    await vi.waitFor(() => expect(session.activeAnalysis).toBeUndefined());
    expect(tabSend).toHaveBeenCalledWith(12, expect.objectContaining({ type: 'REVIEW_ERROR', text: expect.stringContaining('paused') }));
});
it('rejects a different move or session and allows whole-game jobs without navigating the board', async () => {
    activeUrl = 'https://lichess.org/abcdefgh'; const source = { ...page, url: activeUrl };
    const saved = sessionFromPgn('[Result "1-0"]\n\n1. e4 e5 1-0', { url: activeUrl, gameId: 'abcdefgh', tabId: 12 }); session['siteReview:12'] = saved;
    vi.mocked(chrome.scripting.executeScript).mockResolvedValue([{ result: { url: activeUrl, allowed: true, gameId: 'abcdefgh', fen: saved.moves[0].afterFen, ply: 1, orientation: 'white' } }] as never);
    const request = { type: 'REVIEW_ANALYZE', sessionId: saved.id, requestId: 'review-request', initialFen: saved.initialFen, moves: saved.moves.map(move => move.uci), ply: 2 };
    expect((await send(request, source)).error).toContain('selected move changed');
    expect((await send({ ...request, sessionId: 'other' }, source)).error).toContain('Start review');
    expect(await send({ ...request, background: true }, source)).toEqual({ ok: true });
    expect(runtimeSend).toHaveBeenCalledWith(expect.objectContaining({ type: 'REVIEW_START', request: expect.objectContaining({ background: true, ply: 2 }) }));
});
it('cancels a pending native validation before any review engine job can start', async () => {
    activeUrl = 'https://lichess.org/abcdefgh'; const source = { ...page, url: activeUrl };
    const saved = sessionFromPgn('[Result "1-0"]\n\n1. e4 e5 1-0', { url: activeUrl, gameId: 'abcdefgh', tabId: 12 }); session['siteReview:12'] = saved;
    let finish!: (value: any) => void;
    vi.mocked(chrome.scripting.executeScript).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }) as never);
    const pending = send({ type: 'REVIEW_ANALYZE', sessionId: saved.id, requestId: 'pending', initialFen: saved.initialFen, moves: saved.moves.map(move => move.uci), ply: 1 }, source);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    await send({ type: 'CANCEL' }, source);
    finish([{ result: { url: activeUrl, allowed: true, gameId: 'abcdefgh', fen: saved.moves[0].afterFen, ply: 1, orientation: 'white' } }]);
    await pending;
    expect(runtimeSend.mock.calls.some(([message]) => message.type === 'REVIEW_START')).toBe(false);
});
it('captures only a still-selected completed game and rejects navigation races', async () => {
    activeUrl = 'https://lichess.org/abcdefgh';
    const snapshot = { url: activeUrl, gameId: 'abcdefgh', completed: true, result: '1-0', pgn: '[Result "1-0"]\n\n1. e4 e5 1-0' };
    vi.mocked(chrome.scripting.executeScript).mockResolvedValue([{ result: snapshot }] as never);
    const captured = await send({ type: 'CAPTURE_GAME' }, panel);
    expect(captured.session.source).toMatchObject({ gameId: 'abcdefgh', tabId: 12 });
    expect(captured.session.moves).toHaveLength(2);
    vi.mocked(chrome.scripting.executeScript).mockImplementationOnce(async () => { activeUrl = 'https://lichess.org/ijklmnop'; return [{ result: snapshot }] as never; });
    const changed = await send({ type: 'CAPTURE_GAME' }, panel);
    expect(changed.error).toContain('changed');
});
it('keeps manual analysis active until its typed explanation completion is delivered', async () => {
    const post = connectPanel(); await send(request('manual'), panel);
    await vi.waitFor(() => expect(session.activeAnalysis).toMatchObject({ requestId: 'manual' }));
    listener({ target: 'background', manual: true, event: { type: 'STREAM_CHUNK', requestId: 'manual', tabId: 12, textDelta: '', isComplete: true } }, engine, () => {});
    listener({ target: 'background', manual: true, event: { type: 'STATUS', requestId: 'manual', tabId: 12, text: 'Explanation by Chrome AI' } }, engine, () => {});
    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(session.activeAnalysis).toMatchObject({requestId:'manual'});
    listener({ target: 'background', manual: true, event: { type: 'EXPLANATION_STATE', requestId: 'manual', tabId: 12, fen: new Chess().fen(), state:'ready',provider:'chrome' } }, engine, () => {});
    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(3));
    expect(post).toHaveBeenLastCalledWith(expect.objectContaining({ type:'EXPLANATION_STATE',state:'ready',provider:'chrome' }));
    expect(session.activeAnalysis).toBeUndefined();
});
it('resets explanation caches and refreshes website review when settings change', async () => {
    await send({type:'SETTINGS_CHANGED'},panel);
    expect(runtimeSend).toHaveBeenCalledWith({target:'offscreen',type:'EXPLANATION_RESET'});
    expect(tabSend).toHaveBeenCalledWith(12,{type:'REFRESH'});
});
it('keeps settings panel-only and returns credential flags instead of secrets', async () => {
    expect(await send({ type: 'GET_SETTINGS' })).toMatchObject({ error: 'Unauthorized request.' });
    const response = await send({ type: 'GET_SETTINGS' }, panel);
    expect(response.configured.openai).toBe(true);
    expect(response.settings).not.toHaveProperty('keys');
    expect(JSON.stringify(response)).not.toContain('private-key');
    expect(local.apiKeys).toEqual({ openai: 'private-key' });
});
it('derives tab identity and manual mode from the authenticated context', async () => {
    await send({ ...request('derived'), tabId: 999, manual: true });
    await vi.waitFor(() => expect(runtimeSend).toHaveBeenCalledWith(expect.objectContaining({ type: 'ENGINE_START', tabId: 12, manual: false })));
});
it('rejects malformed offscreen results without mutating or forwarding state', async () => {
    await send(request('guarded'));
    await vi.waitFor(() => expect(session.activeAnalysis).toMatchObject({ requestId: 'guarded' }));
    expect(await send({ target: 'background', manual: false, event: { type: 'ENGINE_RESULT', requestId: 'guarded', tabId: 12, result: { candidates: [] } } }, engine)).toMatchObject({ error: 'Invalid request.' });
    expect(tabSend).not.toHaveBeenCalled();
    expect(session.activeAnalysis).toMatchObject({ requestId: 'guarded' });
});
it('does not resurrect cancelled analysis when an in-flight storage read returns stale state', async () => {
    await send(request('cancel-read'));
    await vi.waitFor(() => expect(session.activeAnalysis).toMatchObject({ requestId: 'cancel-read' }));
    const stale = { ...session };
    let finish!: (value: Record<string, unknown>) => void;
    chrome.storage.session.get = vi.fn(() => new Promise(resolve => { finish = resolve; })) as typeof chrome.storage.session.get;
    listener({ target: 'background', manual: false, event: { type: 'STREAM_CHUNK', requestId: 'cancel-read', tabId: 12, textDelta: 'stale', isComplete: false } }, engine, () => {});
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    await send({ type: 'CANCEL' });
    finish(stale);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(tabSend).not.toHaveBeenCalled();
    expect(session.activeAnalysis).toBeUndefined();
});
