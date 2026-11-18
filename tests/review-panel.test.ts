// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ReviewPanel } from '../src/review-panel';
import { sessionFromMoves } from '../src/review-session';
import { DEFAULT_REVIEW_PREFERENCES } from '../src/review-scoring';
import { evaluation } from '../src/chess';
import type { ReviewState } from '../src/review-model';
let panel:ReviewPanel;
let state:ReviewState;
const send=vi.fn(async(message:any):Promise<any>=>{
    if(message.type==='GET_REVIEW_STATE')return {state:structuredClone(state)};
    if(message.type==='GET_REVIEW_PREFERENCES')return {preferences:DEFAULT_REVIEW_PREFERENCES};
    if(message.type==='GET_LEARNING_HISTORY')return {history:[]};
    return {ok:true};
});
beforeEach(()=>{
    vi.useFakeTimers();send.mockClear();document.documentElement.innerHTML=readFileSync('sidepanel.html','utf8').replace(/<script[^>]*>[\s\S]*?<\/script>/g,'');
    const session=sessionFromMoves(['e4'],undefined,{url:'https://lichess.org/abcdefgh',gameId:'abcdefgh'});
    state={session,assessments:[{ply:1,before:evaluation([{uci:'e2e4',san:'e4',pv:'e4',score:0}]),after:evaluation([{uci:'e7e5',san:'e5',pv:'e5',score:0}]),feedback:{label:'Good',summary:'Sound.'}}],preferences:{...DEFAULT_REVIEW_PREFERENCES},running:false,updatedAt:1,attempts:[]};
    vi.stubGlobal('chrome',{runtime:{sendMessage:send}});panel=new ReviewPanel();
});
afterEach(()=>{panel.destroy();vi.useRealTimers();vi.unstubAllGlobals();document.body.replaceChildren();});
it('loads an overview immediately, exposes graph-equivalent position selection, and keeps settings optional',async()=>{
    await vi.advanceTimersByTimeAsync(0);
    expect(document.getElementById('review-overview')!.textContent).toContain('Kibitz accuracy');
    expect(document.getElementById('settings-page')!.hidden).toBe(true);
    const select=document.querySelector<HTMLSelectElement>('#review-overview select')!;select.value='1';select.dispatchEvent(new Event('change'));
    expect(send).toHaveBeenCalledWith({type:'REVIEW_CONTROL',sessionId:state.session.id,action:'select',ply:1});
});
it('removes overview spoilers during practice even while an overview control has focus',async()=>{
    await vi.advanceTimersByTimeAsync(0);document.querySelector<HTMLSelectElement>('#review-overview select')!.focus();
    state.practicePly=1;panel.changed();await vi.advanceTimersByTimeAsync(0);
    const overview=document.getElementById('review-overview')!;
    expect(overview.textContent).toContain('Practice in progress');expect(overview.textContent).not.toContain('100.0%');expect(overview.querySelector('svg')).toBeNull();
});
it('offers an explicit resume after exit and a deliberate history-clear action',async()=>{
    state.active=false;panel.changed();await vi.advanceTimersByTimeAsync(0);
    const resume=document.querySelector<HTMLButtonElement>('#review-overview button')!;expect(resume.textContent).toBe('Resume review');resume.click();await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledWith({type:'START_PAGE_REVIEW'});
    const clear=document.getElementById('clear-history')!;clear.click();expect(send.mock.calls.some(([m])=>m.type==='DELETE_LEARNING_HISTORY')).toBe(false);clear.click();await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledWith({type:'DELETE_LEARNING_HISTORY'});
});
