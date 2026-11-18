import { DEFAULT_POSITION } from 'chess.js';
import { evaluation } from './chess';
import { explain } from './providers';
import type { ExecutionSettings } from './types';
import type { AiTestResult, ProviderAttempt } from './provider-failures';

/** A known legal sample tests real inference and validation, without starting Stockfish or using cached output. */
export async function testExplanation(settings: ExecutionSettings, signal: AbortSignal): Promise<AiTestResult> {
    const sample = evaluation([{uci:'g1f3',san:'Nf3',pv:'Nf3 d5',score:0,uciPv:['g1f3','d7d5']}]);
    const attempts: ProviderAttempt[] = []; let text = '';
    const provider = await explain(settings, DEFAULT_POSITION, sample, signal, delta => {text += delta;}, () => {}, {summary:'',mode:'analysis'}, value => {
        if (value.provider && value.reason && attempts.length < 10 && !attempts.some(a=>a.provider===value.provider && a.reason===value.reason)) attempts.push({provider:value.provider,reason:value.reason});
    }, {cache:false});
    signal.throwIfAborted();
    return {provider, text, attempts};
}
