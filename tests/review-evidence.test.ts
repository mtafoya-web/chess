import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Chess } from 'chess.js';
import { evaluation, playUci } from '../src/chess';
import { reviewEvidence, evidenceLine, formatEvidenceLine } from '../src/review-evidence';
import { reviewInsight } from '../src/review-insights';
import { buildExplanationFacts } from '../src/explanation-facts';
import { coachPrompt, validatePlan, renderExplanation } from '../src/coach-prompt';
import type { Candidate, Evaluation } from '../src/types';
import type { ReviewMove } from '../src/review-types';

const searched = (pv: string[], score = 0): Evaluation => evaluation(pv.length ? [{uci: pv[0], san: '', pv: '', uciPv: pv, score, depth: 16}] : []);
function fixture(fen: string, uci: string, pv: string[], preferred?: string[]) {
    const board = new Chess(fen), played = playUci(board, uci);
    const move: ReviewMove = {ply: 1, uci, san: played.san, color: played.color, beforeFen: fen, afterFen: board.fen()};
    const after = searched(pv), before = preferred ? searched(preferred) : undefined;
    return {move, after, before, evidence: reviewEvidence(move, before, after)};
}
const central = JSON.parse(readFileSync('tests/fixtures/review-central-tension.json', 'utf8')) as {
    move: ReviewMove; before: Candidate[]; after: Candidate[]; history: string[];
};
it('reproduces the reported g3 position from legal history and explains central recapture options', () => {
    const board = new Chess();
    for (const uci of central.history) playUci(board, uci);
    expect(board.fen()).toBe(central.move.afterFen);
    const before = evaluation(central.before), after = evaluation(central.after);
    const evidence = reviewEvidence(central.move, before, after);
    expect(evidence.evaluation?.moverDeltaCp).toBe(-87);
    expect(evidence.actualMaterialChange).toBe(0);
    expect(evidence.existingTension).toContain('e4');
    expect(evidence.causes[0]).toMatchObject({kind: 'central-support', change: 'comparison', steps: [0]});
    expect(evidence.causes[0].text).toContain('1 legal recapture option');
    expect(evidence.causes[0].text).toContain('compared with 2');
    const insight = reviewInsight(central.move, {label: 'Inaccuracy', summary: '', lossCp: 87}, before, after);
    expect(insight.consequence).toBeUndefined();
    expect(insight.summary).not.toMatch(/hanging|small setback|down.*material|weakens light squares/i);
    expect(insight.continuation).toContain('4... dxe4');
    expect(insight.continuation).toContain('5... Qxd1+');
    expect(insight.alternative).toContain('4. Nc3');
    expect(insight.summary).not.toContain('Nc3');
});
it('rejects a first-capture warning for equal pawn exchanges', () => {
    const f = fixture('7k/8/8/3p4/4P3/3P4/6P1/7K w - - 0 1', 'g2g3', ['d5e4', 'd3e4']);
    expect(f.evidence.actualMaterialChange).toBe(0);
    expect(f.evidence.causes).toEqual([]);
    expect(f.evidence.existingTension).toEqual(['e4']);
    expect(reviewInsight(f.move, {label:'Mistake',summary:''}, f.before, f.after).consequence).toBeUndefined();
});
it('does not call a truncated exchange a settled material loss', () => {
    const f = fixture('7k/8/8/3p4/4P3/3P4/6P1/7K w - - 0 1', 'g2g3', ['d5e4']);
    expect(f.evidence.actual.unsettled).toBe(true);
    expect(f.evidence.causes).toEqual([]);
    const text = reviewInsight(f.move, {label:'Mistake',summary:''}, f.before, f.after).continuation;
    expect(text).toContain('exchange is unfinished');
});
it('identifies a newly exposed rook rather than every legal capture', () => {
    const f = fixture('6kb/8/8/8/8/8/8/1R5K w - - 0 1', 'b1a1', ['h8a1'], ['b1b2']);
    expect(f.evidence.causes[0]).toMatchObject({kind:'material',change:'new',square:'a1'});
    expect(f.evidence.actualMaterialChange).toBe(-5);
});
it('explains removal of a legal recapturer from an already attacked rook', () => {
    const f = fixture('6kb/8/8/8/8/1N6/8/R6K w - - 0 1', 'b3c5', ['h8a1']);
    expect(f.evidence.causes[0]).toMatchObject({kind:'material',change:'worsened',square:'a1'});
    expect(f.evidence.causes[0].text).toContain('removes a legal recapture');
});
it('does not suppress a defended target when its recapturing pawn is pinned', () => {
    const f = fixture('3r3k/8/8/3p4/4P3/3P4/6P1/3K4 w - - 0 1', 'g2g3', ['d5e4'], ['e4e5']);
    expect(new Chess(f.move.afterFen).attackers('e4', 'w')).toContain('d3');
    expect(f.evidence.actual.steps[0].recaptures).toEqual([]);
    expect(f.evidence.causes[0]).toMatchObject({kind:'material',change:'left-unresolved',square:'e4',motif:'pin'});
});
it('connects a searched knight fork to the eventual material loss', () => {
    const f = fixture('k7/8/8/8/6n1/8/P7/3K3R w - - 0 1', 'a2a3', ['g4f2','d1e1','f2h1']);
    expect(f.evidence.causes[0]).toMatchObject({kind:'material',motif:'fork',square:'h1'});
    expect(f.evidence.causes[0].text).toContain('king on D1 and rook on H1');
});
it('prioritizes mate later in the PV over an incidental capture', () => {
    const board = new Chess(); for (const san of ['f3','e5']) board.move(san);
    const f = fixture(board.fen(), 'g2g4', ['d8h4']);
    expect(f.evidence.causes[0]).toMatchObject({kind:'mate',square:'e1'});
});
it('does not turn an ordinary check into the explanation for an inaccuracy', () => {
    const f = fixture('7k/8/8/8/8/8/P6r/K7 w - - 0 1', 'a2a3', ['h2h1']);
    expect(f.evidence.actual.steps[0].check).toBe(true);
    expect(f.evidence.causes).toEqual([]);
});
it('accounts for material taken by the played move before evaluating the reply', () => {
    const f = fixture('3rk3/8/8/8/8/8/8/3QK3 w - - 0 1', 'd1d8', ['e8d8'], ['d1e2']);
    expect(f.evidence.actualMaterialChange).toBe(-4); // queen for rook, not a fresh nine-point loss
    expect(f.evidence.causes[0]?.text).toContain('4 material points');
});
it('tracks an en-passant victim to its displayed square and names the empty landing square separately', () => {
    const f = fixture('7k/8/8/8/3p4/8/4P3/7K w - - 0 1', 'e2e4', ['d4e3']);
    expect(f.evidence.actual.steps[0]).toMatchObject({victimOrigin:'e4',to:'e3',enPassant:true});
    expect(f.evidence.causes[0]).toMatchObject({square:'e4'});
});
it('refuses causal claims from an invalid PV tail and exposes only the legal prefix', () => {
    const f = fixture('6kb/8/8/8/8/8/8/1R5K w - - 0 1', 'b1a1', ['h8a1','h1h8']);
    expect(f.evidence.actual.invalidTail).toBe(true);
    expect(f.evidence.causes).toEqual([]);
    expect(formatEvidenceLine(f.evidence.actual)).toContain('Remaining line failed legal validation');
    expect(f.evidence.actual.steps).toHaveLength(1);
});
it('preserves castling rook identity through a later searched capture', () => {
    const line = evidenceLine('4k2r/8/8/8/8/8/1R6/4K3 b k - 0 1', searched(['e8g8','b2f2','g8h7','f2f8']), 'w');
    expect(line.steps[3]).toMatchObject({attackerOrigin:'b2',victimOrigin:'h8'});
});
it('supplies distinct branches, mover-relative scores and validated cause steps to every provider', () => {
    const before = evaluation(central.before), after = evaluation(central.after), history = {sessionId:'central',initialFen:new Chess().fen(),moves:central.history,ply:7};
    const catalog = buildExplanationFacts(central.move.afterFen, after, {summary:'',label:'Inaccuracy',lossCp:87,before,history});
    expect(catalog.reviewEvidence?.verifiedHistory?.recentMoves).toEqual(central.history);
    expect(coachPrompt(catalog)).toContain('"moverDeltaCp":-87');
    const valid = {leadFactId:'played.move',toneVariant:'direct',evidenceStepIds:[0]};
    expect(validatePlan(JSON.stringify(valid),catalog)).toBeDefined();
    for (const ids of [[-1],[99],[0,0],['0'],[]]) expect(validatePlan(JSON.stringify({...valid,evidenceStepIds:ids}),catalog)).toBeUndefined();
    expect(renderExplanation(catalog)).toContain('more ways to resolve the central tension');
    expect(renderExplanation(catalog)).not.toContain('Nc3');
});

