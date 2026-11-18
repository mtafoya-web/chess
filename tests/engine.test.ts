import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { Chess } from 'chess.js';
import { Engine } from '../src/engine';

class WorkerMock {
    static instances: WorkerMock[] = [];
    onmessage: ((event: {data: string}) => void) | null = null;
    onerror: (() => void) | null = null;
    messages: string[] = [];
    terminated = false;
    constructor() { WorkerMock.instances.push(this); }
    terminate() { this.terminated = true; }
    postMessage(message: string) {
        this.messages.push(message);
        if (message === 'uci') this.emit('uciok');
        if (message === 'isready') this.emit('readyok');
    }
    emit(data: string) { this.onmessage?.({data}); }
}
const line = (depth: number, rank: number, move: string) => `info depth ${depth} multipv ${rank} score cp ${30-rank} pv ${move}`;
const finish = (worker: WorkerMock) => {
    worker.emit(line(10,1,'e2e4'));worker.emit(line(10,2,'d2d4'));worker.emit(line(10,3,'g1f3'));
    worker.emit(line(11,1,'e2e4'));worker.emit('bestmove e2e4');
};
beforeEach(()=>{WorkerMock.instances=[];vi.stubGlobal('Worker',WorkerMock);vi.stubGlobal('chrome',{runtime:{getURL:(s:string)=>s}});});
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
it('reuses a ready worker and never mixes MultiPV depths',async()=>{
    const engine=new Engine(),signal=new AbortController().signal;
    const first=engine.analyze(new Chess().fen(),signal);finish(WorkerMock.instances[0]);
    const result=await first;expect(result.candidates.map(c=>c.depth)).toEqual([10,10,10]);
    expect(result.search).toMatchObject({movetime:1500,multiPV:3});
    engine.cancel();expect(WorkerMock.instances[0].terminated).toBe(false);
    const second=engine.analyze(new Chess().fen(),signal,undefined,'confirm');finish(WorkerMock.instances[0]);await second;
    expect(WorkerMock.instances).toHaveLength(1);
    expect(WorkerMock.instances[0].messages.filter(m=>m==='uci')).toHaveLength(1);
    expect(WorkerMock.instances[0].messages).toContain('go movetime 5000');
});
it('terminates canceled work and isolates its late output',async()=>{
    const engine=new Engine(),controller=new AbortController();
    const first=engine.analyze(new Chess().fen(),controller.signal);const rejected=expect(first).rejects.toMatchObject({name:'AbortError'});
    controller.abort();await rejected;expect(WorkerMock.instances[0].terminated).toBe(true);
    const second=engine.analyze(new Chess().fen(),new AbortController().signal);finish(WorkerMock.instances[0]);finish(WorkerMock.instances[1]);
    expect((await second).bestMove).toBe('e2e4');
});
it('restarts once after a worker failure and bounds repeated failures',async()=>{
    const engine=new Engine(),work=engine.analyze(new Chess().fen(),new AbortController().signal);
    WorkerMock.instances[0].onerror?.();await vi.waitFor(()=>expect(WorkerMock.instances).toHaveLength(2));
    expect(WorkerMock.instances).toHaveLength(2);finish(WorkerMock.instances[1]);await work;
    const failed=engine.analyze(new Chess().fen(),new AbortController().signal);const rejected=expect(failed).rejects.toThrow('failed to load');
    WorkerMock.instances[1].onerror?.();await vi.waitFor(()=>expect(WorkerMock.instances).toHaveLength(3));WorkerMock.instances[2].onerror?.();await rejected;
    expect(WorkerMock.instances).toHaveLength(3);
});
it('does not start a worker for actual terminal positions',async()=>{
    const result=await new Engine().analyze('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1',new AbortController().signal);
    expect(result.terminal).toBe('Stalemate');expect(WorkerMock.instances).toHaveLength(0);
});
