import { beforeEach, expect, it, vi } from 'vitest';
import { ReviewLibrary } from '../src/review-library';
import { sessionFromMoves } from '../src/review-session';
import { DEFAULT_REVIEW_PREFERENCES } from '../src/review-scoring';
import { evaluation } from '../src/chess';
import type { ReviewState } from '../src/review-model';
import { Chess } from 'chess.js';
let storage:Record<string,unknown>;
const state=(index=0):ReviewState=>{
    const fen=new Chess().fen().replace(' 0 1',` 0 ${index+1}`);
    return {session:sessionFromMoves(['e4'],fen),assessments:[{ply:1,before:evaluation([]),after:evaluation([]),feedback:{label:'Good',summary:'Sound.'}}],preferences:{...DEFAULT_REVIEW_PREFERENCES},running:true,practicePly:1,updatedAt:Date.now(),attempts:[]};
};
beforeEach(()=>{storage={};vi.stubGlobal('chrome',{storage:{local:{get:async()=>structuredClone(storage),set:async(v:object)=>{storage={...storage,...structuredClone(v)};}}}});});
it('serializes concurrent saves, restores by game history, and strips transient exercise state',async()=>{
    const library=new ReviewLibrary();await Promise.all([library.save(state()),library.save(state(1))]);
    const entries=await library.list();expect(entries).toHaveLength(2);expect(entries[0].practicePly).toBeUndefined();
    const session=state().session;session.id='fresh';const restored=await library.open(session);
    expect(restored.session.id).toBe('fresh');expect(restored.assessments).toHaveLength(1);expect(restored.running).toBe(false);
    const another=await library.open(sessionFromMoves(['d4']));expect(another.assessments).toHaveLength(0);
});
it('bounds games and exercise records, including a completely exhausted attempt budget',async()=>{
    const library=new ReviewLibrary(),first=state();first.attempts=Array.from({length:500},()=>({ply:1,outcome:'missed' as const,at:1}));
    await library.save(first);const second=state(1);second.attempts=[{ply:1,outcome:'solved',at:2}];await library.save(second);
    const entries=await library.list();expect(entries.reduce((n,e)=>n+e.attempts.length,0)).toBe(500);
    for(let i=2;i<52;i++)await library.save(state(i));expect(await library.list()).toHaveLength(50);
});
it('rejects damaged or incompatible records and supports per-game and complete deletion',async()=>{
    const library=new ReviewLibrary();await library.save(state());await library.save(state(1));
    const entries=await library.list();
    storage.reviewLibraryV2=[...entries,{...entries[0],version:1},{...entries[0],assessments:[{ply:3000}]},{...entries[0],preferences:null}];
    expect(await library.list()).toHaveLength(2);
    await library.remove(entries[0].key);expect(await library.list()).toHaveLength(1);await library.remove();expect(await library.list()).toEqual([]);
});
it('keeps deleted history deleted across worker restarts until explicitly reviewed again',async()=>{
    const first=new ReviewLibrary(),review=state();await first.save(review);
    const key=(await first.list())[0].key;await first.remove(key);
    const restarted=new ReviewLibrary();await restarted.save(review);expect(await restarted.list()).toEqual([]);
    await restarted.allow(review.session);await restarted.save(review);expect(await restarted.list()).toHaveLength(1);
});
