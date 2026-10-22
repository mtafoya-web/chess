import { Chess, type Move } from 'chess.js';
import { playUci } from './chess';
import { buildBoardContext, colorName, pieceNames, type BoardContext, type BoardHistory } from './board-context';
import { moveThreatFacts } from './threat-facts';
import { positionalFacts } from './positional-facts';
import { analysisEvidence, analysisPlanFacts, analysisFactAllowed, type AnalysisEvidence } from './analysis-evidence';
import type { OpeningContext, AnalysisOpeningContext } from './opening-context';
import { readableMove } from './readable-move';
import type { ReviewEvidence } from './review-evidence';
import { reviewInsight } from './review-insights';
import type { Evaluation } from './types';

export interface ReviewFacts { summary: string; mode?: 'analysis' | 'review'; analysisOpening?: AnalysisOpeningContext; playedMove?: string; before?: Evaluation; label?: string; lossCp?: number; history?: BoardHistory; opening?: OpeningContext }
export interface ExplanationFact { id: string; role: 'lead' | 'support' | 'reply'; scope: string; branch: string; text: string; meaning?: string; evidence: string; effect?: string; benefit?: string; rank?: number; compatibleWith?: string[]; evidenceSteps?: number[]; cause?: string; actor?: 'w' | 'b' }
export interface ExplanationCatalog { version: 2; context: BoardContext; key: string; facts: ExplanationFact[]; opening?: OpeningContext; reviewEvidence?: ReviewEvidence; analysisEvidence?: AnalysisEvidence }
export function moveWords(move: Move, past = false): string {
    let text = past ? `${colorName(move.color)} moved the ${pieceNames[move.piece]} from ${move.from} to ${move.to}` : `Move ${colorName(move.color)}'s ${pieceNames[move.piece]} from ${move.from} to ${move.to}`;
    if (move.isKingsideCastle() || move.isQueensideCastle()) text += `, castling ${move.isKingsideCastle() ? 'kingside' : 'queenside'}`;
    if (move.promotion) text += ` and ${past ? 'promoted' : 'promote'} it to a ${pieceNames[move.promotion]}`;
    return `${text}.`;
}
function legalLine(fen: string, result: Evaluation): Move[] {
    const candidate = result.candidates.find(c => c.uci === result.bestMove), board = new Chess(fen);
    const line = candidate?.uciPv?.length ? candidate.uciPv : result.bestMove ? [result.bestMove] : [];
    const moves: Move[] = [];
    for (const uci of line.slice(0, 10)) { try { moves.push(playUci(board, uci)); } catch { break; } }
    return moves;
}
function ideas(fen: string, move: Move, branch: string, scope: string, history?: BoardHistory, analysis?: AnalysisEvidence): ExplanationFact[] {
    const positional = positionalFacts(fen, move.lan, branch, scope, history).filter(f => !f.id.includes('.castling.') || analysis?.kingSafety[move.color].pvCastling?.side === f.id.split('.').at(-1));
    const tactical = moveThreatFacts(fen, move.lan, branch, scope).map(f => ({ ...f, role: 'support' as const, meaning: f.meaning ?? (f.evidence === 'attack-map' ? 'An attack puts pressure on a piece; it does not by itself prove that the piece can be won.' : undefined), text: f.text.replace(/; that alone does not establish a material win\./, '.').replace(/\b([a-h][1-8])\b/g, s => s.toUpperCase()), rank: f.id.endsWith('.mate') ? 120 : f.id.endsWith('.check') ? 110 : f.id.endsWith('.capture') ? 100 : 30 }));
    // Moving out of check is urgent; ordinary attacked-square geometry is not proof of danger.
    if (new Chess(fen).isCheck() && !tactical.some(f => f.rank >= 100)) tactical.unshift({ id: `${branch}.defense`, branch, scope, text: `${colorName(move.color)} answers the check, keeping the king safe from that immediate attack.`, evidence: 'legal-move', meaning: 'When the king is in check, the reply must remove that attack.', supportingMoves: [move.lan], role: 'support', rank: 105 });
    const plans: ExplanationFact[] = analysis ? analysisPlanFacts(analysis).map(f => ({...f, text: `${f.text}.`, role: 'support' as const, branch, scope: 'continuation:plan', evidence: 'legal-engine-line', evidenceSteps: f.steps})) : [];
    return [...tactical, ...positional.filter(f => !plans.some(p => p.id === f.id)).map(f => ({ ...f, role: 'support' as const, text: f.effect, meaning: f.benefit })), ...plans].sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0));
}
function teachingLead(move: Move, supported: ExplanationFact[]): { text: string; used: string[]; meaning?: string } {
    const main = supported[0];
    if (!main) return { text: `${colorName(move.color)} repositions the ${pieceNames[move.piece]} on ${move.to.toUpperCase()}.`, used: [] };
    const center = main.id.includes('.development') ? supported.find(f => f.id.includes('.center')) : undefined;
    if (center) return { text: `${main.effect?.replace(/\.$/, '')} and ${center.effect?.replace(/^The /, 'the ').replace(/\.$/, '')}.`, meaning: 'Bringing a piece into play while influencing central squares helps contest the center.', used: [main.id, center.id] };
    return { text: main.text, meaning: main.meaning, used: [main.id] };
}
const lowerInitial = (text: string) => text[0].toLowerCase() + text.slice(1);
export function buildExplanationFacts(fen: string, result: Evaluation, review?: ReviewFacts): ExplanationCatalog {
    const context = buildBoardContext(fen, review?.history), facts: ExplanationFact[] = [];
    const played = review?.mode === 'analysis' ? undefined : context.played, branch = played ? 'played' : 'recommended', scope = played ? `after:${played.ply}` : 'after:recommended';
    const line = legalLine(context.fen, result);
    const opening = review?.opening;
    const analysis = played ? undefined : analysisEvidence(context.fen, result);
    if (analysis && review?.analysisOpening) {
        const supplied = review.analysisOpening;
        const matches = (match: AnalysisOpeningContext['currentPosition'], expectedFen?: string) => {
            try { return !!match && !!expectedFen && match.source === 'local-position-match' && /^[A-E]\d{2}$/.test(match.eco)
                && !!match.name && match.name.length <= 500 && new Chess(match.fen).fen() === new Chess(expectedFen).fen(); } catch { return false; }
        };
        analysis.opening = {
            currentPosition: matches(supplied.currentPosition, analysis.fen) ? supplied.currentPosition : undefined,
            recommendedPosition: matches(supplied.recommendedPosition, analysis.pv[0].afterFen) ? supplied.recommendedPosition : undefined,
            pvPosition: supplied.pvPosition && Number.isInteger(supplied.pvPosition.step) && matches(supplied.pvPosition, analysis.pv[supplied.pvPosition.step]?.afterFen) ? supplied.pvPosition : undefined
        };
    }
    let reviewEvidence: ReviewEvidence | undefined;
    if (played) {
        const move = playUci(new Chess(played.beforeFen), played.uci);
        const insight = reviewInsight({ ...played, san: move.san }, { label: review?.label ?? 'Review', summary: '', lossCp: review?.lossCp }, review?.before, result);
        reviewEvidence = insight.evidence;
        if (reviewEvidence && review?.history) reviewEvidence.verifiedHistory = {initialFen: review.history.initialFen, ply: review.history.ply, recentMoves: review.history.moves.slice(Math.max(0, review.history.ply - 12), review.history.ply)};
        facts.push({ id: 'played.move', role: 'lead', branch, scope, evidence: 'legal-review-comparison', text: insight.summary, rank: 100, cause: insight.evidence?.causes[0]?.kind, evidenceSteps: insight.evidence?.causes[0]?.steps });
    } else if (context.terminal) {
        facts.push({ id: 'position.terminal', role: 'lead', branch, scope: 'current', evidence: 'chess-rules', text: `${context.terminal}. There is no continuation to suggest from this position.` });
    } else if (line[0]) {
        const supported = ideas(context.fen, line[0], branch, scope, review?.history, analysis), lead = teachingLead(line[0], supported);
        const contestedPush = analysis?.opponentCentralPushes.find(p => analysis.targetsContested.includes(p.square));
        if (contestedPush && supported[0]?.id.includes('.center')) lead.meaning = `${colorName(line[1]?.color ?? (line[0].color === 'w' ? 'b' : 'w'))}'s ${contestedPush.san} remains legal and appears in the searched line.`;
        facts.push({ id: 'recommended.move', role: 'lead', branch, scope, evidence: 'legal-before-after', text: lead.text, meaning: lead.meaning, rank: 100, effect: supported.filter(f => lead.used.includes(f.id)).map(f => f.effect ?? f.text).join(' '), benefit: supported.filter(f => lead.used.includes(f.id)).map(f => f.benefit).filter(Boolean).join(' ') });
        facts.push(...supported.filter(f => !lead.used.includes(f.id)));
        const positionMatch = analysis?.opening?.recommendedPosition ?? analysis?.opening?.currentPosition ?? analysis?.opening?.pvPosition;
        if (positionMatch) facts.push({id:'recommended.opening-position',role:'support',branch,scope:'position:book',rank:20,evidence:'local-position-match',
            text:`The ${analysis?.opening?.recommendedPosition ? 'recommended position matches' : analysis?.opening?.currentPosition ? 'current position matches' : 'searched line reaches a position matching'} ${positionMatch.name} (${positionMatch.eco}) in the local opening book.`});
        if (line[1] && !supported.some(f => f.evidence === 'legal-before-after')) facts.push({ id: 'recommended.reply', role: 'reply', branch, scope: 'continuation:2', evidence: 'legal-engine-line', rank: 10, actor: line[1].color, text: `One possible reply is ${colorName(line[1].color)}'s ${lowerInitial(readableMove(line[0].after, line[1].lan))}.` });
    } else facts.push({ id: 'position.unavailable', role: 'lead', branch, scope: 'current', evidence: 'validation', text: 'A legal suggested move is unavailable for this position.' });
    // Bundle only complementary support, ranked separately from the already-used primary idea.
    const approved = facts.filter(f => !analysis || analysisFactAllowed(`${f.text} ${f.meaning ?? ''}`, analysis, f.actor));
    approved.sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0));
    return { version: 2, context, facts: approved, opening, reviewEvidence, analysisEvidence: analysis, key: JSON.stringify([context.key, result, review?.before, review?.label, 2]) };
}
