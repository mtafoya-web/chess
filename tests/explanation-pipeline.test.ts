import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_POSITION } from 'chess.js';
import { clearExplanationCache, explain, EXPLANATION_BUDGET_MS } from '../src/providers';
import { DEFAULT_SETTINGS, type Evaluation } from '../src/types';

const result: Evaluation = { bestMove: 'e2e4', pvLines: [], promisingMoves: [], evaluation: '+0.2', candidates: [], whiteScore: 0.2 };
const config = () => ({ ...structuredClone(DEFAULT_SETTINGS), keys: { gemini: 'test-credential' } });
const valid = JSON.stringify({ leadFactId: 'recommended.move', toneVariant: 'direct' });
const ollama = (text = valid) => new Response(JSON.stringify({ response: text }) + '\n');
function chromePlan(text: string) {
    const create = vi.fn(async () => ({ destroy: vi.fn(), promptStreaming: () => new ReadableStream({ start(c) { c.enqueue(text); c.close(); } }) }));
    vi.stubGlobal('LanguageModel', { availability: async () => 'available', create });
    return create;
}
afterEach(() => { clearExplanationCache(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('continues from unsupported Chrome claims to a validated local model without leaking prose', async () => {
    chromePlan('White wins a queen by castling queenside.');
    const fetcher = vi.fn(async () => ollama()); vi.stubGlobal('fetch', fetcher);
    const output: string[] = [];
    expect(await explain(config(), DEFAULT_POSITION, result, new AbortController().signal, text => output.push(text))).toBe('ollama');
    expect(output).toHaveLength(1);
    expect(output[0]).toContain('White places a pawn in the center on E4');
    expect(output[0]).not.toMatch(/queen|castling/);
    expect(fetcher).toHaveBeenCalledOnce();
});

it('tries the permitted configured cloud provider when both local plans are invalid', async () => {
    chromePlan('{"leadFactId":"invented","toneVariant":"direct"}');
    vi.stubGlobal('chrome', { runtime: { sendMessage: async () => ({ granted: true }) } });
    const fetcher = vi.fn().mockResolvedValueOnce(ollama('not a plan')).mockResolvedValueOnce(new Response('data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: valid }] } }] }) + '\n'));
    vi.stubGlobal('fetch', fetcher);
    const output = vi.fn();
    expect(await explain(config(), DEFAULT_POSITION, result, new AbortController().signal, output)).toBe('gemini');
    expect(output).toHaveBeenCalledOnce(); expect(fetcher).toHaveBeenCalledTimes(2);
});

it('reuses only validated plans and invalidates them for changed evidence, model, credentials and expiry', async () => {
    vi.useFakeTimers(); const create = chromePlan(valid), settings = config();
    const run = (value = result) => explain(settings, DEFAULT_POSITION, value, new AbortController().signal, () => {});
    await run(); await run(); expect(create).toHaveBeenCalledTimes(1);
    await run({ ...result, depth: 20 }); expect(create).toHaveBeenCalledTimes(2);
    settings.models.ollama = 'another-model'; await run(); expect(create).toHaveBeenCalledTimes(3);
    settings.keys.gemini = 'replacement'; await run(); expect(create).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(300001); await run(); expect(create).toHaveBeenCalledTimes(5);
});

it('keys cached plans by verified opening evidence as well as the position', async () => {
    const create = chromePlan(valid), settings = config();
    const opening = { current: { name: "King's Pawn", eco: 'B00', ply: 1, match: 'sequence' as const } };
    await explain(settings, DEFAULT_POSITION, result, new AbortController().signal, () => {});
    await explain(settings, DEFAULT_POSITION, result, new AbortController().signal, () => {}, () => {}, { summary: '', opening });
    expect(create).toHaveBeenCalledTimes(2);
});

it('does not cache fallbacks, so a recovered model is retried for the same position', async () => {
    vi.stubGlobal('LanguageModel', undefined);
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(ollama()); vi.stubGlobal('fetch', fetcher);
    const settings = config(); settings.keys = { gemini: '' };
    expect(await explain(settings, DEFAULT_POSITION, result, new AbortController().signal, () => {})).toBe('facts');
    expect(await explain(settings, DEFAULT_POSITION, result, new AbortController().signal, () => {})).toBe('ollama');
    expect(fetcher).toHaveBeenCalledTimes(2);
});

it('rechecks host permission before reusing a cached cloud plan', async () => {
    const settings = { ...config(), provider: 'gemini' as const };
    const permission = vi.fn().mockResolvedValueOnce({ granted: true }).mockResolvedValueOnce({ granted: false });
    vi.stubGlobal('chrome', { runtime: { sendMessage: permission } });
    const fetcher = vi.fn(async () => new Response('data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: valid }] } }] }) + '\n')); vi.stubGlobal('fetch', fetcher);
    expect(await explain(settings, DEFAULT_POSITION, result, new AbortController().signal, () => {})).toBe('gemini');
    expect(await explain(settings, DEFAULT_POSITION, result, new AbortController().signal, () => {})).toBe('facts');
    expect(fetcher).toHaveBeenCalledOnce(); expect(permission).toHaveBeenCalledTimes(2);
});

it('bounds the entire automatic provider chain and publishes one factual fallback on expiry', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('LanguageModel', { availability: () => new Promise(() => {}) });
    vi.stubGlobal('chrome', { runtime: { sendMessage: async () => ({ granted: true }) } });
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const output = vi.fn();
    const work = explain(config(), DEFAULT_POSITION, result, new AbortController().signal, output);
    await vi.advanceTimersByTimeAsync(EXPLANATION_BUDGET_MS - 1); expect(output).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(await work).toBe('facts'); expect(output).toHaveBeenCalledOnce();
});
