import type { Provider } from './types';

export const FAILURE_REASONS = ['not-supported', 'download-required', 'downloading', 'connection', 'permission', 'missing-key', 'authentication', 'quota', 'model', 'http', 'timeout', 'invalid-format', 'unsupported-facts', 'context-limit', 'provider-error'] as const;
export type FailureReason = typeof FAILURE_REASONS[number];
export interface ProviderAttempt { provider: Provider; reason: FailureReason }
export class ProviderFailure extends Error {
    constructor(readonly reason: FailureReason) { super(reason); }
}
export function failureReason(error: unknown): FailureReason {
    if (error instanceof ProviderFailure) return error.reason;
    if (error instanceof Error) {
        if (error.name === 'NotSupportedError') return 'not-supported';
        if (error.name === 'NotAllowedError' || error.name === 'SecurityError') return 'permission';
        if (error.name === 'QuotaExceededError') return 'context-limit';
    }
    return 'provider-error';
}
const names: Record<Provider, string> = {chrome:'Chrome AI',ollama:'Ollama',gemini:'Gemini',openai:'OpenAI',groq:'Groq'};
const explanations: Record<FailureReason, string> = {
    'not-supported':'is unavailable in this browser or device.',
    'download-required':'needs its model downloaded in settings.',
    downloading:'is still downloading its model.',
    connection:'cannot be reached. Check its server or connection.',
    permission:'access was denied. Check permissions and the allowed extension origin.',
    'missing-key':'has no saved API key. Add one in settings to use it.',
    authentication:'rejected the API key. Replace it in settings.',
    quota:'reached its rate or usage limit. Retry later or check the account.',
    model:'could not find the selected model. Check the model in settings.',
    http:'returned a server error. Retry later or check the selected model.',
    timeout:'timed out. Retry or choose another provider.',
    'invalid-format':'did not return a complete JSON explanation plan.',
    'unsupported-facts':'selected claims outside the verified evidence; that response was rejected.',
    'context-limit':'could not fit the explanation into its context window.',
    'provider-error':'could not complete the explanation. Run Test AI in settings.',
};
export const providerFailureText = (attempt: ProviderAttempt) => `${names[attempt.provider]} ${explanations[attempt.reason]}`;
export function isProviderAttempt(value: unknown): value is ProviderAttempt {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const v = value as Record<string,unknown>;
    return Object.keys(v).every(k => k === 'provider' || k === 'reason') && Object.hasOwn(names,String(v.provider)) && FAILURE_REASONS.includes(v.reason as FailureReason);
}
export interface AiTestResult { provider: Provider | 'facts'; text: string; attempts: ProviderAttempt[] }
export function isAiTestResult(value: unknown): value is AiTestResult {
    if (!value || typeof value !== 'object') return false;
    const v = value as AiTestResult;
    return (v.provider === 'facts' || Object.hasOwn(names,v.provider)) && typeof v.text === 'string' && v.text.length <= 10000
        && Array.isArray(v.attempts) && v.attempts.length <= 10 && v.attempts.every(isProviderAttempt);
}
