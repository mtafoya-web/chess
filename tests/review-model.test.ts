import { expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { evaluation, positionEvaluation } from '../src/chess';
import { moveFeedback } from '../src/move-feedback';
import { ReviewAnalyzer } from '../src/review-analysis';
import { winPercent, moveAccuracy, gameAccuracy, DEFAULT_REVIEW_PREFERENCES } from '../src/review-scoring';
import { sessionFromMoves } from '../src/review-session';
import { summarizeReview, coachingText, type ReviewState } from '../src/review-model';
import { vi } from 'vitest';
const cp=(value:number,best='d2d4')=>evaluation([{uci:best,san:'d4',pv:'d4',score:value/100,engineScore:{kind:'cp',value}}]);
it('uses evaluation context, symmetry and fixed accuracy vectors',()=>{
    expect(winPercent(0)).toBe(50);expect(winPercent(100)).toBeCloseTo(59.102589719,6);
    expect(winPercent(-100)).toBeCloseTo(100-winPercent(100),9);
    expect(winPercent(9000)).toBe(winPercent(1000));expect(moveAccuracy(0)).toBe(100);
    expect(moveAccuracy(10)).toBeCloseTo(64.579828454,5);
    const session=sessionFromMoves(['e4']);const m=session.moves[0];
    expect(moveFeedback(m,cp(0),cp(-300)).label).toBe('Blunder');
    expect(moveFeedback(m,cp(1000),cp(700)).label).toBe('Good');
    expect(moveFeedback(m,cp(0,'e2e4'),cp(-400))).toMatchObject({label:'Review',provisional:true,lossCp:400});
    expect(gameAccuracy([{cp:0},{cp:0,color:'w'},{cp:0,color:'b'}],'w')).toBe(100);
    expect(gameAccuracy([{cp:0}],'w')).toBeUndefined();
});
it('confirms serious grades and retains uncertainty when a deeper search changes the band',async()=>{
    const analyze=vi.fn().mockResolvedValueOnce(cp(0)).mockResolvedValueOnce(cp(-400)).mockResolvedValueOnce(cp(0)).mockResolvedValueOnce(cp(-50));
    const preliminary=vi.fn();
    const result=await new ReviewAnalyzer({analyze}).analyze({type:'REVIEW_ANALYZE',sessionId:'s',requestId:'r',initialFen:new Chess().fen(),moves:['e2e4'],ply:1},new AbortController().signal,preliminary);
    expect(preliminary).toHaveBeenCalledWith(expect.objectContaining({feedback:expect.objectContaining({provisional:true,label:'Blunder'})}));
    expect(result.feedback).toMatchObject({label:'Good',confirmed:true,provisional:true});
    expect(analyze.mock.calls.map(c=>c[3])).toEqual(['standard','standard','confirm','confirm']);
});
it('checks a legal alternative from the exercise root without altering the game mainline',async()=>{
    const analyze=vi.fn(async(_fen:string,_signal:AbortSignal,_history?:{initialFen:string;moves:string[]})=>cp(0,'d2d4'));
    const request={type:'REVIEW_ANALYZE' as const,sessionId:'s',requestId:'r',initialFen:new Chess().fen(),moves:['e2e4','e7e5'],ply:1,attempt:'d2d4',profile:'confirm' as const,ai:false};
    const result=await new ReviewAnalyzer({analyze}).analyze(request,new AbortController().signal);
    expect(result.move?.uci).toBe('d2d4');expect(request.moves).toEqual(['e2e4','e7e5']);
    expect(analyze.mock.calls[1][2]).toEqual({initialFen:request.initialFen,moves:['d2d4']});
});
it('builds sparse graphs, filters key moments and preserves supported meaning at every level',()=>{
    const session=sessionFromMoves(['f3','e5','g4','Qh4#']);
    const move=session.moves[2];const after=evaluation([{uci:'d8h4',san:'Qh4#',pv:'Qh4#',uciPv:['d8h4'],score:-100,depth:16}]);
    const assessment={ply:3,before:cp(0),after,feedback:{label:'Blunder',summary:'',lossWinPercent:45}};
    const state:ReviewState={session,assessments:[assessment],preferences:{...DEFAULT_REVIEW_PREFERENCES,side:'w'},running:false,updatedAt:0,attempts:[]};
    const summary=summarizeReview(state);expect(summary.points.map(p=>p.ply)).toEqual([3]);expect(summary.moments).toEqual([3]);expect(summary.accuracy.w).toBeUndefined();
    expect(summary.lessons[0].id).toBe('mate');
    expect(coachingText(move,assessment)).toContain('forcing checks');
    expect(coachingText(move,assessment,{...state.preferences,level:'advanced'})).toContain('depth 16');
    expect(summarizeReview({...state,preferences:{...state.preferences,side:'b'}}).moments).toEqual([]);
    expect(summarizeReview({...state,assessments:[{...assessment,feedback:{...assessment.feedback,provisional:true}}]}).lessons).toEqual([]);
});
it('does not terminate an unclaimed fifty-move position',()=>{
    expect(positionEvaluation(new Chess('7k/8/8/8/8/8/8/KR6 w - - 100 60'))).toBeUndefined();
});
