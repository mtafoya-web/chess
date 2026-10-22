import { expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { readFileSync } from 'node:fs';
import { candidateFrom, evaluation, playUci } from '../src/chess';
import { analysisEvidence, analysisFactAllowed } from '../src/analysis-evidence';
import { buildExplanationFacts } from '../src/explanation-facts';
import { coachPrompt, defaultPlan, renderExplanation, validatePlan } from '../src/coach-prompt';
import { createOpeningLookup, type OpeningRow } from '../src/opening-context';

const history = ['e2e4','c7c5','g1f3','g7g6','b1c3'];
const board = new Chess(); for (const uci of history) playUci(board,uci);
const fen = board.fen();
const pv = ['b8c6','d2d4','c5d4','f3d4','f8g7','c1e3','g8f6','f1c4','e8g8','c4b3'];
const searched = (position: string, moves: string[]) => evaluation([candidateFrom(`info depth 17 score cp 20 pv ${moves.join(' ')}`,position)!.candidate]);
const result = searched(fen,pv);
const rows = JSON.parse(readFileSync('src/data/openings.json','utf8')) as OpeningRow[];
const lookup = createOpeningLookup(rows);

it('replays the supplied Sicilian line and finds Black kingside castling beyond the old three-ply limit',()=>{
    const evidence = analysisEvidence(fen,result)!;
    expect(evidence.invalidTail).toBe(false); expect(evidence.pv).toHaveLength(10);
    expect(evidence.kingSafety.b.pvCastling).toEqual({side:'kingside',step:8});
    expect(evidence.kingSafety.w.pvCastling).toBeUndefined();
    expect(evidence.kingSafety.b.rights).toEqual({kingside:true,queenside:true});
    expect(evidence.targetsContested.sort()).toEqual(['d4','e5']);
    expect(evidence.controlDelta.filter(d=>d.after).map(d=>d.square)).toEqual(expect.arrayContaining(['a5','b4','d4','e5']));
    expect(evidence.opponentCentralPushes).toContainEqual({step:1,square:'d4',san:'d4'});
});
it('explains central pressure and the actual bishop/castling plan in two sentences',()=>{
    const catalog = buildExplanationFacts(fen,result);
    const text = renderExplanation(catalog);
    expect(text).toContain('D4 and E5'); expect(text).toContain('bishop to G7');
    expect(text).toContain('castle kingside with O-O');
    expect(text).not.toMatch(/queenside castling|castle queenside|prevents d4/i);
    expect(text).toContain("White's d4 remains legal");
    expect(text.split(/(?<=[.!?])\s+/)).toHaveLength(2);
});
it('keeps verified analysis history in recommendation mode instead of critiquing the previous move',()=>{
    const catalog = buildExplanationFacts(fen,result,{summary:'',mode:'analysis',history:{sessionId:'sicilian',initialFen:new Chess().fen(),moves:history,ply:5}});
    expect(catalog.facts[0].id).toBe('recommended.move');
    expect(renderExplanation(catalog)).toContain('brings a knight into play');
    expect(renderExplanation(catalog)).not.toContain('queenside');
});
it('does not infer castling intent from rights or the g6 pawn when the PV is short',()=>{
    const catalog = buildExplanationFacts(fen,searched(fen,['b8c6']));
    expect(catalog.analysisEvidence!.kingSafety.b.rights.queenside).toBe(true);
    expect(catalog.analysisEvidence!.fianchettos[0]).toMatchObject({color:'b',status:'setup',bishopFrom:'f8',bishopTo:'g7'});
    expect(catalog.facts.some(f=>f.id.includes('.castling.'))).toBe(false);
    expect(renderExplanation(catalog)).not.toMatch(/castl|fianchetto|bishop.*G7/i);
});
it('marks bishop development as PV-confirmed only when Bg7 is legally replayed',()=>{
    expect(analysisEvidence(fen,result)!.fianchettos).toContainEqual(expect.objectContaining({color:'b',wing:'kingside',status:'pv-confirmed',step:4}));
    const first = new Chess(fen); playUci(first,'b8c6'); playUci(first,'d2d4'); playUci(first,'c5d4'); playUci(first,'f3d4'); playUci(first,'f8g7');
    const evidence = analysisEvidence(first.fen(),searched(first.fen(),['c1e3']))!;
    expect(evidence.fianchettos).toContainEqual(expect.objectContaining({color:'b',status:'established'}));
});
it('does not manufacture future plans from a forged SAN string or illegal PV tail',()=>{
    const short = searched(fen,['b8c6']);
    short.candidates[0].pv = 'Nc6 O-O'; short.candidates[0].sanPv = ['Nc6','O-O'];
    short.candidates[0].uciPv = ['b8c6','e8g8']; // wrong player, and the path is blocked
    const evidence = analysisEvidence(fen,short)!;
    expect(evidence.invalidTail).toBe(true); expect(evidence.pv).toHaveLength(1);
    expect(evidence.kingSafety.b.pvCastling).toBeUndefined();
    expect(renderExplanation(buildExplanationFacts(fen,short))).not.toMatch(/castl/i);
});
it('distinguishes long and short castling for each player without confusing O-O-O with O-O',()=>{
    const position = 'r3k2r/ppp2ppp/8/8/8/8/PPP2PPP/R3K2R b KQkq - 0 1';
    const output = searched(position,['e8c8','e1g1']);
    const evidence = analysisEvidence(position,output)!;
    expect(analysisFactAllowed('Black castles queenside with O-O-O.',evidence)).toBe(true);
    expect(analysisFactAllowed('Black castles kingside.',evidence)).toBe(false);
    expect(analysisFactAllowed('White castles kingside.',evidence,'w')).toBe(true);
    expect(renderExplanation(buildExplanationFacts(position,output))).toContain('castle queenside');
});
it('rejects incompatible approved-fact selections and uses the safe local fallback',()=>{
    const catalog = buildExplanationFacts(fen,result);
    for (const text of ['Clearing B8 helps prepare queenside castling.','Black should castle long.','The line contains O-O-O.','Nc6 prevents d4.']) {
        const bad = {id:'recommended.unsupported',role:'support' as const,branch:'recommended',scope:'after:recommended',text,evidence:'test',rank:999};
        catalog.facts.push(bad);
        const plan = {leadFactId:'recommended.move',supportFactId:bad.id,toneVariant:'direct' as const};
        expect(validatePlan(JSON.stringify(plan),catalog)).toBeUndefined();
        expect(defaultPlan(catalog).supportFactId).not.toBe(bad.id);
        expect(renderExplanation(catalog,plan)).not.toContain(text);
        catalog.facts.pop();
    }
});
it('passes verified strategic attributes and qualified opening-position matches to providers',()=>{
    const opening = lookup.positionContext(fen,'b8c6',pv);
    const match = opening.recommendedPosition ?? opening.currentPosition ?? opening.pvPosition;
    expect(match).toBeDefined(); expect(match!.name).toContain('Sicilian');
    const catalog = buildExplanationFacts(fen,result,{summary:'',mode:'analysis',analysisOpening:opening});
    const prompt = coachPrompt(catalog);
    expect(prompt).toContain('"targetsContested":["d4","e5"]');
    expect(prompt).toContain('"pvCastling":{"side":"kingside","step":8}');
    expect(prompt).toContain('"source":"local-position-match"');
    expect(prompt).toContain(match!.name);
    expect(catalog.context.historyCompleteness).toBe('position-only');
    expect(catalog.opening?.current).toBeUndefined();
    expect(catalog.facts.find(f=>f.id==='recommended.opening-position')!.text).toContain('searched line reaches a position matching');
});
it('omits ambiguous opening names and invalid recommended-position matches',()=>{
    const key = fen.split(' ').slice(0,4).join(' ');
    const ambiguous = createOpeningLookup([['B27','One setup','',key],['B28','Another setup','',key]]);
    expect(ambiguous.positionContext(fen).currentPosition).toBeUndefined();
    expect(lookup.positionContext(fen,'b8b1')).toEqual({});
});
it('does not tag a bishop route occupied by a pawn or a wrong-colored piece',()=>{
    const position = '4k2r/8/6p1/8/8/8/8/4K3 b k - 0 1';
    expect(analysisEvidence(position,searched(position,['h8h7']))!.fianchettos).toEqual([]);
});

it('drops a book label attached to the wrong branch or FEN',()=>{
    const opening = lookup.positionContext(fen,'b8c6',pv);
    expect(opening.pvPosition).toBeDefined();
    opening.pvPosition = {...opening.pvPosition!,step:0};
    const catalog = buildExplanationFacts(fen,result,{summary:'',mode:'analysis',analysisOpening:opening});
    expect(catalog.analysisEvidence?.opening?.pvPosition).toBeUndefined();
    expect(catalog.facts.some(f=>f.id==='recommended.opening-position')).toBe(false);
});
