import { Chess, type Move } from 'chess.js';
import { playUci } from './chess';
import { buildBoardContext, colorName, pieceNames, type BoardContext, type BoardHistory } from './board-context';
import { moveThreatFacts } from './threat-facts';
import { positionalFacts } from './positional-facts';
import type { OpeningContext } from './opening-context';
import { readableMove } from './readable-move';
import { reviewInsight } from './review-insights';
import type { Evaluation } from './types';

export interface ReviewFacts { summary: string; playedMove?: string; before?: Evaluation; label?: string; lossCp?: number; history?: BoardHistory; opening?: OpeningContext }
export interface ExplanationFact { id: string; role: 'lead' | 'support' | 'reply'; scope: string; branch: string; text: string; evidence: string; effect?: string; benefit?: string; rank?: number; compatibleWith?: string[] }
export interface ExplanationCatalog { version: 2; context: BoardContext; key: string; facts: ExplanationFact[]; opening?: OpeningContext }
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
    for (const uci of line.slice(0, 3)) { try { moves.push(playUci(board, uci)); } catch { break; } }
    return moves;
}
function ideas(fen: string, move: Move, branch: string, scope: string, history?: BoardHistory): ExplanationFact[] {
    const positional = positionalFacts(fen, move.lan, branch, scope, history);
    const tactical = moveThreatFacts(fen, move.lan, branch, scope).map(f => ({ ...f, role: 'support' as const, text: f.text.replace(/; that alone does not establish a material win\./, '.').replace(/\b([a-h][1-8])\b/g, s => s.toUpperCase()), rank: f.id.endsWith('.mate') ? 120 : f.id.endsWith('.check') ? 110 : f.id.endsWith('.capture') ? 100 : 30 }));
    // Moving out of check is urgent; ordinary attacked-square geometry is not proof of danger.
    if (new Chess(fen).isCheck() && !tactical.some(f => f.rank >= 100)) tactical.unshift({ id: `${branch}.defense`, branch, scope, text: `${colorName(move.color)} answers the check, keeping the king safe from that immediate attack.`, evidence: 'legal-move', supportingMoves: [move.lan], role: 'support', rank: 105 });
    return [...tactical, ...positional.map(f => ({ ...f, role: 'support' as const }))].sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0));
}
function teachingLead(move: Move, supported: ExplanationFact[]): { text: string; used: string[] } {
    const main = supported[0];
    if (!main) return { text: `${colorName(move.color)} repositions the ${pieceNames[move.piece]} on ${move.to.toUpperCase()}.`, used: [] };
    const center = main.id.includes('.development') ? supported.find(f => f.id.includes('.center')) : undefined;
    if (center) return { text: `${main.effect?.replace(/\.$/, '')} and ${center.effect?.replace(/^The /, 'the ').replace(/\.$/, '')}, helping contest the center.`, used: [main.id, center.id] };
    return { text: main.text, used: [main.id] };
}
const lowerInitial = (text: string) => text[0].toLowerCase() + text.slice(1);
export function buildExplanationFacts(fen: string, result: Evaluation, review?: ReviewFacts): ExplanationCatalog {
    const context = buildBoardContext(fen, review?.history), facts: ExplanationFact[] = [];
    const played = context.played, branch = played ? 'played' : 'recommended', scope = played ? `after:${played.ply}` : 'after:recommended';
    const line = legalLine(context.fen, result);
    const opening = review?.opening;
    if (played) {
        const move = playUci(new Chess(played.beforeFen), played.uci);
        const insight = reviewInsight({ ...played, san: move.san }, { label: review?.label ?? 'Review', summary: '', lossCp: review?.lossCp }, review?.before, result);
        facts.push({ id: 'played.move', role: 'lead', branch, scope, evidence: 'legal-review-comparison', text: insight.summary, rank: 100 });
    } else if (context.terminal) {
        facts.push({ id: 'position.terminal', role: 'lead', branch, scope: 'current', evidence: 'chess-rules', text: `${context.terminal}. There is no continuation to suggest from this position.` });
    } else if (line[0]) {
        const supported = ideas(context.fen, line[0], branch, scope, review?.history), lead = teachingLead(line[0], supported);
        facts.push({ id: 'recommended.move', role: 'lead', branch, scope, evidence: 'legal-before-after', text: lead.text, rank: 100, effect: supported.filter(f => lead.used.includes(f.id)).map(f => f.effect ?? f.text).join(' '), benefit: supported.filter(f => lead.used.includes(f.id)).map(f => f.benefit).filter(Boolean).join(' ') });
        facts.push(...supported.filter(f => !lead.used.includes(f.id)));
        if (line[1] && !supported.some(f => f.evidence === 'legal-before-after')) facts.push({ id: 'recommended.reply', role: 'reply', branch, scope: 'continuation:2', evidence: 'legal-engine-line', rank: 10, text: `One possible reply is ${colorName(line[1].color)}'s ${lowerInitial(readableMove(line[0].after, line[1].lan))}.` });
    } else facts.push({ id: 'position.unavailable', role: 'lead', branch, scope: 'current', evidence: 'validation', text: 'A legal suggested move is unavailable for this position.' });
    // Bundle only complementary support, ranked separately from the already-used primary idea.
    facts.sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0));
    return { version: 2, context, facts, opening, key: JSON.stringify([context.key, result, review?.before, review?.label, 2]) };
}
