import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Chess } from 'chess.js';
import { DEFAULT_SETTINGS, type Evaluation } from '../src/types';
import type { ReviewJob } from '../src/review-types';

const mocks = vi.hoisted(() => ({ analyze: vi.fn(), cancel: vi.fn(), explain: vi.fn() }));
vi.mock('../src/engine', () => ({ Engine: class { analyze = mocks.analyze; cancel = mocks.cancel; } }));
vi.mock('../src/providers', () => ({ explain: mocks.explain, PROVIDER_NAMES: { chrome: 'Chrome AI · local' } }));
let listener: (message: any, sender: any, respond: (value: unknown) => void) => void;
const send = vi.fn(async (_message: any) => ({}));
const evaluation: Evaluation = { bestMove: 'd2d4', pvLines: ['d4'], promisingMoves: [], evaluation: '+0.1', whiteScore: 0.1, engineScore: { kind: 'cp', value: 10 }, candidates: [{ uci: 'd2d4', san: 'd4', pv: 'd4', score: 0.1 }] };
const job = (ai = false, requestId = 'one'): ReviewJob => ({ target: 'offscreen', type: 'REVIEW_START', tabId: 12, settings: { ...DEFAULT_SETTINGS, keys: {} }, request: { type: 'REVIEW_ANALYZE', sessionId: 'game', requestId, initialFen: new Chess().fen(), moves: ['e2e4'], ply: 1, ai } });
const deliver = (message: unknown) => listener(message, { id: 'extension', url: 'chrome-extension://extension/background.js' }, () => {});
const events = () => send.mock.calls.map(([message]) => message.event);

