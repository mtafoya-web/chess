import { analysisEvidence } from './analysis-evidence';
import { Engine } from './engine';
import { normalizedFen } from './chess';
import { explain, PROVIDER_NAMES, clearExplanationCache } from './providers';
import type { AnalysisEvent, EngineJob, Evaluation, ExecutionSettings } from './types';
import type { ReviewEvent, ReviewJob } from './review-types';
import { ReviewAnalyzer } from './review-analysis';
import { buildExplanationFacts, type ReviewFacts } from './explanation-facts';
import { renderExplanation } from './coach-prompt';
import { diagnostic, createDiagnosticReporter, type DiagnosticReporter } from './diagnostics';
import type { ExplanationProgress } from './explanation-state';
import { isBackgroundSender, isOffscreenCommand } from './messages';
import { loadOpeningContext, cachedOpeningContext, loadAnalysisOpeningContext } from './opening-loader';
import { testExplanation } from './ai-test';
import type { ProviderAttempt } from './provider-failures';

const engine = new Engine();
const reviewer = new ReviewAnalyzer(engine);
let current: { id: string; controller: AbortController } | undefined;
const reviewControllers = new Map<string, AbortController>();
let testController: AbortController | undefined;
function cancel(explanations = true) {
    current?.controller.abort(); engine.cancel(); current = undefined;
    if (explanations) { for (const controller of reviewControllers.values()) controller.abort(); reviewControllers.clear(); }
}

// Optional book metadata must never hold the explanation pipeline open indefinitely.
async function metadata<T>(work: Promise<T>, fallback: T, signal: AbortSignal): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    try {
        signal.throwIfAborted();
        return await Promise.race([work, new Promise<T>(resolve => { timer = setTimeout(() => resolve(fallback), 2200); }),
            new Promise<never>((_, reject) => { abort = () => reject(signal.reason); signal.addEventListener('abort', abort, { once: true }); })]);
    } finally { clearTimeout(timer); if (abort) signal.removeEventListener('abort', abort); }
}

