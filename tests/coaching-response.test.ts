import { afterEach, expect, it, vi } from 'vitest';
import { Chess, DEFAULT_POSITION } from 'chess.js';
import { candidateFrom, evaluation, playUci } from '../src/chess';
import { buildExplanationFacts } from '../src/explanation-facts';
import { coachPrompt, MAX_COACH_PROMPT_CHARS, validateCoachingResponse } from '../src/coach-prompt';
import { clearExplanationCache, explain } from '../src/providers';
import { DEFAULT_SETTINGS } from '../src/types';

afterEach(() => { clearExplanationCache(); vi.unstubAllGlobals(); });
const searched = (fen: string, line: string, score = 20) => candidateFrom(`info depth 16 score cp ${score} pv ${line}`, fen)!.candidate;
const result = evaluation([searched(DEFAULT_POSITION, 'e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6 e1g1 f8e7'), searched(DEFAULT_POSITION, 'd2d4 d7d5'), searched(DEFAULT_POSITION, 'g1f3 d7d5')]);
const prose = {
    explanation: 'White places a pawn on E4, gaining a central foothold and clearing the bishop on F1. Black can answer with e5; this is a searched continuation rather than a forced reply.',
    lesson: 'Look for moves that contest the center while bringing your pieces into play.',
    evidenceIds: ['recommended.move'], lineRefs: [{ branch: 'preferred', step: 1 }],
};

it('supplies three distinct legal branches capped at eight plies and useful position evidence', () => {
    const catalog = buildExplanationFacts(DEFAULT_POSITION, result);
    expect(catalog.coaching?.branches.map(b => b.id)).toEqual(['preferred','alternative','alternative-2']);
    expect(catalog.coaching?.branches[0]).toMatchObject({ truncated: true, invalidTail: false });
    expect(catalog.coaching?.branches[0].steps).toHaveLength(8);
    for (const branch of catalog.coaching!.branches) {
        const board = new Chess(branch.rootFen);
        for (const step of branch.steps) expect(playUci(board, step.uci).san).toBe(step.san);
    }
    expect(coachPrompt(catalog)).toContain('"afterWhite"');
    expect(coachPrompt(catalog).length).toBeLessThanOrEqual(MAX_COACH_PROMPT_CHARS);
});

it.each(['beginner','intermediate','advanced'] as const)('passes %s learning level into the shared prompt', level => {
    const catalog = buildExplanationFacts(DEFAULT_POSITION, result, { summary: '', mode: 'analysis', level });
    expect(coachPrompt(catalog)).toContain(`"level":"${level}"`);
    expect(validateCoachingResponse(JSON.stringify(prose), catalog)).toEqual(prose);
});

it('rejects fabricated evidence and branch references without promising prose truth checking', () => {
    const catalog = buildExplanationFacts(DEFAULT_POSITION, result);
    for (const value of [
        { ...prose, evidenceIds: ['invented.queen'] }, { ...prose, lineRefs: [{ branch: 'preferred', step: 8 }] },
        { ...prose, lineRefs: [{ branch: 'played', step: 0 }] }, { ...prose, evidenceIds: [] },
        { ...prose, explanation: 'x'.repeat(6001) }, { ...prose, extra: 'unsupported field' },
    ]) expect(validateCoachingResponse(JSON.stringify(value), catalog)).toBeUndefined();
});

it('separates played and preferred roots, handles black mover loss, and never converts mate or terminal scores to cp', () => {
    const board = new Chess(); playUci(board, 'e2e4');
    const beforeFen = board.fen(); playUci(board, 'd7d5');
    const history = { sessionId: 'black', initialFen: DEFAULT_POSITION, moves: ['e2e4','d7d5'], ply: 2 };
    const before = evaluation([searched(beforeFen,'e7e5',0)]), after = evaluation([searched(board.fen(),'e4d5',100)]);
    const catalog = buildExplanationFacts(board.fen(), after, { summary: '', before, history, level: 'advanced' });
    expect(catalog.coaching?.branches.map(b => b.id)).toEqual(['played','preferred']);
    expect(catalog.coaching?.branches[0].steps[0].uci).toBe('d7d5');
    expect(catalog.coaching?.assessment?.moverDeltaCp).toBe(-100);
    for (const engineScore of [{ kind: 'mate', winner: 'w', moves: 2 }, { kind: 'terminal', winner: 'w' }] as const) {
        const value = buildExplanationFacts(board.fen(), { ...after, engineScore }, { summary: '', before, history });
        expect(value.coaching?.assessment?.moverDeltaCp).toBeUndefined();
        expect(value.coaching?.assessment?.afterWhite).toBeUndefined();
        expect(value.coaching?.assessment?.afterScore).toEqual(engineScore);
    }
});

it('publishes complete evidence-referenced prose beyond the old 600-character limit and reuses its cache', async () => {
    const value = { ...prose, explanation: `${prose.explanation} ${prose.explanation} ${prose.explanation} ${prose.explanation}` };
    const prompt = vi.fn(async () => JSON.stringify(value)), create = vi.fn(async () => ({ prompt, destroy: vi.fn() }));
    vi.stubGlobal('LanguageModel', { availability: async () => 'available', create });
    const settings = { ...structuredClone(DEFAULT_SETTINGS), provider: 'chrome' as const, keys: {} }, output: string[] = [];
    await explain(settings, DEFAULT_POSITION, result, new AbortController().signal, text => output.push(text));
    await explain(settings, DEFAULT_POSITION, result, new AbortController().signal, text => output.push(text));
    expect(output[0]).toBe(`${value.explanation}\n\nTakeaway: ${value.lesson}`);
    expect(output[0].length).toBeGreaterThan(600); expect(output[1]).toBe(output[0]); expect(create).toHaveBeenCalledOnce();
});

it('truncates illegal continuation tails before presenting a tree to the model', () => {
    const broken = { ...result, candidates: [{ ...result.candidates[0], uciPv: ['e2e4','d8h4'] }] };
    const catalog = buildExplanationFacts(DEFAULT_POSITION, broken);
    expect(catalog.coaching?.branches[0]).toMatchObject({ invalidTail: true });
    expect(catalog.coaching?.branches[0].steps.map(s => s.uci)).toEqual(['e2e4']);
});