beforeEach(async () => {
    vi.resetModules(); send.mockClear(); mocks.analyze.mockReset(); mocks.cancel.mockReset(); mocks.explain.mockReset();
    mocks.analyze.mockResolvedValue(evaluation);
    vi.stubGlobal('chrome', { runtime: { id: 'extension', getURL: (path: string) => `chrome-extension://extension/${path}`, sendMessage: send, onMessage: { addListener: (fn: typeof listener) => { listener = fn; } } } });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json([])));
    await import('../src/offscreen');
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it('emits engine and factual feedback with no AI call by default', async () => {
    deliver(job());
    await vi.waitFor(() => expect(events().some(event => event.type === 'REVIEW_RESULT')).toBe(true));
    expect(events().find(event => event.type === 'REVIEW_RESULT')).toMatchObject({ sessionId: 'game', requestId: 'one', tabId: 12, ply: 1, feedback: { label: 'Excellent' } });
    const summary = events().find(event => event.type === 'REVIEW_RESULT').feedback.summary;
    expect(summary).toContain('previous evaluation');
    expect(summary).not.toContain('alternative');
    expect(summary).not.toContain('Stockfish');
    expect(send.mock.calls.every(([message]) => message.target === 'background' && message.manual === true)).toBe(true);
    expect(mocks.explain).not.toHaveBeenCalled();
});
it('publishes feedback before a delayed opening file and emits only matching metadata later', async () => {
    let resolve!: (value:Response)=>void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(r=>{resolve=r;})));
    deliver(job());
    await vi.waitFor(() => expect(events().some(e=>e.type==='REVIEW_RESULT')).toBe(true));
    expect(events().some(e=>e.type==='REVIEW_OPENING')).toBe(false);
    const board=new Chess(); board.move('e4');
    resolve(Response.json([['B00',"King's Pawn",'e2e4',board.fen().split(' ').slice(0,4).join(' ')]]));
    await vi.waitFor(() => expect(events().find(e=>e.type==='REVIEW_OPENING')).toMatchObject({requestId:'one',ply:1,opening:{current:{name:"King's Pawn"}}}));
    deliver(job(false,'cached'));
    await vi.waitFor(() => expect(events().find(e=>e.type==='REVIEW_RESULT'&&e.requestId==='cached')?.opening?.current?.name).toBe("King's Pawn"));
});
it('never publishes opening metadata for a canceled review', async () => {
    let resolve!: (value:Response)=>void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(r=>{resolve=r;})));
    deliver(job());
    await vi.waitFor(() => expect(events().some(e=>e.type==='REVIEW_RESULT')).toBe(true));
    deliver({target:'offscreen',type:'ENGINE_CANCEL'});
    resolve(Response.json([])); await new Promise(r=>setTimeout(r,0));
    expect(events().some(e=>e.type==='REVIEW_OPENING')).toBe(false);
});
it('preserves facts and reports an unavailable optional AI explanation', async () => {
    mocks.explain.mockRejectedValue(new Error('offline'));
    deliver(job(true));
    await vi.waitFor(() => expect(events().some(event => event.text === 'Stockfish feedback ready. AI explanation unavailable.')).toBe(true));
    expect(events().filter(event => event.type === 'REVIEW_RESULT')).toHaveLength(1);
    expect(events().some(event => event.type === 'REVIEW_ERROR')).toBe(false);
});
it('uses native suggestions for replies while keeping the local score pair for move grading', async () => {
    const native: Evaluation = { bestMove: 'e7e5', pvLines: ['e5'], promisingMoves: [], evaluation: '-9.00', whiteScore: -9,
        engineScore: { kind: 'cp', value: -900 }, source: { kind: 'lichess-client', label: 'Lichess analysis' },
        candidates: [{ uci: 'e7e5', san: 'e5', pv: 'e5', score: -9, uciPv: ['e7e5'] }] };
    deliver({ ...job(), nativeEvaluation: native });
    await vi.waitFor(() => expect(events().some(event => event.type === 'REVIEW_RESULT')).toBe(true));
    const event = events().find(event => event.type === 'REVIEW_RESULT');
    expect(event.after.whiteScore).toBe(0.1);
    expect(event.advice.whiteScore).toBe(-9);
    expect(event.feedback.label).toBe('Excellent');
    expect(event.feedback.summary).toContain('previous evaluation');
    expect(event.feedback.summary).not.toContain('-9');
    expect(mocks.analyze).toHaveBeenCalledTimes(2);
});
it('supplies selected-move facts to the existing provider chain', async () => {
    mocks.explain.mockImplementation(async (_settings, _fen, _evaluation, _signal, onDelta) => { onDelta('Keeps the evaluation.'); return 'chrome'; });
    deliver(job(true));
    await vi.waitFor(() => expect(events().some(event => event.type === 'REVIEW_TEXT')).toBe(true));
    expect(mocks.explain.mock.calls[0][6]).toMatchObject({ playedMove: 'e4', summary: expect.stringContaining('e4: excellent') });
    expect(events().find(event => event.type === 'REVIEW_TEXT')).toMatchObject({ text: 'Keeps the evaluation.', provider: 'Chrome AI · local' });
});
it('cancels superseded jobs and suppresses late results even if the engine ignores abort', async () => {
    let resolve: ((value: Evaluation) => void) | undefined;
    mocks.analyze.mockImplementationOnce(() => new Promise<Evaluation>(done => { resolve = done; }));
    deliver(job(false, 'old'));
    deliver({ target: 'offscreen', type: 'ENGINE_CANCEL' });
    deliver(job(false, 'new'));
    await vi.waitFor(() => expect(events().some(event => event.type === 'REVIEW_RESULT' && event.requestId === 'new')).toBe(true));
    resolve!(evaluation);
    await Promise.resolve(); await Promise.resolve();
    expect(events().some(event => event.type === 'REVIEW_RESULT' && event.requestId === 'old')).toBe(false);
});
it('rejects malformed commands and commands from panel or content contexts', () => {
    const respond = vi.fn();
    listener({ target: 'offscreen', type: 'REVIEW_START' }, { id: 'extension', url: 'chrome-extension://extension/background.js' }, respond);
    expect(respond).toHaveBeenLastCalledWith(expect.objectContaining({ diagnostic: { code: 'PROTOCOL_INVALID' } }));
    listener(job(), { id: 'extension', url: 'chrome-extension://extension/sidepanel.html' }, respond);
    expect(respond).toHaveBeenLastCalledWith(expect.objectContaining({ diagnostic: { code: 'PROTOCOL_UNAUTHORIZED' } }));
    expect(mocks.analyze).not.toHaveBeenCalled();
});
it('does not forward raw engine exception details', async () => {
    mocks.analyze.mockRejectedValue(new Error('private-key-and-position'));
    deliver(job());
    await vi.waitFor(() => expect(events().some(event => event.type === 'REVIEW_ERROR')).toBe(true));
    expect(JSON.stringify(events())).not.toContain('private-key-and-position');
    expect(events().find(event => event.type === 'REVIEW_ERROR')).toMatchObject({ diagnostic: { code: 'ENGINE_UNAVAILABLE' } });
});
it('keeps factual feedback and emits a final safe status when review AI reaches the watchdog', async () => {
    vi.useFakeTimers();
    mocks.explain.mockImplementation((_settings, _fen, _evaluation, signal: AbortSignal) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    deliver(job(true));
    await vi.advanceTimersByTimeAsync(0);
    expect(events().filter(event => event.type === 'REVIEW_RESULT')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(64999);
    expect(events().some(event => event.diagnostic?.code === 'EXPLANATION_TIMEOUT')).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(events().at(-1)).toMatchObject({ type: 'REVIEW_STATUS', text: 'Stockfish feedback ready. AI explanation timed out.', diagnostic: { code: 'EXPLANATION_TIMEOUT' } });
    expect(events().some(event => event.type === 'REVIEW_ERROR' || event.type === 'REVIEW_TEXT')).toBe(false);
});
