import { expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { playUci, evaluation } from '../src/chess';
import { reviewInsight, reviewProblem } from '../src/review-insights';

function fixture(fen:string,uci:string,line:string[],label='Blunder'){
    const board=new Chess(fen),move=playUci(board,uci);
    return {move:{ply:1,uci,san:move.san,color:move.color,beforeFen:fen,afterFen:board.fen()},feedback:{label,summary:'untrusted',lossCp:250},
        after:evaluation([{uci:line[0],san:line[0],pv:'',uciPv:line,score:-2.5}])};
}
it('explains a legally searched capture and highlights the currently exposed piece',()=>{
    const f=fixture('6kb/8/8/8/8/8/8/RN5K w - - 0 1','b1a3',['h8a1']);
    const before=evaluation([{uci:'a1a2',san:'Ra2',pv:'Ra2',score:.2}]);
    const insight=reviewInsight(f.move,f.feedback,before,f.after);
    expect(insight.summary).toContain("A1 was already under attack");
    expect(insight.summary).toContain("captures the rook on A1");
    expect(insight.consequence?.square).toBe('a1');
    expect(insight.alternative).toContain('Better alternative');
    expect(insight.summary).not.toContain('alternative');
});
it('marks the real en-passant victim square instead of the empty capture destination',()=>{
    const f=fixture('7k/8/8/8/3p4/8/4P3/7K w - - 0 1','e2e4',['d4e3'],'Mistake');
    const insight=reviewInsight(f.move,f.feedback,undefined,f.after);
    expect(insight.consequence?.square).toBe('e4');
    expect(insight.summary).toContain('pawn originally on E4');
    expect(insight.summary).toContain('en passant on E3');
});
it('does not turn an attack map or an illegal line into a consequence cue',()=>{
    const f=fixture('6kb/8/8/8/8/8/8/RN5K w - - 0 1','b1a3',['g8f7','a3a8']);
    expect(reviewInsight(f.move,f.feedback,undefined,f.after).consequence).toBeUndefined();
    expect(reviewInsight(f.move,f.feedback,undefined,f.after).summary).toContain('do not establish a specific tactical or positional reason');
});
it('keeps good-move feedback brief with no suggested alternative or target cue',()=>{
    const f=fixture(new Chess().fen(),'e2e4',['e7e5'],'Good');
    const insight=reviewInsight(f.move,f.feedback,undefined,f.after);
    expect(insight.summary).toContain('previous evaluation');
    expect(insight.consequence).toBeUndefined(); expect(insight.alternative).toBeUndefined();
    expect(reviewProblem('Missed mate')).toBe('missed-mate');
    expect(reviewProblem('Best')).toBeUndefined();
});
it('highlights the king when the legal continuation delivers checkmate',()=>{
    const board=new Chess(); board.move('f3'); board.move('e5');
    const f=fixture(board.fen(),'g2g4',['d8h4']);
    const insight=reviewInsight(f.move,f.feedback,undefined,f.after);
    expect(insight.summary).toContain('can deliver checkmate');
    expect(insight.consequence).toMatchObject({square:'e1'});
});

it('does not highlight a pawn traded away and recaptured with equal material',()=>{
    const f=fixture(new Chess().fen(),'e2e4',['d7d5','e4d5','d8d5']);
    const insight=reviewInsight(f.move,f.feedback,undefined,f.after);
    expect(insight.consequence).toBeUndefined();
    expect(insight.evidence?.actualMaterialChange).toBe(0);
    expect(insight.evidence?.actual.steps[2].victimOrigin).toBe('e4');
    expect(insight.continuation).toContain('Qxd5');
    expect(insight.evaluationNote).toContain('does not mean that many pawns were captured');
    expect(insight.summary).not.toContain('small setback');
});
it('explains missed mate without marking an unrelated opponent threat',()=>{
    const f=fixture(new Chess().fen(),'e2e4',['d7d5','e4d5','d8d5'],'Missed mate');
    const insight=reviewInsight(f.move,f.feedback,undefined,f.after);
    expect(insight.gradeExplanation).toContain('missed chance to force checkmate');
    expect(insight.consequence).toBeUndefined();
    expect(insight.cues.map(c=>c.kind)).toEqual(['origin','destination']);
});
it('explains overlapping destination and affected-piece cues without confusing their roles',()=>{
    const f=fixture('7k/8/8/8/3p4/8/4P3/7K w - - 0 1','e2e4',['d4e3'],'Mistake');
    const insight=reviewInsight(f.move,f.feedback,undefined,f.after);
    expect(insight.cues.filter(c=>c.square==='e4').map(c=>c.kind)).toEqual(['destination','consequence']);
    expect(insight.consequence!.label).toContain('en passant');
    expect(insight.playedDescription).toBe('White moved the pawn from E2 to E4.');
});

it('explains check without implying a forced loss',()=>{
    const f=fixture('7k/8/8/8/8/8/P6r/K7 w - - 0 1','a2a3',['h2h1'],'Mistake');
    const insight=reviewInsight(f.move,f.feedback,undefined,f.after);
    expect(insight.continuation).toContain('Rh1+');
    expect(insight.consequence).toBeUndefined();
    expect(insight.summary).toContain('do not establish a specific tactical or positional reason');
});
it('explains a quiet inaccuracy without inventing a tactical reason',()=>{
    const f=fixture(new Chess().fen(),'e2e4',['e7e5'],'Inaccuracy');
    const insight=reviewInsight(f.move,f.feedback,undefined,f.after);
    expect(insight.gradeExplanation).toContain('Inaccuracy: a small setback');
    expect(insight.summary).toContain('do not establish a specific tactical or positional reason');
    expect(insight.cues.map(c=>c.kind)).toEqual(['origin','destination']);
});

it('orders review takeaway before the verified effect and its plain-language meaning',()=>{
    const board=new Chess(); board.move('f3'); board.move('e5');
    const f=fixture(board.fen(),'g2g4',['d8h4']);
    const text=reviewInsight(f.move,f.feedback,undefined,f.after).summary;
    expect(text).toMatch(/^Black can deliver checkmate with Qh4#/);
    expect(text).not.toContain('small setback according to the engine');
    expect(text).not.toContain('Better alternative');
});
