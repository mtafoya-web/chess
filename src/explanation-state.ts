import type { Provider } from './types';

export type ExplanationProgress =
    | { state: 'pending'; provider?: never }
    | { state: 'failed'; provider?: never }
    | { state: 'ready'; provider: Provider }
    | { state: 'fallback'; provider: 'facts' };

export const PROVIDER_NAMES: Record<Provider | 'facts', string> = {
    facts: 'Kibitz · verified facts', chrome: 'Chrome AI · local', ollama: 'Ollama · local',
    gemini: 'Gemini · cloud', openai: 'OpenAI · cloud', groq: 'Groq · cloud',
};

export function explanationStatus(progress: ExplanationProgress): string {
    if (progress.state === 'pending') return 'Preparing an AI explanation…';
    if (progress.state === 'failed') return 'AI explanation unavailable. Verified feedback is still available.';
    if (progress.state === 'fallback') return 'AI unavailable or unsupported. Showing verified chess facts.';
    return `Explained by ${PROVIDER_NAMES[progress.provider]}`;
}
