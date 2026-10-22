import { expect, it } from 'vitest';
import { Chess, DEFAULT_POSITION } from 'chess.js';
import { buildExplanationFacts } from '../src/explanation-facts';
import { coachPrompt, renderExplanation, validatePlan } from '../src/coach-prompt';
import { candidateFrom, evaluation, playUci } from '../src/chess';
import { moveThreatFacts } from '../src/threat-facts';

const result = (fen: string, moves: string) => evaluation([candidateFrom(`info depth 12 score cp 20 pv ${moves}`, fen)!.candidate]);
it('names colored pieces with origins, verified effects, and a legal hypothetical reply', () => {
    const fen = '4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1';
    const catalog = buildExplanationFacts(fen, result(fen, 'e4d5 e8f7'));
    const text = renderExplanation(catalog);
    expect(text).toContain("captures Black's pawn on D5");
    expect(text).toContain("central foothold");
    expect(text).not.toContain('possible reply');
    expect(text).not.toContain('Stockfish');
});
it('checks sliding blockers and labels attacks without promising a material win', () => {
    const fen = '7k/8/8/8/8/2n5/1P6/R6K w - - 0 1';
    const facts = moveThreatFacts(fen, 'a1c1', 'recommended', 'after');
    expect(facts.find(f => f.target?.square === 'c3')?.text).toContain('does not establish a material win');
    const blocked = moveThreatFacts('7k/8/8/8/8/2n5/1PP5/R6K w - - 0 1', 'a1c1', 'recommended', 'after');
    expect(blocked.some(f => f.target?.square === 'c3')).toBe(false);
});
it('keeps pinned geometric attacks distinct from legal capturing moves', () => {
    const fen = '4r2k/8/8/8/8/2p5/4N3/4K3 w - - 0 1', chess = new Chess(fen);
    expect(chess.attackers('c3', 'w')).toContain('e2');
    expect(chess.moves({ verbose: true }).some(m => m.from === 'e2' && m.to === 'c3')).toBe(false);
    // The fact detector never fabricates a legal turn for a pinned piece.
    expect(() => moveThreatFacts(fen, 'e2c3', 'recommended', 'after')).toThrow();
});
it('rejects prose, unknown pieces/facts, extra keys, wrong roles, and incompatible branches', () => {
    const catalog = buildExplanationFacts(DEFAULT_POSITION, result(DEFAULT_POSITION, 'e2e4 e7e5'));
    for (const text of ["White's queen captures the king", JSON.stringify({ leadFactId: 'missing.queen', toneVariant: 'direct' }), JSON.stringify({ leadFactId: 'recommended.move', toneVariant: 'direct', prose: 'wins a rook' }), JSON.stringify({ leadFactId: 'recommended.reply', toneVariant: 'direct' })]) expect(validatePlan(text, catalog)).toBeUndefined();
    catalog.facts.push({ id: 'other.reply', role: 'reply', branch: 'other', scope: 'after', text: 'bad', evidence: 'test' });
    expect(validatePlan(JSON.stringify({ leadFactId: 'recommended.move', replyFactId: 'other.reply', toneVariant: 'direct' }), catalog)).toBeUndefined();
    expect(validatePlan(JSON.stringify({ leadFactId: 'recommended.move', supportFactId: 'recommended.opened-line.f1', toneVariant: 'gentle' }), catalog)).toBeDefined();
    expect(coachPrompt(catalog)).toContain('You are Kibitz');
    expect(coachPrompt(catalog)).toContain('pieces');
});
it('review leads with the played move and terminal positions never invent replies', () => {
    const board = new Chess(); playUci(board, 'e2e4');
    const catalog = buildExplanationFacts(board.fen(), result(board.fen(), 'e7e5 g1f3'), { summary: '', label: 'Good', history: { sessionId: 'a', initialFen: DEFAULT_POSITION, moves: ['e2e4'], ply: 1 } });
    expect(renderExplanation(catalog)).toContain('previous evaluation');
    expect(catalog.facts).toHaveLength(1);
    const mate = buildExplanationFacts('7k/6Q1/5K2/8/8/8/8/8 b - - 0 1', evaluation([], 'Checkmate'));
    expect(renderExplanation(mate)).toContain('Checkmate'); expect(mate.facts.some(f => f.role === 'reply')).toBe(false);
});
it('names a different preferred move in the before-position without inventing why it ranks higher', () => {
    const board = new Chess(); playUci(board, 'h2h3');
    const catalog = buildExplanationFacts(board.fen(), result(board.fen(), 'e7e5'), { summary: 'untrusted prose is ignored', label: 'Inaccuracy', before: result(DEFAULT_POSITION, 'e2e4 e7e5'), history: { sessionId: 'a', initialFen: DEFAULT_POSITION, moves: ['h2h3'], ply: 1 } });
    const text = renderExplanation(catalog);
    expect(text).toContain('evaluated strength');
    expect(text).not.toContain("alternative");
    expect(catalog.facts.some(f => f.id==='played.alternative')).toBe(false);
    expect(text).not.toContain('untrusted');
});
it('keeps defended targets as attacks and never describes them as winning material', () => {
    const facts = moveThreatFacts('7k/8/2p5/3p4/8/8/8/R6K w - - 0 1', 'a1d1', 'recommended', 'after');
    const attack = facts.find(f => f.target?.square === 'd5');
    expect(attack?.evidence).toBe('attack-map');
    expect(attack?.text).toContain('does not establish a material win');
});
it('does not include an illegal continuation tail or substitute a made-up reply', () => {
    const evaluated = result(DEFAULT_POSITION, 'e2e4');
    evaluated.candidates[0].uciPv = ['e2e4', 'd8h4']; // Blocked by the pawn on e7.
    const catalog = buildExplanationFacts(DEFAULT_POSITION, evaluated);
    expect(catalog.facts.some(f => f.role === 'reply')).toBe(false);
    expect(renderExplanation(catalog)).not.toContain('h4');
});

