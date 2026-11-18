// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { ReviewTools } from '../src/review-tools';
import { sessionFromMoves } from '../src/review-session';
import { evaluation } from '../src/chess';
import { DEFAULT_REVIEW_PREFERENCES } from '../src/review-scoring';
it('supports square entry, rejects illegal notation, hides revealed answer entry and keeps visual preferences',()=>{
    const tools=new ReviewTools();document.body.append(tools.element);const action=vi.fn();tools.onAction=action;
    const move=sessionFromMoves(['e4']).moves[0],before=evaluation([{uci:'d2d4',san:'d4',pv:'d4',score:0}]);
    tools.update(move,{ply:1,before,after:evaluation([]),feedback:{label:'Mistake',summary:''}},{...DEFAULT_REVIEW_PREFERENCES,visuals:false});
    expect(tools.start()).toBe(true);
    const san=tools.element.querySelector<HTMLInputElement>('[data-san]')!,form=tools.element.querySelector('form')!;
    san.value='Nf8';form.dispatchEvent(new Event('submit',{cancelable:true}));expect(action).not.toHaveBeenCalled();expect(tools.element.textContent).toContain('not legal');
    san.value='';const from=tools.element.querySelector<HTMLSelectElement>('[data-from]')!,to=tools.element.querySelector<HTMLSelectElement>('[data-to]')!;
    from.value='d2';from.dispatchEvent(new Event('change'));to.value='d4';form.dispatchEvent(new Event('submit',{cancelable:true}));expect(action).toHaveBeenCalledWith('check','d2d4');
    tools.hint();expect(tools.hinted).toBe(true);tools.reveal();expect(form.hidden).toBe(true);expect(tools.element.querySelector('.practice-result')!.textContent).toContain('d4');
    tools.stop();tools.element.querySelector<HTMLSelectElement>('[data-level]')!.dispatchEvent(new Event('change'));expect(action).toHaveBeenLastCalledWith('preferences',expect.objectContaining({visuals:false}));
});

it('offers practice only for a confirmed mistake with a legal improvement',()=>{
    const tools=new ReviewTools(),move=sessionFromMoves(['e4']).moves[0];
    const after=evaluation([]),before=evaluation([{uci:'d2d4',san:'d4',pv:'d4',score:0}]);
    const practice=tools.element.querySelector<HTMLButtonElement>('[data-action="practice"]')!;
    const why=tools.element.querySelector<HTMLButtonElement>('[data-action="why"]')!;
    tools.update(move,{ply:1,after,feedback:{label:'Mistake',summary:''}},DEFAULT_REVIEW_PREFERENCES);
    expect(practice.hidden).toBe(true);expect(tools.start()).toBe(false);
    tools.update(move,{ply:1,before,after,feedback:{label:'Mistake',summary:'',provisional:true}},DEFAULT_REVIEW_PREFERENCES);
    expect(practice.hidden).toBe(true);expect(why.hidden).toBe(true);expect(tools.start()).toBe(false);
    tools.update(move,{ply:1,before,after,feedback:{label:'Mistake',summary:''}},DEFAULT_REVIEW_PREFERENCES);
    expect(practice.hidden).toBe(false);expect(why.hidden).toBe(false);expect(tools.start()).toBe(true);
    tools.stop();tools.update(move,{ply:1,before,after,profile:'quick',feedback:{label:'Mistake',summary:''}},DEFAULT_REVIEW_PREFERENCES);
    expect(practice.hidden).toBe(true);expect(tools.start()).toBe(false);
});

it('keeps all learning levels available inside collapsed review options',()=>{
    const tools=new ReviewTools(),action=vi.fn();tools.onAction=action;
    const options=tools.element.querySelector<HTMLDetailsElement>('.review-options-disclosure')!;
    expect(options.open).toBe(false);
    const level=tools.element.querySelector<HTMLSelectElement>('[data-level]')!;
    for(const value of ['beginner','intermediate','advanced']){
        level.value=value;level.dispatchEvent(new Event('change'));
        expect(action).toHaveBeenLastCalledWith('preferences',expect.objectContaining({level:value}));
    }
});
