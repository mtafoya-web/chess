import { ORIGINS, type Evaluation, type ExecutionSettings, type Provider, type RemoteProvider } from './types';
import { diagnostic, createDiagnosticReporter, type DiagnosticReporter } from './diagnostics';
import { explainWithChrome } from './chrome-ai';
import { buildExplanationFacts, type ReviewFacts } from './explanation-facts';
import { COACH_PROFILE, coachPrompt, planJson, renderExplanation, validatePlan, type ExplanationPlan } from './coach-prompt';
import { PROVIDER_NAMES } from './explanation-state';
import { ProviderFailure, failureReason, type FailureReason } from './provider-failures';
import { EXPLANATION_SCHEMA } from './explanation-schema';

export { PROVIDER_NAMES } from './explanation-state';

// Offscreen-memory only. Cache approved plans, never failed attempts or rendered fallbacks.
const plans = new Map<string, { plan: ExplanationPlan; expires: number }>();
let configuration = '';
export function clearExplanationCache() { plans.clear(); configuration = ''; }
export const EXPLANATION_BUDGET_MS = 45000;

// Both SSE and NDJSON records may be split anywhere across network chunks.
export async function* records(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncGenerator<string> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const abort = () => { void reader.cancel().catch(() => {}); };
    signal.addEventListener('abort', abort, { once: true });
    try {
        while (!signal.aborted) {
            const { value, done } = await reader.read();
            buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
            let newline: number;
            while ((newline = buffer.indexOf('\n')) !== -1) {
                const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1);
                if (line) yield line;
            }
            if (done) { if (buffer.trim()) yield buffer.trim(); break; }
        }
        signal.throwIfAborted();
    } finally { signal.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
class InvalidProviderResponse extends ProviderFailure {
    constructor(reason: FailureReason = 'invalid-format') { super(reason); this.message = 'Provider returned an invalid response.'; }
}
function invalidPlanReason(text: string): FailureReason {
    try { const value = JSON.parse(planJson(text)); return value && typeof value === 'object' && typeof value.leadFactId === 'string' ? 'unsupported-facts' : 'invalid-format'; } catch { return 'invalid-format'; }
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function stringDelta(value: unknown): string {
    if (value === undefined || value === null) return '';
    if (typeof value !== 'string') throw new InvalidProviderResponse();
    return value;
}
function ollamaDelta(data: Record<string, unknown>): string { return stringDelta(data.response); }
function geminiDelta(data: Record<string, unknown>): string {
    if (data.candidates === undefined) return '';
    if (!Array.isArray(data.candidates)) throw new InvalidProviderResponse();
    const first: unknown = data.candidates[0];
    if (first === undefined) return '';
    if (!object(first)) throw new InvalidProviderResponse();
    if (first.content === undefined) return '';
    if (!object(first.content) || !Array.isArray(first.content.parts)) throw new InvalidProviderResponse();
    return first.content.parts.map((part: unknown) => {
        if (!object(part)) throw new InvalidProviderResponse();
        return stringDelta(part.text);
    }).join('');
}
function compatibleDelta(data: Record<string, unknown>): string {
    if (data.choices === undefined) return '';
    if (!Array.isArray(data.choices)) throw new InvalidProviderResponse();
    const first: unknown = data.choices[0];
    if (first === undefined) return '';
    if (!object(first)) throw new InvalidProviderResponse();
    if (first.delta === undefined) return '';
    if (!object(first.delta)) throw new InvalidProviderResponse();
    return stringDelta(first.delta.content);
}
export function deltaFrom(record: string, provider: RemoteProvider): string {
    if (record.startsWith(':') || /^(event|id|retry):/.test(record)) return '';
    const text = record.replace(/^data:\s*/, '');
    if (text === '[DONE]') return '';
    let data: unknown;
    try { data = JSON.parse(text); } catch { throw new InvalidProviderResponse(); }
    if (!object(data)) throw new InvalidProviderResponse();
    if (data.error) { const error = new ProviderFailure('http'); error.message = 'Provider returned an error. Check the selected model and account.'; throw error; }
    return REMOTE_ADAPTERS[provider].delta(data);
}
interface RemoteAdapter {
    request(model: string, prompt: string, key?: string): { url: string; headers?: Record<string, string>; payload: object };
    delta(data: Record<string, unknown>): string;
}
const compatibleAdapter = (url: string, json = false): RemoteAdapter => ({
    request: (model, prompt, key) => ({ url, headers: { Authorization: `Bearer ${key}` }, payload: {
        model, messages: [{ role: 'user', content: prompt }], stream: true, max_tokens: 240, temperature: 0.2,
        ...(json ? {response_format:{type:'json_object'}} : {}),
    } }), delta: compatibleDelta,
});
const REMOTE_ADAPTERS: Record<RemoteProvider, RemoteAdapter> = {
    ollama: { request: (model, prompt) => ({ url: 'http://localhost:11434/api/generate', payload: {
        model, prompt, stream: true, think: false, format: EXPLANATION_SCHEMA, options: { num_predict: 240, temperature: 0.2 },
    } }), delta: ollamaDelta },
    gemini: { request: (model, prompt, key) => ({
        url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
        headers: { 'x-goog-api-key': key! }, payload: { contents: [{ parts: [{ text: prompt }] }], generationConfig: {
            maxOutputTokens: 300, temperature: 0.2, responseMimeType: 'application/json',
            ...(/^gemini-2\.5-flash/.test(model) ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
        } },
    }), delta: geminiDelta },
    openai: compatibleAdapter('https://api.openai.com/v1/chat/completions', true),
    groq: compatibleAdapter('https://api.groq.com/openai/v1/chat/completions'),
};
async function explainRemote(settings: ExecutionSettings, provider: RemoteProvider, prompt: string, signal: AbortSignal, onDelta: (delta: string) => void) {
    const model = settings.models[provider].trim();
    if (!model || /[/?#]/.test(model) && provider === 'gemini') throw new ProviderFailure('model');
    const key = provider === 'ollama' ? undefined : settings.keys[provider];
    if (provider !== 'ollama' && !key) throw new ProviderFailure('missing-key');
    const { url, headers: providerHeaders, payload } = REMOTE_ADAPTERS[provider].request(model, prompt, key);
    const headers = { 'Content-Type': 'application/json', ...providerHeaders };
    let response: Response;
    try { response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload), signal }); }
    catch { signal.throwIfAborted(); throw new ProviderFailure('connection'); }
    if (!response.ok) throw new ProviderFailure(response.status === 401 ? 'authentication' : response.status === 403 ? 'permission' : response.status === 429 ? 'quota' : response.status === 404 ? 'model' : 'http');
    if (!response.body) throw new Error('Provider returned no stream.');
    let total = 0;
    for await (const record of records(response.body, signal)) {
        const delta = deltaFrom(record, provider);
        if (delta) { const clipped = delta.slice(0, 600 - total); total += clipped.length; if (clipped) onDelta(clipped); }
        if (total >= 600) break;
    }
    if (!total) throw new Error('Provider returned no explanation. Try another model.');
}

interface ProviderAdapter {
    timeout: number;
    explain(settings: ExecutionSettings, prompt: string, signal: AbortSignal, onDelta: (delta: string) => void): Promise<void>;
}
const remoteAdapter = (provider: RemoteProvider): ProviderAdapter => ({
    timeout: provider === 'ollama' ? 25000 : 20000,
    explain: (settings, prompt, signal, onDelta) => explainRemote(settings, provider, prompt, signal, onDelta),
});
const ADAPTERS: Record<Provider, ProviderAdapter> = {
    chrome: { timeout: 12000, explain: (_settings, prompt, signal, onDelta) => explainWithChrome(prompt, signal, onDelta) },
    ollama: remoteAdapter('ollama'), gemini: remoteAdapter('gemini'), openai: remoteAdapter('openai'), groq: remoteAdapter('groq'),
};
export async function explain(settings: ExecutionSettings, fen: string, result: Evaluation, signal: AbortSignal, onDelta: (delta: string) => void, onStatus: (text: string) => void = () => {}, reviewFacts?: ReviewFacts, onDiagnostic: DiagnosticReporter = () => {}, options: {cache?:boolean} = {}): Promise<Provider | 'facts'> {
    signal.throwIfAborted();
    // Changing models, provider preferences or credentials invalidates every plan.
    // Credentials stay only in this private configuration snapshot, never in cache keys.
    const nextConfiguration = JSON.stringify(settings);
    if (configuration !== nextConfiguration) { clearExplanationCache(); configuration = nextConfiguration; }
    const deadline = Date.now() + EXPLANATION_BUDGET_MS;
    const catalog = buildExplanationFacts(fen, result, reviewFacts);
    const prompt = coachPrompt(catalog);
    const report = createDiagnosticReporter(onDiagnostic);
    const fallback = () => { signal.throwIfAborted(); onDelta(renderExplanation(catalog)); return 'facts' as const; };
    const chain: Provider[] = settings.provider === 'auto' ? ['chrome', 'ollama', settings.cloudProvider] : [settings.provider];
    for (const provider of chain) {
        signal.throwIfAborted();
        if (Date.now() >= deadline) break;
        if (provider !== 'chrome' && provider !== 'ollama' && !settings.keys[provider]) { report(diagnostic('PROVIDER_UNAVAILABLE',{provider,reason:'missing-key'})); continue; }
        onStatus(`Trying ${PROVIDER_NAMES[provider]}…`);
        const attempt = new AbortController();
        const cancel = () => attempt.abort(signal.reason);
        signal.addEventListener('abort', cancel, { once: true });
        const adapter = ADAPTERS[provider];
        const timeout = setTimeout(() => attempt.abort(new ProviderFailure('timeout')), Math.min(adapter.timeout, deadline - Date.now()));
        // The complete catalog includes history, branch, opening metadata and evidence.
        const cacheKey = JSON.stringify([COACH_PROFILE, provider, catalog]);
        const cached = plans.get(cacheKey);
        const approved = options.cache !== false && cached && cached.expires > Date.now() ? validatePlan(JSON.stringify(cached.plan), catalog) : undefined;
        let reused: ExplanationPlan | undefined;
        let text = '';
        const collect = (delta: string) => { text += delta.slice(0, Math.max(0, 600 - text.length)); };
        try {
            // Race also covers APIs or connections that fail to settle after an abort.
            await new Promise<void>((resolve, reject) => {
                attempt.signal.addEventListener('abort', () => reject(attempt.signal.reason), { once: true });
                const work = (async () => {
                    if (provider !== 'chrome' && provider !== 'ollama') {
                        // Include the service-worker permission check in the provider deadline.
                        const permitted: unknown = await chrome.runtime.sendMessage({ type: 'PROVIDER_PERMISSION', origin: ORIGINS[provider] });
                        attempt.signal.throwIfAborted();
                        if (!object(permitted) || permitted.granted !== true) throw new ProviderFailure('permission');
                    }
                    if (approved) reused = approved;
                    else {
                        await adapter.explain(settings, prompt, attempt.signal, collect);
                        // One local repair, inside the same deadline. Never repeat paid inference automatically.
                        if ((provider === 'chrome' || provider === 'ollama') && !validatePlan(text,catalog)) {
                            report(diagnostic('INVALID_PROVIDER_RESPONSE',{provider,reason:invalidPlanReason(text)}));
                            onStatus(`Retrying ${PROVIDER_NAMES[provider]} with the approved fact IDs…`);
                            text = '';
                            await adapter.explain(settings, `${prompt}\nYour last plan was invalid. Return only JSON using the exact approved fact IDs. Omit uncertain support, reply and evidenceStepIds.`, attempt.signal, collect);
                        }
                    }
                })();
                void work.then(resolve, reject);
            });
            signal.throwIfAborted();
            if (!reused && !text.trim()) throw new InvalidProviderResponse();
            // Commit only a successful attempt so a failed stream cannot mix providers' text.
            const plan = reused ?? validatePlan(text, catalog);
            if (!plan) throw new InvalidProviderResponse(invalidPlanReason(text));
            plans.delete(cacheKey);
            if (options.cache !== false && configuration === nextConfiguration) plans.set(cacheKey, { plan, expires: Date.now() + 300000 });
            while (plans.size > 40) plans.delete(plans.keys().next().value!);
            onDelta(renderExplanation(catalog, plan));
            return provider;
        } catch (error) {
            signal.throwIfAborted();
            report(diagnostic(error instanceof InvalidProviderResponse ? 'INVALID_PROVIDER_RESPONSE' : 'PROVIDER_UNAVAILABLE', { provider, reason:failureReason(error) }));
            if (settings.provider !== 'auto') return fallback();
        } finally { clearTimeout(timeout); signal.removeEventListener('abort', cancel); attempt.abort(); }
    }
    return fallback();
}
