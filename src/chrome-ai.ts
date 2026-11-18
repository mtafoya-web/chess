import { ProviderFailure } from './provider-failures';
import { EXPLANATION_SCHEMA } from './explanation-schema';
// Kept behind feature detection so older Chrome versions retain local-engine support.
export type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';
interface Session {
    promptStreaming(prompt: string, options: { signal: AbortSignal; responseConstraint: object; omitResponseConstraintInput: boolean }): ReadableStream<string>;
    destroy(): void;
}
interface Options {
    signal?: AbortSignal;
    expectedInputs: { type: 'text'; languages: string[] }[];
    expectedOutputs: { type: 'text'; languages: string[] }[];
    monitor?: (monitor: EventTarget) => void;
}
interface Model {
    availability(options: Options): Promise<Availability>;
    create(options: Options): Promise<Session>;
}
const options: Options = {
    expectedInputs: [{ type: 'text', languages: ['en'] }],
    expectedOutputs: [{ type: 'text', languages: ['en'] }],
};
const model = () => (globalThis as typeof globalThis & { LanguageModel?: Model }).LanguageModel;
export async function chromeAvailability(): Promise<Availability> {
    try { return await model()?.availability(options) ?? 'unavailable'; }
    catch { return 'unavailable'; }
}
export async function downloadChromeAI(onProgress: (percent: number) => void) {
    const api = model();
    if (!api) throw new Error('Chrome AI is unavailable. Update Chrome and check device requirements.');
    // Called directly from the panel button to preserve user activation.
    const session = await api.create({ ...options, monitor(monitor) {
        monitor.addEventListener('downloadprogress', event => {
            onProgress(Math.round((event as Event & { loaded: number }).loaded * 100));
        });
    } });
    session.destroy();
}
export async function explainWithChrome(prompt: string, signal: AbortSignal, onDelta: (text: string) => void) {
    signal.throwIfAborted();
    const availability = await model()?.availability(options) ?? 'unavailable';
    if (availability !== 'available') throw new ProviderFailure(availability === 'downloadable' ? 'download-required' : availability === 'downloading' ? 'downloading' : 'not-supported');
    signal.throwIfAborted();
    const session = await model()!.create({ ...options, signal });
    try {
        signal.throwIfAborted();
        const reader = session.promptStreaming(prompt, { signal, responseConstraint:EXPLANATION_SCHEMA, omitResponseConstraintInput:true }).getReader();
        try {
            while (true) {
                signal.throwIfAborted();
                const { value, done } = await reader.read();
                if (done) break;
                onDelta(value);
            }
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    } finally { session.destroy(); }
}