it('recognizes an existing geometric attack that only becomes legal after a pin is removed', () => {
    const f = fixture('4k3/4n3/2P5/8/8/8/8/4R2K w - - 0 1', 'e1a1', ['e7c6']);
    expect(new Chess(f.move.beforeFen).isAttacked('c6','b')).toBe(true);
    expect(f.evidence.causes[0]).toMatchObject({kind:'material',change:'new',square:'c6'});
    expect(f.evidence.causes[0].text).toContain('could not legally make this capture before');
});

it('describes a changed checking line near the king only after comparison with a legal preferred branch', () => {
    const f = fixture('3qk3/8/8/8/8/8/5PP1/4K3 w - - 0 1', 'f2f3', ['d8h4'], ['g2g3']);
    expect(f.evidence.causes[0]).toMatchObject({kind:'king-lines',change:'comparison',square:'e1'});
    expect(f.evidence.causes[0].text).toContain('same reply does not check in the preferred position');
});
it('names pawn pressure on a development square without saying the knight cannot move there', () => {
    const f = fixture('6k1/8/8/3p4/8/8/6P1/1N4K1 w - - 0 1', 'g2g3', ['d5d4'], ['b1a3']);
    expect(f.evidence.causes[0]).toMatchObject({kind:'development-space'});
    expect(f.evidence.causes[0].text).toContain('control of C3');
    expect(f.evidence.causes[0].text).toContain('does not make the knight move illegal');
    const position = new Chess(f.evidence.actual.steps[0].afterFen);
    expect(position.moves({verbose:true}).some(m=>m.lan==='b1c3')).toBe(true);
});
it('rejects evidence computed for a different displayed position', () => {
    const f = fixture('6kb/8/8/8/8/8/8/1R5K w - - 0 1', 'b1a1', ['h8a1']);
    expect(()=>reviewEvidence({...f.move,afterFen:f.move.beforeFen},f.before,f.after)).toThrow('position mismatch');
});

it('does not attribute a development difference when both branches leave the knight in place', () => {
    const f = fixture('6k1/8/8/3p4/8/8/6P1/1N4K1 w - - 0 1', 'g2g3', ['d5d4'], ['g2g4']);
    expect(f.evidence.causes).toEqual([]);
});
it('keeps evaluation changes and material losses relative to the Black mover', () => {
    const f = fixture('1r5k/8/8/8/8/8/8/6KB b - - 0 1', 'b8a8', ['h1a8'], ['b8b6']);
    const evidence = reviewEvidence(f.move,searched(['b8b6'],-.4),searched(['h1a8'],2.1));
    expect(evidence.evaluation?.moverDeltaCp).toBe(-250);
    expect(evidence.actualMaterialChange).toBe(-5);
    expect(evidence.causes[0]).toMatchObject({kind:'material',change:'new',square:'a8'});
    expect(evidence.causes[0].text).toContain('White captures the rook');
});
