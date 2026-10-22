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
    expect(insight.summary).toContain("Black's bishop can capture White's rook on A1");
    expect(insight.consequence?.square).toBe('a1');
    expect(insight.alternative).toContain('Better alternative');
    expect(insight.summary).not.toContain('alternative');
});
it('marks the real en-passant victim square instead of the empty capture destination',()=>{
    const f=fixture('7k/8/8/8/3p4/8/4P3/7K w - - 0 1','e2e4',['d4e3'],'Mistake');
    const insight=reviewInsight(f.move,f.feedback,undefined,f.after);
    expect(insight.consequence?.square).toBe('e4');
    expect(insight.summary).toContain('pawn from E4 en passant on E3');
});
it('does not turn an attack map or an illegal line into a consequence cue',()=>{
    const f=fixture('6kb/8/8/8/8/8/8/RN5K w - - 0 1','b1a3',['g8f7','a3a8']);
    expect(reviewInsight(f.move,f.feedback,undefined,f.after).consequence).toBeUndefined();
    expect(reviewInsight(f.move,f.feedback,undefined,f.after).summary).not.toContain('capture');
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
    expect(insight.summary).toContain('delivers checkmate');
    expect(insight.consequence).toMatchObject({square:'e1'});
});
