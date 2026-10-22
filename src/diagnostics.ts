/** Diagnostics are data, never exception messages or provider payloads. */
export const DIAGNOSTIC_CODES = [
    'UNSUPPORTED_BOARD_STATE', 'SITE_ADAPTER_UNAVAILABLE', 'PROVIDER_UNAVAILABLE',
    'ENGINE_UNAVAILABLE', 'INVALID_PROVIDER_RESPONSE', 'SETTINGS_MIGRATION_FAILED',
    'SETTINGS_SAVE_FAILED', 'PROTOCOL_INVALID', 'PROTOCOL_UNAUTHORIZED', 'EXPLANATION_TIMEOUT',
] as const;
export type DiagnosticCode = typeof DIAGNOSTIC_CODES[number];
export interface Diagnostic {
    code: DiagnosticCode;
    provider?: 'chrome' | 'ollama' | 'gemini' | 'openai' | 'groq';
    site?: 'chesscom' | 'lichess';
    requestId?: string;
}
export type DiagnosticReporter = (value: Diagnostic) => void;
export function isDiagnostic(value: unknown): value is Diagnostic {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const input = value as Record<string, unknown>;
    if (!DIAGNOSTIC_CODES.includes(input.code as DiagnosticCode)) return false;
    const safe = diagnostic(input.code as DiagnosticCode, input);
    return Object.keys(input).every(key => Object.hasOwn(safe, key)) && Object.keys(safe).every(key => input[key] === safe[key as keyof Diagnostic]);
}
export function diagnostic(code: DiagnosticCode, context: unknown = {}): Diagnostic {
    // Construct afresh: spreading a caller-supplied context could leak secrets.
    const result: Diagnostic = { code: DIAGNOSTIC_CODES.includes(code) ? code : 'PROTOCOL_INVALID' };
    if (!context || typeof context !== 'object') return result;
    const input = context as Record<string, unknown>;
    if (['chrome', 'ollama', 'gemini', 'openai', 'groq'].includes(input.provider as string)) result.provider = input.provider as Diagnostic['provider'];
    if (input.site === 'chesscom' || input.site === 'lichess') result.site = input.site;
    if (typeof input.requestId === 'string' && /^[a-zA-Z0-9_-]{1,120}$/.test(input.requestId)) result.requestId = input.requestId;
    return result;
}
/** Scope a reporter to one job/session so repeated expected failures stay quiet. */
export function createDiagnosticReporter(report: DiagnosticReporter): DiagnosticReporter {
    const seen = new Set<string>();
    return value => {
        const safe = diagnostic(value.code, value);
        const key = JSON.stringify(safe);
        if (seen.has(key)) return;
        // Keep memory bounded even when a caller supplies many opaque IDs.
        if (seen.size >= 128) seen.delete(seen.values().next().value!);
        seen.add(key);
        report(safe);
    };
}
