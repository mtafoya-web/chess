import { ORIGINS, type Evaluation, type ExecutionSettings, type Provider, type RemoteProvider } from './types';
import { diagnostic, createDiagnosticReporter, type DiagnosticReporter } from './diagnostics';
import { explainWithChrome } from './chrome-ai';
import { buildExplanationFacts, type ReviewFacts } from './explanation-facts';
import { coachPrompt, renderExplanation, validatePlan } from './coach-prompt';

export const PROVIDER_NAMES: Record<Provider | 'facts', string> = { facts: 'Kibitz ? verified facts', chrome: 'Chrome AI · local', ollama: 'Ollama · local', gemini: 'Gemini · cloud', openai: 'OpenAI · cloud', groq: 'Groq · cloud' };

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
class InvalidProviderResponse extends Error {
    constructor() { super('Provider returned an invalid response.'); }
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
    if (data.error) throw new Error('Provider returned an error. Check the selected model and account.');
    return REMOTE_ADAPTERS[provider].delta(data);
}
interface RemoteAdapter {
    request(model: string, prompt: string, key?: string): { url: string; headers?: Record<string, string>; payload: object };
    delta(data: Record<string, unknown>): string;
}
const compatibleAdapter = (url: string): RemoteAdapter => ({
    request: (model, prompt, key) => ({ url, headers: { Authorization: `Bearer ${key}` }, payload: {
        model, messages: [{ role: 'user', content: prompt }], stream: true, max_tokens: 180, temperature: 0.2,
    } }), delta: compatibleDelta,
});
const REMOTE_ADAPTERS: Record<RemoteProvider, RemoteAdapter> = {
    ollama: { request: (model, prompt) => ({ url: 'http://localhost:11434/api/generate', payload: {
        model, prompt, stream: true, think: false, options: { num_predict: 160, temperature: 0.2 },
    } }), delta: ollamaDelta },
    gemini: { request: (model, prompt, key) => ({
        url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
        headers: { 'x-goog-api-key': key! }, payload: { contents: [{ parts: [{ text: prompt }] }], generationConfig: {
            maxOutputTokens: 240, temperature: 0.2,
            ...(/^gemini-2\.5-flash/.test(model) ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
        } },
    }), delta: geminiDelta },
    openai: compatibleAdapter('https://api.openai.com/v1/chat/completions'),
    groq: compatibleAdapter('https://api.groq.com/openai/v1/chat/completions'),
};
async function explainRemote(settings: ExecutionSettings, provider: RemoteProvider, prompt: string, signal: AbortSignal, onDelta: (delta: string) => void) {
    const model = settings.models[provider].trim();
    if (!model || /[/?#]/.test(model) && provider === 'gemini') throw new Error('Set a valid model in settings.');
    const key = provider === 'ollama' ? undefined : settings.keys[provider];
    if (provider !== 'ollama' && !key) throw new Error('Add an API key in Kibitz settings.');
    const { url, headers: providerHeaders, payload } = REMOTE_ADAPTERS[provider].request(model, prompt, key);
    const headers = { 'Content-Type': 'application/json', ...providerHeaders };
    let response: Response;
    try { response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload), signal }); }
    catch { signal.throwIfAborted(); throw new Error(provider === 'ollama' ? 'Ollama unavailable. Check its server and allowed extension origin.' : 'Provider unavailable. Check your connection and host permission.'); }
    if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}. Check your model, key and quota.`);
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
export async function explain(settings: ExecutionSettings, fen: string, result: Evaluation, signal: AbortSignal, onDelta: (delta: string) => void, onStatus: (text: string) => void = () => {}, reviewFacts?: ReviewFacts, onDiagnostic: DiagnosticReporter = () => {}): Promise<Provider | 'facts'> {
    signal.throwIfAborted();
    const catalog = buildExplanationFacts(fen, result, reviewFacts);
    const prompt = coachPrompt(catalog);
    const report = createDiagnosticReporter(onDiagnostic);
    const fallback = () => { signal.throwIfAborted(); onDelta(renderExplanation(catalog)); return 'facts' as const; };
    const chain: Provider[] = settings.provider === 'auto' ? ['chrome', 'ollama', settings.cloudProvider] : [settings.provider];
    for (const provider of chain) {
        signal.throwIfAborted();
        if (provider !== 'chrome' && provider !== 'ollama' && !settings.keys[provider]) continue;
        onStatus(`Trying ${PROVIDER_NAMES[provider]}…`);
        const attempt = new AbortController();
        const cancel = () => attempt.abort(signal.reason);
        signal.addEventListener('abort', cancel, { once: true });
        const adapter = ADAPTERS[provider];
        const timeout = setTimeout(() => attempt.abort(new Error('Provider timed out.')), adapter.timeout);
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
                        if (!object(permitted) || permitted.granted !== true) throw new Error('Provider permission unavailable.');
                    }
                    await adapter.explain(settings, prompt, attempt.signal, collect);
                })();
                void work.then(resolve, reject);
            });
            signal.throwIfAborted();
            if (!text.trim()) throw new Error('Empty explanation.');
            // Commit only a successful attempt so a failed stream cannot mix providers' text.
            const plan = validatePlan(text, catalog);
            if (!plan) { report(diagnostic('INVALID_PROVIDER_RESPONSE', { provider })); return fallback(); }
            onDelta(renderExplanation(catalog, plan));
            return provider;
        } catch (error) {
            signal.throwIfAborted();
            report(diagnostic(error instanceof InvalidProviderResponse ? 'INVALID_PROVIDER_RESPONSE' : 'PROVIDER_UNAVAILABLE', { provider }));
            if (settings.provider !== 'auto') return fallback();
        } finally { clearTimeout(timeout); signal.removeEventListener('abort', cancel); attempt.abort(); }
    }
    return fallback();
}
