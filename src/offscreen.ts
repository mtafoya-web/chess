import { Engine } from './engine';
import { normalizedFen } from './chess';
import { explain, PROVIDER_NAMES } from './providers';
import type { AnalysisEvent, EngineJob } from './types';
import type { ReviewEvent, ReviewJob } from './review-types';
import { ReviewAnalyzer } from './review-analysis';
import { buildExplanationFacts, type ReviewFacts } from './explanation-facts';
import { renderExplanation } from './coach-prompt';
import { diagnostic, createDiagnosticReporter } from './diagnostics';
import { isBackgroundSender, isOffscreenCommand } from './messages';
import { loadOpeningContext, cachedOpeningContext } from './opening-loader';

const engine = new Engine();
const reviewer = new ReviewAnalyzer(engine);
let current: { id: string; controller: AbortController } | undefined;
function cancel() { current?.controller.abort(); engine.cancel(); current = undefined; }
async function runReview(job: ReviewJob) {
    cancel();
    const { request } = job;
    const controller = new AbortController();
    current = { id: request.requestId, controller };
    const base = { sessionId: request.sessionId, requestId: request.requestId, tabId: job.tabId };
    const emit = (event: ReviewEvent) => {
        if (current?.id === request.requestId && !controller.signal.aborted) void chrome.runtime.sendMessage({ target: 'background', manual: job.manual ?? true, event }).catch(() => {});
    };
    const report = createDiagnosticReporter(value => emit({ ...base, type: 'REVIEW_STATUS', text: value.code === 'INVALID_PROVIDER_RESPONSE' ? 'Using verified chess facts.' : 'AI provider unavailable. Trying a fallback.', diagnostic: value }));
    try {
        emit({ ...base, type: 'REVIEW_STATUS', text: 'Comparing the move with Stockfish…' });
        const result = await reviewer.analyze(request, controller.signal);
        const reviewFacts: ReviewFacts | undefined = result.feedback ? { summary: result.feedback.summary, label: result.feedback.label, lossCp: result.feedback.lossCp, playedMove: result.move?.san, before: result.before, history: { sessionId: request.sessionId, initialFen: request.initialFen, moves: request.moves, ply: request.ply } } : undefined;
        const feedback = result.feedback && reviewFacts ? { ...result.feedback, summary: renderExplanation(buildExplanationFacts(result.fen, result.after, reviewFacts)) } : result.feedback;
        const history = { sessionId: request.sessionId, initialFen: request.initialFen, moves: request.moves, ply: request.ply };
        const opening = cachedOpeningContext(result.fen, history, undefined);
        if (reviewFacts) reviewFacts.opening = opening;
        emit({ ...base, type: 'REVIEW_RESULT', ply: request.ply, before: result.before, after: result.after, advice: job.nativeEvaluation, feedback, opening });
        const openingWork = loadOpeningContext(result.fen, history, undefined, controller.signal).then(opening => {
            if (reviewFacts) reviewFacts.opening = opening;
            emit({ ...base, type: 'REVIEW_OPENING', ply: request.ply, opening });
        }).catch(() => {}); // Cancellation is expected; failed metadata never hides feedback.
        if (!request.ai || !result.feedback) { emit({ ...base, type: 'REVIEW_STATUS', text: 'Stockfish review ready.' }); return; }
        const timeout = setTimeout(() => {
            emit({ ...base, type: 'REVIEW_STATUS', text: 'Stockfish feedback ready. AI explanation timed out.', diagnostic: diagnostic('EXPLANATION_TIMEOUT') });
            controller.abort();
        }, 65000);
        try {
            let text = '';
            await openingWork;
            const provider = await explain(job.settings, result.fen, result.after, controller.signal, delta => { text += delta; }, status => emit({ ...base, type: 'REVIEW_STATUS', text: status }), reviewFacts, report);
            controller.signal.throwIfAborted();
            emit({ ...base, type: 'REVIEW_TEXT', text, provider: PROVIDER_NAMES[provider] });
            emit({ ...base, type: 'REVIEW_STATUS', text: `Explanation by ${PROVIDER_NAMES[provider]}` });
        } catch {
            if (!controller.signal.aborted) emit({ ...base, type: 'REVIEW_STATUS', text: 'Stockfish feedback ready. AI explanation unavailable.', diagnostic: diagnostic('PROVIDER_UNAVAILABLE') });
        } finally { clearTimeout(timeout); }
    } catch {
        if (!controller.signal.aborted) emit({ ...base, type: 'REVIEW_ERROR', text: 'Review unavailable. Try again.', diagnostic: diagnostic('ENGINE_UNAVAILABLE') });
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
    const report = createDiagnosticReporter(value => emit({ ...base, type: 'STATUS', text: value.code === 'INVALID_PROVIDER_RESPONSE' ? 'Using verified chess facts.' : 'AI provider unavailable. Trying a fallback.', diagnostic: value }));
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
        const fen = normalizedFen(job.fen);
        emit({ ...base, type: 'STATUS', text: 'Finding a move…' });
        const result = job.nativeEvaluation ?? await engine.analyze(fen, controller.signal);
        controller.signal.throwIfAborted();
        emit({ ...base, type: 'ENGINE_RESULT', result });
        if (result.terminal) return;
        emit({ ...base, type: 'STATUS', text: 'Explaining…' });
        timeout = setTimeout(() => {
            emit({ ...base, type: 'ERROR', text: 'Explanation timed out. Engine results are still available.', diagnostic: diagnostic('EXPLANATION_TIMEOUT') });
            controller.abort();
        }, 65000);
        const provider = await explain(job.settings, fen, result, controller.signal, textDelta => emit({ ...base, type: 'STREAM_CHUNK', textDelta, isComplete: false }), text => emit({ ...base, type: 'STATUS', text }), undefined, report);
        emit({ ...base, type: 'STREAM_CHUNK', textDelta: '', isComplete: true });
        emit({ ...base, type: 'STATUS', text: `Explanation by ${PROVIDER_NAMES[provider]}` });
    } catch {
        if (!controller.signal.aborted) emit({ ...base, type: 'ERROR', text: 'Analysis failed. Try again.', diagnostic: diagnostic('ENGINE_UNAVAILABLE') });
    } finally { clearTimeout(timeout); }
}
chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
    if (!message || typeof message !== 'object' || !('target' in message) || message.target !== 'offscreen') return;
    if (!isBackgroundSender(sender)) { respond({ error: 'Unauthorized request.', diagnostic: diagnostic('PROTOCOL_UNAUTHORIZED') }); return; }
    if (!isOffscreenCommand(message)) { respond({ error: 'Invalid request.', diagnostic: diagnostic('PROTOCOL_INVALID') }); return; }
    if (message.type === 'ENGINE_CANCEL') { cancel(); respond({ ok: true }); }
    if (message.type === 'ENGINE_START') { void run(message); respond({ ok: true }); }
    if (message.type === 'REVIEW_START') { void runReview(message); respond({ ok: true }); }
});
