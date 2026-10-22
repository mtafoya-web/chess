import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Chess, DEFAULT_POSITION } from 'chess.js';

const board = new Chess(); board.move('e4');
const fen = board.fen();
const history = { sessionId: 'test', initialFen: DEFAULT_POSITION, moves: ['e2e4'], ply: 1 };
const rows = [['B00', "King's Pawn", 'e2e4', fen.split(' ').slice(0, 4).join(' ')]];
const fetcher = vi.fn<typeof fetch>();
beforeEach(() => {
    vi.resetModules(); fetcher.mockReset();
    vi.stubGlobal('chrome', {runtime:{getURL:(path:string)=>`chrome-extension://test/${path}`}});
    vi.stubGlobal('fetch', fetcher);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it('does not load opening data for FEN-only or custom-start positions', async () => {
    const {loadOpeningContext} = await import('../src/opening-loader');
    expect(await loadOpeningContext(fen)).toEqual({});
    expect(await loadOpeningContext(fen, {...history,initialFen:fen,moves:[],ply:0})).toEqual({});
    expect(fetcher).not.toHaveBeenCalled();
});
it('shares a single lazy load and reuses the initialized lookup', async () => {
    let resolve!: (response:Response)=>void;
    fetcher.mockReturnValue(new Promise(r=>{resolve=r;}));
    const {loadOpeningContext,cachedOpeningContext} = await import('../src/opening-loader');
    expect(cachedOpeningContext(fen,history)).toBeUndefined();
    const first=loadOpeningContext(fen,history), second=loadOpeningContext(fen,history);
    expect(fetcher).toHaveBeenCalledTimes(1);
    resolve(Response.json(rows));
    expect((await first).current?.name).toBe("King's Pawn");
    expect(await second).toEqual(await first);
    expect(cachedOpeningContext(fen,history)).toEqual(await first);
    await loadOpeningContext(fen,history); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe('chrome-extension://test/data/openings.json');
});
it('cancels one waiting request without poisoning another shared load', async () => {
    let resolve!: (response:Response)=>void;
    fetcher.mockReturnValue(new Promise(r=>{resolve=r;}));
    const {loadOpeningContext} = await import('../src/opening-loader');
    const controller=new AbortController();
    const cancelled=loadOpeningContext(fen,history,undefined,controller.signal);
    const rejection=expect(cancelled).rejects.toMatchObject({name:'AbortError'});
    const next=loadOpeningContext(fen,history);
    controller.abort(); await rejection;
    resolve(Response.json(rows)); expect((await next).current?.name).toBe("King's Pawn");
});
it('keeps failure optional, backs off, then retries instead of caching failure forever', async () => {
    vi.useFakeTimers();
    fetcher.mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue(Response.json(rows));
    const {loadOpeningContext} = await import('../src/opening-loader');
    expect(await loadOpeningContext(fen,history)).toEqual({});
    expect(await loadOpeningContext(fen,history)).toEqual({}); expect(fetcher).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30001);
    expect((await loadOpeningContext(fen,history)).current?.name).toBe("King's Pawn");
});
it.each([null, [[1,2,3,4]], {rows}, [['B00','test','e2e4']]])('ignores malformed packaged data: %j', async value => {
    fetcher.mockResolvedValue(Response.json(value));
    const {loadOpeningContext}=await import('../src/opening-loader');
    expect(await loadOpeningContext(fen,history)).toEqual({});
});
it('keeps HTTP failures optional and preserves exact position verification', async () => {
    fetcher.mockResolvedValueOnce(new Response('',{status:404}));
    const {loadOpeningContext}=await import('../src/opening-loader');
    expect(await loadOpeningContext(fen,history)).toEqual({});
    vi.resetModules(); fetcher.mockResolvedValue(Response.json(rows));
    const next=await import('../src/opening-loader');
    expect(await next.loadOpeningContext(DEFAULT_POSITION,history)).toEqual({});
});

it('labels exact FEN book matches separately from historical opening recognition and shares the index', async()=>{
    fetcher.mockResolvedValue(Response.json(rows));
    const {loadOpeningContext,loadAnalysisOpeningContext}=await import('../src/opening-loader');
    const position=await loadAnalysisOpeningContext(fen);
    expect(position.currentPosition).toMatchObject({name:"King's Pawn",eco:'B00',source:'local-position-match',fen});
    expect(await loadOpeningContext(fen)).toEqual({});
    expect((await loadOpeningContext(fen,history)).current?.name).toBe("King's Pawn");
    expect(fetcher).toHaveBeenCalledTimes(1);
});
it('keeps position-book lookup optional and cancels one caller without poisoning a shared lookup', async()=>{
    let resolve!:(response:Response)=>void;
    fetcher.mockReturnValue(new Promise(r=>{resolve=r;}));
    const {loadAnalysisOpeningContext}=await import('../src/opening-loader');
    const controller=new AbortController();
    const cancelled=loadAnalysisOpeningContext(fen,undefined,controller.signal);
    const rejection=expect(cancelled).rejects.toMatchObject({name:'AbortError'});
    const next=loadAnalysisOpeningContext(fen);
    controller.abort(); await rejection;
    resolve(Response.json(rows));expect((await next).currentPosition?.name).toBe("King's Pawn");
    expect(fetcher).toHaveBeenCalledTimes(1);
});
