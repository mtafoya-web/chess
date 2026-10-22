import { expect, it, vi } from 'vitest';
import { createDiagnosticReporter, diagnostic, isDiagnostic } from '../src/diagnostics';

it('constructs only fixed safe diagnostic fields', () => {
    const value = diagnostic('PROVIDER_UNAVAILABLE', { provider: 'openai', site: 'lichess', requestId: 'request_42',
        error: new Error('secret'), keys: { openai: 'secret' }, prompt: 'secret', fen: 'secret', headers: 'secret' });
    expect(value).toEqual({ code: 'PROVIDER_UNAVAILABLE', provider: 'openai', site: 'lichess', requestId: 'request_42' });
    expect(JSON.stringify(value)).not.toContain('secret');
});
it('rejects arbitrary contexts, long identifiers and unknown runtime codes', () => {
    expect(diagnostic('PROTOCOL_INVALID', { provider: 'secret', site: 'secret', requestId: 'x'.repeat(121) })).toEqual({ code: 'PROTOCOL_INVALID' });
    expect(diagnostic('secret' as never, { requestId: 'position with spaces' })).toEqual({ code: 'PROTOCOL_INVALID' });
});
it('deduplicates safe categories within one reporter', () => {
    const send = vi.fn(); const report = createDiagnosticReporter(send);
    report(diagnostic('PROVIDER_UNAVAILABLE', { provider: 'chrome' }));
    report(diagnostic('PROVIDER_UNAVAILABLE', { provider: 'chrome', raw: 'other secret' }));
    report(diagnostic('PROVIDER_UNAVAILABLE', { provider: 'ollama' }));
    expect(send).toHaveBeenCalledTimes(2);
});
it('validates diagnostics crossing runtime boundaries without accepting extra data', () => {
    expect(isDiagnostic(diagnostic('ENGINE_UNAVAILABLE', { requestId: 'opaque-id' }))).toBe(true);
    expect(isDiagnostic({ code: 'ENGINE_UNAVAILABLE', error: 'raw private details' })).toBe(false);
    expect(isDiagnostic({ code: 'PROVIDER_UNAVAILABLE', provider: 'unknown' })).toBe(false);
    expect(isDiagnostic({ code: 'PROTOCOL_INVALID', requestId: 'x'.repeat(121) })).toBe(false);
});
