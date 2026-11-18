import {afterEach,expect,it,vi} from 'vitest';
import {DEFAULT_POSITION} from 'chess.js';
import {testExplanation} from '../src/ai-test';
import {clearExplanationCache,explain} from '../src/providers';
import {DEFAULT_SETTINGS,type ExecutionSettings} from '../src/types';
import {evaluation} from '../src/chess';
import {buildExplanationFacts} from '../src/explanation-facts';
import {coachPrompt,validatePlan} from '../src/coach-prompt';
import {explanationStatus} from '../src/explanation-state';
import {diagnostic,isDiagnostic} from '../src/diagnostics';

const plan = JSON.stringify({leadFactId:'recommended.move',toneVariant:'direct'});
const settings = (provider:ExecutionSettings['provider']='chrome'): ExecutionSettings => ({...structuredClone(DEFAULT_SETTINGS),provider,keys:{}});
const result = evaluation([{uci:'g1f3',san:'Nf3',pv:'Nf3 d5',uciPv:['g1f3','d7d5'],score:0}]);
const response = (text=plan) => new Response(JSON.stringify({response:text})+'\n');
function model(outputs: string[]) {
    let next=0;
    const prompt=vi.fn(async (_prompt:string,_options:unknown)=>outputs[Math.min(next++,outputs.length-1)]);
    const create=vi.fn(async()=>({destroy:vi.fn(),prompt}));
    vi.stubGlobal('LanguageModel',{availability:async()=> 'available',create}); return {create,prompt};
}
afterEach(()=>{clearExplanationCache();vi.unstubAllGlobals();vi.useRealTimers();});

it.each([['unavailable','not-supported'],['downloadable','download-required'],['downloading','downloading']] as const)('reports Chrome %s from the actual inference context',async(availability,reason)=>{
    vi.stubGlobal('LanguageModel',{availability:async()=>availability,create:vi.fn()});
    const test=await testExplanation(settings(),new AbortController().signal);
    expect(test).toMatchObject({provider:'facts',attempts:[{provider:'chrome',reason}]});
    expect(explanationStatus({state:'fallback',provider:'facts',attempts:test.attempts})).not.toContain('unavailable or unsupported');
});
it('tests real inference instead of serving a cached explanation and passes a JSON shape constraint',async()=>{
    const api=model([plan]);
    const first=await testExplanation(settings(),new AbortController().signal);
    const second=await testExplanation(settings(),new AbortController().signal);
    expect(first.provider).toBe('chrome'); expect(second.provider).toBe('chrome'); expect(api.create).toHaveBeenCalledTimes(2);
    expect(api.prompt.mock.calls[0][1]).toMatchObject({responseConstraint:{type:'object',required:['explanation','lesson','evidenceIds']}});
});
it('repairs one local invalid plan without displaying unsupported claims',async()=>{
    const api=model([JSON.stringify({leadFactId:'invented.queen.win',toneVariant:'direct'}),plan]);
    const test=await testExplanation(settings(),new AbortController().signal);
    expect(test.provider).toBe('chrome'); expect(test.attempts).toEqual([{provider:'chrome',reason:'unsupported-facts',stage:'validation'}]);
    expect(api.prompt).toHaveBeenCalledTimes(2); expect(test.text).not.toContain('queen');
});
it('accepts a complete JSON code fence but still rejects invented facts and surrounding prose',()=>{
    const catalog=buildExplanationFacts(DEFAULT_POSITION,result);
    expect(validatePlan('```json\n'+plan+'\n```',catalog)).toBeDefined();
    expect(validatePlan('Here is my answer: '+plan,catalog)).toBeUndefined();
    expect(validatePlan('```json\n'+JSON.stringify({leadFactId:'invented',toneVariant:'direct'})+'\n```',catalog)).toBeUndefined();
    expect(coachPrompt(catalog)).not.toContain('"afterFen"');
    expect(coachPrompt(catalog)).toContain('"uci":"g1f3"');
});
it.each([[401,'authentication'],[403,'permission'],[404,'model'],[429,'quota'],[500,'http']] as const)('reports HTTP %s safely as %s',async(status,reason)=>{
    const fetcher=vi.fn(async()=>new Response('private-response-and-key',{status}));vi.stubGlobal('fetch',fetcher);
    const test=await testExplanation(settings('ollama'),new AbortController().signal);
    expect(test.attempts).toEqual([{provider:'ollama',reason,stage:'generation'}]);expect(JSON.stringify(test)).not.toContain('private-response');
    expect(fetcher).toHaveBeenCalledOnce();
});
it('reports a missing cloud key and connection failure separately without exposing raw exceptions',async()=>{
    vi.stubGlobal('LanguageModel',undefined);vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('private-network-details');}));
    const test=await testExplanation(settings('auto'),new AbortController().signal);
    expect(test.attempts).toEqual([{provider:'chrome',reason:'not-supported',stage:'availability'},{provider:'ollama',reason:'connection',stage:'generation'},{provider:'gemini',reason:'missing-key'}]);
    expect(JSON.stringify(test)).not.toContain('private-network-details');
});
it('sends Ollama a JSON schema and permits only allowlisted diagnostic reasons',async()=>{
    const fetcher=vi.fn(async()=>response());vi.stubGlobal('fetch',fetcher);
    await explain(settings('ollama'),DEFAULT_POSITION,result,new AbortController().signal,()=>{});
    const payload=JSON.parse((fetcher.mock.calls[0] as unknown as [string,RequestInit])[1].body as string);
    expect(payload.format).toMatchObject({type:'object',additionalProperties:false});
    expect(diagnostic('PROVIDER_UNAVAILABLE',{provider:'chrome',reason:'secret-key'})).toEqual({code:'PROVIDER_UNAVAILABLE',provider:'chrome'});
    expect(isDiagnostic({code:'PROVIDER_UNAVAILABLE',provider:'chrome',reason:'timeout'})).toBe(true);
    expect(isDiagnostic({code:'PROVIDER_UNAVAILABLE',provider:'chrome',reason:'timeout',raw:'private'})).toBe(false);
});
