import { afterEach, expect, it, vi } from 'vitest';
import { explainWithChrome } from '../src/chrome-ai';
import { providerFailureText } from '../src/provider-failures';

afterEach(() => vi.unstubAllGlobals());
const unsupported = () => new DOMException('private model details', 'NotSupportedError');

it('retries unsupported constrained generation in a fresh session without the constraint', async () => {
    const first = { prompt: vi.fn().mockRejectedValue(unsupported()), destroy: vi.fn() };
    const second = { prompt: vi.fn().mockResolvedValue('{"explanation":"ok"}'), destroy: vi.fn() };
    const create = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    vi.stubGlobal('LanguageModel', { availability: async () => 'available', create });
    const output = vi.fn(), signal = new AbortController().signal;
    await explainWithChrome('Return the explanation JSON.', signal, output);
    expect(create).toHaveBeenCalledTimes(2);
    expect(first.prompt.mock.calls[0][1]).toMatchObject({ responseConstraint: { type: 'object' } });
    expect(second.prompt.mock.calls[0][1]).toEqual({ signal });
    expect(first.destroy).toHaveBeenCalledOnce(); expect(second.destroy).toHaveBeenCalledOnce();
    expect(output).toHaveBeenCalledOnce(); expect(output).toHaveBeenCalledWith('{"explanation":"ok"}');
});

it('reports unsupported generation separately from browser availability when compatibility retry fails', async () => {
    const destroy = vi.fn(), prompt = vi.fn().mockRejectedValue(unsupported());
    vi.stubGlobal('LanguageModel', { availability: async () => 'available', create: async () => ({ destroy, prompt }) });
    await expect(explainWithChrome('JSON', new AbortController().signal, vi.fn())).rejects.toMatchObject({ reason: 'generation-unsupported', stage: 'generation' });
    expect(destroy).toHaveBeenCalledTimes(2);
    const text = providerFailureText({ provider: 'chrome', reason: 'generation-unsupported', stage: 'generation' });
    expect(text).not.toMatch(/device|private model/); expect(text).toContain('another provider');
});

it.each(['NotAllowedError', 'QuotaExceededError'])('does not retry %s as a compatibility failure', async name => {
    const create = vi.fn(async () => ({ prompt: async () => { throw new DOMException('private', name); }, destroy: vi.fn() }));
    vi.stubGlobal('LanguageModel', { availability: async () => 'available', create });
    await expect(explainWithChrome('JSON', new AbortController().signal, vi.fn())).rejects.toMatchObject({ reason: name === 'NotAllowedError' ? 'permission' : 'context-limit' });
    expect(create).toHaveBeenCalledOnce();
});

it('cancellation after constrained rejection prevents compatibility generation and output', async () => {
    const controller = new AbortController(), output = vi.fn(), destroy = vi.fn();
    const create = vi.fn(async () => ({ destroy, prompt: async () => { controller.abort(); throw unsupported(); } }));
    vi.stubGlobal('LanguageModel', { availability: async () => 'available', create });
    await expect(explainWithChrome('JSON', controller.signal, output)).rejects.toBeDefined();
    expect(create).toHaveBeenCalledOnce(); expect(destroy).toHaveBeenCalledOnce(); expect(output).not.toHaveBeenCalled();
});

it('does not start model download from automatic inference', async () => {
    const create = vi.fn();
    vi.stubGlobal('LanguageModel', { availability: async () => 'downloadable', create });
    await expect(explainWithChrome('JSON', new AbortController().signal, vi.fn())).rejects.toMatchObject({ reason: 'download-required', stage: 'availability' });
    expect(create).not.toHaveBeenCalled();
});
