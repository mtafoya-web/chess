import { afterEach, expect, it, vi } from 'vitest';
import { deltaFrom, explain, records } from '../src/providers';
import { DEFAULT_SETTINGS, settingsFrom, type Evaluation } from '../src/types';
import { DEFAULT_POSITION } from 'chess.js';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const result: Evaluation = { bestMove: 'e2e4', pvLines: [], promisingMoves: [], evaluation: '+0.2', candidates: [], whiteScore: 0.2 };
const settings = () => ({ ...structuredClone(DEFAULT_SETTINGS), keys: {} as Partial<Record<'gemini' | 'openai' | 'groq', string>> });
const response = (text: string) => new Response(text, { status: 200 });
const unavailable = () => vi.stubGlobal('LanguageModel', undefined);
it('buffers fragmented UTF-8, NDJSON, SSE and final unterminated records', async () => {
    const data = new TextEncoder().encode('data: {"choices":[{"delta":{"content":"♞"}}]}\r\n\r\ndata: [DONE]');
    const stream = new ReadableStream<Uint8Array>({ start(c) { for (let i = 0; i < data.length; i += 2) c.enqueue(data.slice(i, i + 2)); c.close(); } });
    const lines: string[] = [];
    for await (const line of records(stream, new AbortController().signal)) lines.push(line);
    expect(lines).toHaveLength(2); expect(deltaFrom(lines[0], 'openai')).toBe('♞'); expect(deltaFrom(lines[1], 'openai')).toBe('');
    expect(deltaFrom('{"response":"Develop your knight.","done":false}', 'ollama')).toBe('Develop your knight.');
    expect(deltaFrom('data: {"candidates":[{"content":{"parts":[{"text":"Center."}]}}]}', 'gemini')).toBe('Center.');
});
it('propagates cancellation and provider errors', async () => {
    const controller = new AbortController(); controller.abort();
    const iterator = records(new ReadableStream(), controller.signal);
    await expect(iterator.next()).rejects.toThrow();
    expect(() => deltaFrom('data: {"error":{"message":"secret"}}', 'groq')).toThrow('Provider returned an error');
});
it('prefers ready Chrome AI and destroys its session without contacting remote providers', async () => {
    const destroy = vi.fn(), fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('LanguageModel', { availability: async () => 'available', create: async () => ({ destroy,
        promptStreaming: () => new ReadableStream({ start(c) { c.enqueue('{"leadFactId":"recommended.move",'); c.enqueue('"toneVariant":"direct"}'); c.close(); } }),
    }) });
    const output: string[] = [];
    expect(await explain(settings(), DEFAULT_POSITION, result, new AbortController().signal, text => output.push(text))).toBe('chrome');
    expect(output.join('')).toContain('White places a pawn in the center on E4'); expect(destroy).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled();
});
it('uses Ollama when Chrome is not ready, without starting a model download', async () => {
    const create = vi.fn(); vi.stubGlobal('LanguageModel', { availability: async () => 'downloadable', create });
    const fetch = vi.fn(async () => response(JSON.stringify({response:JSON.stringify({leadFactId:'recommended.move',toneVariant:'direct'})})+'\n')); vi.stubGlobal('fetch', fetch);
    expect(await explain(settings(), DEFAULT_POSITION, result, new AbortController().signal, () => {})).toBe('ollama');
    expect(fetch.mock.calls).toHaveLength(1); expect(create).not.toHaveBeenCalled();
});
it('discards partial failed output and uses the configured, permitted cloud service last', async () => {
    unavailable(); const config = settings(); config.cloudProvider = 'groq'; config.keys.groq = 'private';
    const permission = vi.fn(async () => ({ granted: true })); vi.stubGlobal('chrome', { runtime: { sendMessage: permission } });
    const fetch = vi.fn().mockResolvedValueOnce(response('{"response":"incomplete"}\n{"error":"failed"}\n'))
        .mockResolvedValueOnce(response('data: '+JSON.stringify({choices:[{delta:{content:JSON.stringify({leadFactId:'recommended.move',toneVariant:'direct'})}}]})+'\n'));
    vi.stubGlobal('fetch', fetch); const output: string[] = [];
    expect(await explain(config, DEFAULT_POSITION, result, new AbortController().signal, text => output.push(text))).toBe('groq');
    expect(output).toHaveLength(1); expect(output[0]).toContain('White places a pawn in the center on E4'); expect(output[0]).not.toContain('incomplete');
    expect(fetch.mock.calls.map(call => call[0])).toEqual(['http://localhost:11434/api/generate', 'https://api.groq.com/openai/v1/chat/completions']);
    expect(permission).toHaveBeenCalledWith({ type: 'PROVIDER_PERMISSION', origin: 'https://api.groq.com/*' });
});
it('never contacts cloud without both a key and host permission', async () => {
    unavailable(); const fetch = vi.fn(async () => { throw new Error('offline'); }); vi.stubGlobal('fetch', fetch);
    const permission = vi.fn(async () => ({ granted: false })); vi.stubGlobal('chrome', { runtime: { sendMessage: permission } });
    const config = settings();
    expect(await explain(config, DEFAULT_POSITION, result, new AbortController().signal, () => {})).toBe('facts');
    expect(permission).not.toHaveBeenCalled();
    config.keys.gemini = 'key';
    expect(await explain(config, DEFAULT_POSITION, result, new AbortController().signal, () => {})).toBe('facts');
    expect(fetch).toHaveBeenCalledTimes(2);
});
it('cancellation stops fallback even when a provider ignores its abort signal', async () => {
    unavailable(); const controller = new AbortController();
    const fetch = vi.fn(() => new Promise<Response>(() => {})); vi.stubGlobal('fetch', fetch);
    const promise = explain(settings(), DEFAULT_POSITION, result, controller.signal, () => {});
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce()); controller.abort();
    await expect(promise).rejects.toThrow(); expect(fetch).toHaveBeenCalledOnce();
});
it('times out a stuck Chrome API and continues to Ollama', async () => {
    vi.useFakeTimers(); vi.stubGlobal('LanguageModel', { availability: () => new Promise(() => {}) });
    vi.stubGlobal('fetch', vi.fn(async () => response(JSON.stringify({response:JSON.stringify({leadFactId:'recommended.move',toneVariant:'direct'})})+'\n')));
    const promise = explain(settings(), DEFAULT_POSITION, result, new AbortController().signal, () => {});
    await vi.advanceTimersByTimeAsync(12001); expect(await promise).toBe('ollama');
});
it('migrates legacy preferences to automatic mode without retaining credentials', () => {
    const migrated = settingsFrom({ provider: 'openai', models: { ollama: 'my-model' }, keys: { openai: 'saved-key' } });
    expect(migrated).toMatchObject({ provider: 'auto', cloudProvider: 'openai', models: { ollama: 'my-model' } });
    expect(migrated).not.toHaveProperty('keys');
    expect(settingsFrom({ ...migrated, provider: 'ollama' }).provider).toBe('ollama');
});

