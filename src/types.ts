import type { Diagnostic } from './diagnostics';
import type { ExplanationProgress } from './explanation-state';
export interface MoveAnalysisRequest{
    type: 'ANALYSIS_REQUEST';
    fen: string;
    orientation: 'white' | 'black'
    requestId: string;
    tabId?: number;
    manual?: boolean;
}

export interface EngineEvaluation {
    bestMove: string;
    pvLines: string[];
    promisingMoves: string[];
    evaluation: string;
}

export interface AnalysisStreamChunk {
    type: "STREAM_CHUNK";
    textDelta: string;
    isComplete: boolean;
    requestId: string;
}

export type CloudProvider = 'gemini' | 'openai' | 'groq';
export type RemoteProvider = 'ollama' | CloudProvider;
export type Provider = 'chrome' | RemoteProvider;
export interface Settings { provider: 'auto' | Provider; cloudProvider: CloudProvider; models: Record<RemoteProvider, string>; analysisSource?: 'auto' | 'local' }
export type ApiKeys = Partial<Record<CloudProvider, string>>;
export type ProviderCredentials = ApiKeys;
/** Execution-only settings; never persist or return these to the panel. */
export interface ExecutionSettings extends Settings { keys: ApiKeys }
export const DEFAULT_SETTINGS: Settings = {
    provider: 'auto', cloudProvider: 'gemini', models: { ollama: 'qwen3:4b', gemini: 'gemini-2.5-flash', openai: 'gpt-4.1-mini', groq: 'llama-3.3-70b-versatile' }, analysisSource: 'auto',
};
export const ORIGINS: Record<RemoteProvider, string> = {
    ollama: 'http://localhost:11434/*', gemini: 'https://generativelanguage.googleapis.com/*',
    openai: 'https://api.openai.com/*', groq: 'https://api.groq.com/*',
};
export interface Candidate { uci: string; san: string; pv: string; score: number; mate?: number; uciPv?: string[]; sanPv?: string[]; depth?: number; engineScore?: { kind: 'cp'; value: number } | { kind: 'mate'; winner: 'w' | 'b'; moves: number } }
export interface Evaluation extends EngineEvaluation { candidates: Candidate[]; terminal?: string; whiteScore: number; engineScore?: Candidate['engineScore'] | { kind: 'terminal'; winner?: 'w' | 'b' }; depth?: number; source?: { kind: string; label: string; depth?: number } }
export type AnalysisEvent =
    | (AnalysisStreamChunk & { tabId: number })
    | ({ type: 'EXPLANATION_STATE'; requestId: string; tabId: number; fen: string } & ExplanationProgress)
    | { type: 'ENGINE_RESULT'; requestId: string; tabId: number; result: Evaluation }
    | { type: 'STATUS' | 'ERROR'; requestId: string; tabId: number; text: string; diagnostic?: Diagnostic };
export interface EngineJob { target: 'offscreen'; type: 'ENGINE_START'; fen: string; requestId: string; tabId: number; manual: boolean; settings: ExecutionSettings; nativeEvaluation?: Evaluation }
export function settingsFrom(value: unknown): Settings {
    const input = value && typeof value === 'object' ? value as Partial<Settings> : undefined;
    const result: Settings = structuredClone(DEFAULT_SETTINGS);
    if (input?.analysisSource === 'auto' || input?.analysisSource === 'local') result.analysisSource = input.analysisSource;
    // Legacy provider selections become the cloud preference; the new default is local-first.
    if (input?.cloudProvider && ['gemini', 'openai', 'groq'].includes(input.cloudProvider)) {
        result.cloudProvider = input.cloudProvider;
        if (input.provider === 'auto' || input.provider === 'chrome' || (typeof input.provider === 'string' && Object.hasOwn(ORIGINS, input.provider))) result.provider = input.provider;
    } else if (input?.provider && ['gemini', 'openai', 'groq'].includes(input.provider)) result.cloudProvider = input.provider as CloudProvider;
    for (const provider of Object.keys(ORIGINS) as RemoteProvider[]) {
        const model = input?.models?.[provider];
        if (typeof model === 'string' && model.trim() && model.length <= 120) result.models[provider] = model.trim();

    }
    return result;
}
