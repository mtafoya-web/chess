import { ProviderFailure, failureReason, type ProviderStage } from './provider-failures';
import { EXPLANATION_SCHEMA } from './explanation-schema';

export type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';
interface Session {
    prompt(prompt: string, options: { signal: AbortSignal; responseConstraint?: object; omitResponseConstraintInput?: boolean }): Promise<string>;
    destroy(): void;
}
interface Options {
    signal?: AbortSignal;
    expectedInputs: { type: 'text'; languages: string[] }[];
    expectedOutputs: { type: 'text'; languages: string[] }[];
    monitor?: (monitor: EventTarget) => void;
}
interface Model { availability(options: Options): Promise<Availability>; create(options: Options): Promise<Session> }
const options: Options = { expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] };
const model = () => (globalThis as typeof globalThis & { LanguageModel?: Model }).LanguageModel;

export async function chromeAvailability(): Promise<Availability> {
    try { return await model()?.availability(options) ?? 'unavailable'; }
    catch { return 'unavailable'; }
}

/** Call directly from the button handler, before any asynchronous availability check. */
export async function downloadChromeAI(onProgress: (percent: number) => void, signal?: AbortSignal) {
    const api = model();
    if (!api) throw new ProviderFailure('not-supported', 'availability');
    const session = await api.create({ ...options, signal, monitor(monitor) {
        monitor.addEventListener('downloadprogress', event => {
            const loaded = (event as Event & { loaded: number }).loaded;
            if (Number.isFinite(loaded)) onProgress(Math.round(Math.max(0, Math.min(1, loaded)) * 100));
        });
    } });
    session.destroy();
}

export async function explainWithChrome(prompt: string, signal: AbortSignal, onDelta: (text: string) => void,
    onStage: (stage: ProviderStage) => void = () => {}, constraint: object = EXPLANATION_SCHEMA) {
    let stage: ProviderStage = 'availability', session: Session | undefined;
    try {
        signal.throwIfAborted(); onStage(stage);
        const api = model(), availability = await api?.availability(options) ?? 'unavailable';
        if (availability !== 'available') throw new ProviderFailure(availability === 'downloadable' ? 'download-required' : availability === 'downloading' ? 'downloading' : 'not-supported', stage);
        signal.throwIfAborted(); stage = 'creation'; onStage(stage);
        session = await api!.create({ ...options, signal });
        signal.throwIfAborted(); stage = 'generation'; onStage(stage);
        // The UI commits only validated JSON. A short request needs no stream buffer.
        let text: string;
        try {
            text = await session.prompt(prompt, { signal, responseConstraint: constraint, omitResponseConstraintInput: true });
        } catch (error) {
            signal.throwIfAborted();
            // A rejected generation option does not mean the device lacks a model.
            // Retry only this compatibility case, inside the original provider budget.
            if (!(error instanceof Error) || error.name !== 'NotSupportedError') throw error;
            session.destroy(); session = undefined;
            session = await api!.create({ ...options, signal });
            signal.throwIfAborted();
            text = await session.prompt(`${prompt}\nReturn only the requested JSON object, without markdown or surrounding text.`, { signal });
        }
        signal.throwIfAborted(); onDelta(text);
    } catch (error) {
        const reason = failureReason(signal.aborted ? signal.reason : error);
        throw new ProviderFailure(stage === 'generation' && reason === 'not-supported' ? 'generation-unsupported' : reason, stage);
    } finally { session?.destroy(); }
}
