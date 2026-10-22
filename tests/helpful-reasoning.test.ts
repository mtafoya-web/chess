import { expect, it } from 'vitest';
import { Chess, DEFAULT_POSITION } from 'chess.js';
import { readableMove } from '../src/readable-move';
import { positionalFacts } from '../src/positional-facts';
import { createOpeningLookup } from '../src/opening-context';
import { readFileSync } from 'node:fs';
const openingContext = createOpeningLookup(JSON.parse(readFileSync('src/data/openings.json', 'utf8')));
import { buildExplanationFacts } from '../src/explanation-facts';
import { renderExplanation } from '../src/coach-prompt';
import { candidateFrom, evaluation, playUci } from '../src/chess';
const result = (fen: string, moves: string) => evaluation([candidateFrom(`info depth 12 score cp 20 pv ${moves}`, fen)!.candidate]);
function position(moves: string[]) { const board = new Chess(); for (const uci of moves) playUci(board, uci); return { fen: board.fen(), history: { sessionId: 'test', initialFen: DEFAULT_POSITION, moves, ply: moves.length } }; }
it('formats legal captures, disambiguation, castling and promotion', () => {
    expect(readableMove(DEFAULT_POSITION, 'g1f3')).toBe('Knight to F3');
    expect(readableMove('7k/8/8/4p3/8/8/3N4/6NK w - - 0 1', 'd2f3')).toBe('Knight from D2 to F3');
    expect(readableMove('4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1', 'e4d5')).toBe('Pawn takes on D5');
    expect(readableMove('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'e1g1')).toBe('Castle kingside');
    expect(readableMove('7k/P7/8/8/8/8/8/7K w - - 0 1', 'a7a8q')).toBe('Pawn to A8, promote to Queen');
    expect(() => readableMove(DEFAULT_POSITION, 'e2e5')).toThrow();
});
it('grounds first-move central and cleared-line ideas without claiming an open file', () => {
    const facts = positionalFacts(DEFAULT_POSITION, 'e2e4', 'recommended', 'after');
    expect(facts.some(f => f.kind === 'center')).toBe(true);
    expect(facts.filter(f => f.kind === 'opened-line').map(f => f.squares[0]).sort()).toEqual(['d1', 'f1']);
    const text = renderExplanation(buildExplanationFacts(DEFAULT_POSITION, result(DEFAULT_POSITION, 'e2e4 e7e5')));
    expect(text).toContain('central foothold'); expect(text).toContain('bishop on F1'); expect(text).not.toMatch(/open.*file|no specific tactic|best evaluation/i);
    expect(text.split(/(?<=[.!?])\s+/).length).toBeLessThanOrEqual(3);
});
it('teaches verified original knight development, actual E5 pressure and retained castling rights', () => {
    const { fen, history } = position(['e2e4', 'e7e5']);
    const facts = positionalFacts(fen, 'g1f3', 'recommended', 'after', history);
    expect(facts.map(f => f.kind)).toContain('development');
    expect(facts.find(f => f.kind === 'center')?.text).toContain('E5');
    expect(facts.find(f => f.kind === 'castling')?.text).toContain('G1');
    expect(facts.some(f => f.kind === 'opened-line')).toBe(false);
    expect(positionalFacts(fen.replace(' KQkq ', ' - '), 'g1f3', 'r', 'after').some(f => f.kind === 'castling')).toBe(false);
    const noPawn = position(['e2e4', 'd7d5']);
    expect(positionalFacts(noPawn.fen, 'g1f3', 'r', 'after', noPawn.history).map(f => f.text).join(' ')).not.toContain('Black has a pawn');
});
it('does not manufacture development from a custom endgame or a queen mobility count', () => {
    const fen = '7k/8/8/8/8/8/8/6NK w - - 0 1';
    expect(positionalFacts(fen, 'g1f3', 'r', 'after').some(f => f.kind === 'development')).toBe(false);
    const { fen: board, history } = position(['e2e4', 'e7e5']);
    expect(positionalFacts(board, 'd1h5', 'r', 'after', history).some(f => f.kind === 'development')).toBe(false);
    const returned = position(['g1f3', 'g8f6', 'f3g1', 'f6g8']);
    expect(positionalFacts(returned.fen, 'g1f3', 'r', 'after', returned.history).some(f => f.kind === 'development')).toBe(false);
});
it('matches pinned opening paths honestly and distinguishes proposed entry from known history', () => {
    const { fen, history } = position(['e2e4', 'e7e5']);
    const match = openingContext(fen, history, 'g1f3');
    expect(match.entered?.name).toContain("King's Knight");
    expect(match.entered?.ply).toBe(3); expect(match.current?.ply).toBeLessThan(3);
    expect(openingContext(fen)).toEqual({});
    expect(openingContext(fen, { ...history, initialFen: fen, moves: [], ply: 0 })).toEqual({});
    const transposed = position(['g1f3', 'c7c5', 'e2e4']);
    expect(openingContext(transposed.fen, transposed.history).current).toMatchObject({ name: 'Sicilian Defense', match: 'transposition', ply: 3 });
});
it('keeps a legal tactical refutation ahead of general opening praise', () => {
    const { fen, history } = position(['f2f3', 'e7e5', 'g2g4']);
    const catalog = buildExplanationFacts(fen, result(fen, 'd8h4'), { summary: '', label: 'Blunder', history, before: result(position(['f2f3', 'e7e5']).fen, 'g1h3') });
    const text = renderExplanation(catalog);
    expect(text).toContain('delivers checkmate'); expect(text).not.toContain('An alternative');
    expect(text).not.toContain('preparing');
    expect(catalog.facts.some(f => f.branch === 'played' && f.id.includes('development'))).toBe(false);
});