/** Analysis and native review share the same validation, provider chain and completion contract. */
async function explainPosition(options: {
    settings: ExecutionSettings; fen: string; result: Evaluation; controller: AbortController;
    prepare: () => Promise<ReviewFacts | undefined>;
    progress: (state: ExplanationProgress) => void;
    commit: (text: string, provider: Awaited<ReturnType<typeof explain>>) => void;
    status: (text: string) => void; report: DiagnosticReporter;
}) {
    const { controller, progress } = options;
    const attempts: ProviderAttempt[] = [];
    const report: DiagnosticReporter = value => {
        if (value.provider && value.reason && attempts.length < 10 && !attempts.some(a=>a.provider===value.provider && a.reason===value.reason)) attempts.push({provider:value.provider,reason:value.reason});
        options.report(value);
    };
    progress({ state: 'pending' });
    const timer = setTimeout(() => {
        report(diagnostic('EXPLANATION_TIMEOUT'));
        progress({ state: 'failed', attempts });
        controller.abort();
    }, 65000);
    try {
        const facts = await options.prepare();
        controller.signal.throwIfAborted();
        let text = '';
        const provider = await explain(options.settings, options.fen, options.result, controller.signal,
            delta => { text += delta; }, options.status, facts, report);
        controller.signal.throwIfAborted();
        options.commit(text, provider);
        progress(provider === 'facts' ? { state: 'fallback', provider, attempts } : { state: 'ready', provider, attempts });
    } catch {
        if (!controller.signal.aborted) {
            report(diagnostic('PROVIDER_UNAVAILABLE'));
            progress({ state: 'failed', attempts });
        }
    } finally { clearTimeout(timer); }
}
async function runReview(job: ReviewJob) {
    cancel(!job.request.background);
    const { request } = job;
    const controller = new AbortController();
    current = { id: request.requestId, controller };
    reviewControllers.set(request.requestId, controller);
    const base = { sessionId: request.sessionId, requestId: request.requestId, tabId: job.tabId };
    const emit = (event: ReviewEvent) => {
        if (reviewControllers.get(request.requestId) === controller && !controller.signal.aborted) void chrome.runtime.sendMessage({ target: 'background', manual: job.manual ?? true, event }).catch(() => {});
    };
    const report = createDiagnosticReporter(value => emit({ ...base, type: 'REVIEW_STATUS', text: value.code === 'INVALID_PROVIDER_RESPONSE' ? 'AI response unsupported. Trying another eligible provider.' : 'AI provider unavailable. Trying a fallback.', diagnostic: value }));
    try {
        emit({ ...base, type: 'REVIEW_STATUS', text: 'Comparing the move with Stockfish…' });
        const result = await reviewer.analyze(request, controller.signal, preliminary => {
            if (!request.attempt) emit({...base,type:'REVIEW_RESULT',ply:request.ply,before:preliminary.before,after:preliminary.after,feedback:preliminary.feedback,pendingConfirmation:true});
        });
        if (request.attempt && result.feedback && result.move) {
            const feedback = result.feedback;
            const score = result.after.engineScore;
            const losingMate = (score?.kind === 'mate' || score?.kind === 'terminal') && score.winner && score.winner !== result.move.color;
            const uncertain = !!feedback.provisional;
            emit({ ...base, type: 'REVIEW_PRACTICE_RESULT', ply: request.ply, attempt: request.attempt, feedback,
                uncertain, accepted: !uncertain && !losingMate && feedback.label !== 'Missed mate' && (feedback.lossWinPercent ?? 0) <= 2 });
            return;
        }
        const reviewFacts: ReviewFacts | undefined = result.feedback ? { summary: result.feedback.summary, level: request.level, provisional: result.feedback.provisional, label: result.feedback.label, lossCp: result.feedback.lossCp, playedMove: result.move?.san, before: result.before, history: { sessionId: request.sessionId, initialFen: request.initialFen, moves: request.moves, ply: request.ply } } : undefined;
        const feedback = result.feedback && reviewFacts ? { ...result.feedback, summary: renderExplanation(buildExplanationFacts(result.fen, result.after, reviewFacts)) } : result.feedback;
        const history = { sessionId: request.sessionId, initialFen: request.initialFen, moves: request.moves, ply: request.ply };
        const opening = cachedOpeningContext(result.fen, history, undefined);
        if (reviewFacts) reviewFacts.opening = opening;
        emit({ ...base, type: 'REVIEW_RESULT', ply: request.ply, before: result.before, after: result.after, advice: job.nativeEvaluation, feedback, opening });
        // Release Stockfish while the selected explanation continues independently.
        if (current?.id === request.requestId) current = undefined;
        emit({ ...base, type: 'REVIEW_ENGINE_COMPLETE', ply: request.ply });
        const openingWork = loadOpeningContext(result.fen, history, undefined, controller.signal).then(opening => {
            if (reviewFacts) reviewFacts.opening = opening;
            emit({ ...base, type: 'REVIEW_OPENING', ply: request.ply, opening });
        }).catch(() => {}); // Cancellation is expected; failed metadata never hides feedback.
        if (request.ai === false || request.background) { emit({ ...base, type: 'REVIEW_STATUS', text: 'Stockfish review ready.' }); await openingWork; return; }
        await explainPosition({ settings: job.settings, fen: result.fen, result: result.after, controller,
            prepare: async () => {
                await metadata(openingWork, undefined, controller.signal);
                return reviewFacts ?? { summary: '', mode: 'analysis', history };
            },
            progress: state => emit({ ...base, type: 'REVIEW_EXPLANATION_STATE', ply: request.ply, fen: result.fen, ...state }),
            commit: (text, provider) => emit({ ...base, type: 'REVIEW_TEXT', text, provider: PROVIDER_NAMES[provider] }),
            status: text => emit({ ...base, type: 'REVIEW_STATUS', text }), report });
    } catch {
        if (!controller.signal.aborted) emit({ ...base, type: 'REVIEW_ERROR', text: 'Review unavailable. Try again.', diagnostic: diagnostic('ENGINE_UNAVAILABLE') });
    } finally {
        if (current?.id === request.requestId) current = undefined;
        reviewControllers.delete(request.requestId);
    }
}
async function run(job: EngineJob) {
    cancel();
    const controller = new AbortController();
    current = { id: job.requestId, controller };
    const emit = (event: AnalysisEvent) => {
        if (current?.id === job.requestId && !controller.signal.aborted) void chrome.runtime.sendMessage({ target: 'background', manual: job.manual, event }).catch(() => {});
    };
    const base = { requestId: job.requestId, tabId: job.tabId };
    const report = createDiagnosticReporter(value => emit({ ...base, type: 'STATUS', text: value.code === 'INVALID_PROVIDER_RESPONSE' ? 'AI response unsupported. Trying another eligible provider.' : 'AI provider unavailable. Trying a fallback.', diagnostic: value }));
    try {
        const fen = normalizedFen(job.fen);
        emit({ ...base, type: 'STATUS', text: 'Finding a move…' });
        const result = job.nativeEvaluation ?? await engine.analyze(fen, controller.signal);
        controller.signal.throwIfAborted();
        emit({ ...base, type: 'ENGINE_RESULT', result });
        if (result.terminal) return;
        await explainPosition({ settings: job.settings, fen, result, controller,
            prepare: async () => {
                const strategic = analysisEvidence(fen, result);
                const analysisOpening = strategic?.fianchettos.length ? await metadata(loadAnalysisOpeningContext(fen, result.bestMove, controller.signal, strategic.pv.map(s => s.uci)), {}, controller.signal) : undefined;
                return { summary: '', mode: 'analysis', analysisOpening };
            },
            progress: state => emit({ ...base, type: 'EXPLANATION_STATE', fen, ...state }),
            commit: textDelta => emit({ ...base, type: 'STREAM_CHUNK', textDelta, isComplete: true }),
            status: text => emit({ ...base, type: 'STATUS', text }), report });
    } catch {
        if (!controller.signal.aborted) emit({ ...base, type: 'ERROR', text: 'Analysis failed. Try again.', diagnostic: diagnostic('ENGINE_UNAVAILABLE') });
    }
}
chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
    if (!message || typeof message !== 'object' || !('target' in message) || message.target !== 'offscreen') return;
    if (!isBackgroundSender(sender)) { respond({ error: 'Unauthorized request.', diagnostic: diagnostic('PROTOCOL_UNAUTHORIZED') }); return; }
    if (!isOffscreenCommand(message)) { respond({ error: 'Invalid request.', diagnostic: diagnostic('PROTOCOL_INVALID') }); return; }
    if (message.type === 'EXPLANATION_RESET') { cancel(); testController?.abort(); clearExplanationCache(); respond({ ok: true }); }
    if (message.type === 'EXPLANATION_TEST') {
        testController?.abort(); testController = new AbortController();
        void testExplanation(message.settings,testController.signal).then(test => respond({test}), () => respond({error:'AI test could not complete. Try again.'}));
        return true;
    }
    if (message.type === 'ENGINE_CANCEL') { cancel(); respond({ ok: true }); }
    if (message.type === 'ENGINE_START') { void run(message); respond({ ok: true }); }
    if (message.type === 'REVIEW_START') { void runReview(message); respond({ ok: true }); }
});