it('rejects hallucinated provider prose before publishing and attributes the factual fallback honestly', async () => {
    unavailable(); vi.stubGlobal('fetch', vi.fn(async () => response('{"response":"White has a queen on e4 and wins a rook."}\n')));
    const output: string[] = [];
    expect(await explain(settings(), DEFAULT_POSITION, result, new AbortController().signal, text => output.push(text))).toBe('facts');
    expect(output).toHaveLength(1); expect(output[0]).toContain('White places a pawn in the center on E4'); expect(output[0]).not.toContain('queen');
});

it.each([
    ['null', 'ollama'], ['[]', 'ollama'], ['{"response":{}}', 'ollama'],
    ['{"choices":{}}', 'openai'], ['{"choices":[{"delta":{"content":42}}]}', 'groq'],
    ['{"candidates":[{"content":{"parts":[null]}}]}', 'gemini'],
] as const)('rejects malformed decoded provider JSON: %s', (record, provider) => {
    expect(() => deltaFrom(record, provider)).toThrow('invalid response');
});
it('reports invalid completed plans safely and immediately falls back without paid requests', async () => {
    unavailable(); const config = settings(); config.keys.gemini = 'credential-secret';
    const fetch = vi.fn(async () => response('{"response":"unchecked secret model prose"}\n'));
    vi.stubGlobal('fetch', fetch); const report = vi.fn();
    expect(await explain(config, DEFAULT_POSITION, result, new AbortController().signal, () => {}, () => {}, undefined, report)).toBe('facts');
    expect(fetch).toHaveBeenCalledOnce();
    expect(report.mock.calls.map(([value]) => value)).toEqual([
        { code: 'PROVIDER_UNAVAILABLE', provider: 'chrome' }, { code: 'INVALID_PROVIDER_RESPONSE', provider: 'ollama' },
    ]);
    expect(JSON.stringify(report.mock.calls)).not.toContain('secret');
});
it('emits no failure diagnostic for ordinary cancellation', async () => {
    vi.stubGlobal('LanguageModel', { availability: () => new Promise(() => {}) });
    const controller = new AbortController(); const report = vi.fn();
    const promise = explain(settings(), DEFAULT_POSITION, result, controller.signal, () => {}, () => {}, undefined, report);
    controller.abort(); await expect(promise).rejects.toThrow(); expect(report).not.toHaveBeenCalled();
});
it.each(['openai', 'groq', 'gemini'] as const)('constructs the %s transport without exposing the key in its URL or payload', async provider => {
    const config = settings(); config.provider = provider; config.keys[provider] = 'private-sentinel';
    vi.stubGlobal('chrome', { runtime: { sendMessage: async () => ({ granted: true }) } });
    const plan = JSON.stringify({ leadFactId: 'recommended.move', toneVariant: 'direct' });
    const body = provider === 'gemini' ? { candidates: [{ content: { parts: [{ text: plan }] } }] } : { choices: [{ delta: { content: plan } }] };
    const fetch = vi.fn(async () => response('data: ' + JSON.stringify(body) + '\n')); vi.stubGlobal('fetch', fetch);
    expect(await explain(config, DEFAULT_POSITION, result, new AbortController().signal, () => {})).toBe(provider);
    const [url, request] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain('private-sentinel'); expect(request.body).not.toContain('private-sentinel');
    expect(request.headers).toMatchObject(provider === 'gemini' ? { 'x-goog-api-key': 'private-sentinel' } : { Authorization: 'Bearer private-sentinel' });
});
it.each([['ollama', 25000], ['openai', 20000]] as const)('bounds a stuck %s transport at its existing timeout', async (provider, milliseconds) => {
    vi.useFakeTimers(); const config = settings(); config.provider = provider;
    config.keys.openai = 'private';
    vi.stubGlobal('chrome', { runtime: { sendMessage: async () => ({ granted: true }) } });
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    let complete = false;
    const promise = explain(config, DEFAULT_POSITION, result, new AbortController().signal, () => {}).then(value => { complete = true; return value; });
    await vi.advanceTimersByTimeAsync(milliseconds - 1); expect(complete).toBe(false);
    await vi.advanceTimersByTimeAsync(1); expect(await promise).toBe('facts');
});
it('clips collection at 600 characters and cancels the provider stream', async () => {
    const config = settings(); config.provider = 'ollama'; const cancel = vi.fn();
    const encoder = new TextEncoder();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({
        start(controller) { controller.enqueue(encoder.encode(JSON.stringify({ response: 'x'.repeat(1000) }) + '\n')); }, cancel,
    }))));
    const output: string[] = [];
    expect(await explain(config, DEFAULT_POSITION, result, new AbortController().signal, text => output.push(text))).toBe('facts');
    expect(cancel).toHaveBeenCalledOnce(); expect(output).toHaveLength(1); expect(output[0]).not.toContain('xxxx');
});
it('includes a stuck permission check in the cloud deadline', async () => {
    vi.useFakeTimers(); const config = settings(); config.provider = 'gemini'; config.keys.gemini = 'private';
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('chrome', { runtime: { sendMessage: () => new Promise(() => {}) } });
    const report = vi.fn();
    const promise = explain(config, DEFAULT_POSITION, result, new AbortController().signal, () => {}, () => {}, undefined, report);
    await vi.advanceTimersByTimeAsync(20000);
    expect(await promise).toBe('facts'); expect(fetch).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledWith({ code: 'PROVIDER_UNAVAILABLE', provider: 'gemini' });
});
it('cancels a stalled permission check and ignores a late grant', async () => {
    const config = settings(); config.provider = 'groq'; config.keys.groq = 'private';
    const controller = new AbortController(); const report = vi.fn(); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    let grant!: (value: unknown) => void;
    vi.stubGlobal('chrome', { runtime: { sendMessage: () => new Promise(resolve => { grant = resolve; }) } });
    const promise = explain(config, DEFAULT_POSITION, result, controller.signal, () => {}, () => {}, undefined, report);
    controller.abort(); await expect(promise).rejects.toThrow(); grant({ granted: true });
    await Promise.resolve(); await Promise.resolve();
    expect(fetch).not.toHaveBeenCalled(); expect(report).not.toHaveBeenCalled();
});
