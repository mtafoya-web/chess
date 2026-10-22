// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Overlay } from '../src/overlay';
import { candidateHeatmap, candidateArrows, rankedCandidates, squareCenter } from '../src/overlay-model';
import { Chess } from 'chess.js';
import type { Candidate } from '../src/types';
const candidate = (uci: string, score: number, mate?: number): Candidate => ({ uci, san: uci, pv: uci, score, ...(mate === undefined ? {} : { mate }) });
let resizeCallbacks: (() => void)[], overlays: Overlay[];
const disconnect = vi.fn();
beforeEach(() => {
    resizeCallbacks = []; overlays = []; disconnect.mockClear();
    vi.stubGlobal('ResizeObserver', class {
        constructor(callback: () => void) { resizeCallbacks.push(callback); }
        observe = vi.fn(); disconnect = disconnect;
    });
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => setTimeout(() => callback(0), 1)));
    vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => clearTimeout(id)));
    vi.useFakeTimers();
});
afterEach(() => { overlays.forEach(o => o.destroy()); document.body.replaceChildren(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function setup() {
    const board = document.createElement('div'); document.body.append(board);
    board.getBoundingClientRect = () => ({ left: 20, top: 30, width: 400, height: 400 } as DOMRect);
    const overlay = new Overlay(); overlays.push(overlay); return { board, overlay };
}
it('maps corners and middle squares in both board orientations', () => {
    expect(squareCenter('a1', 'white')).toEqual([50, 750]);
    expect(squareCenter('h8', 'white')).toEqual([750, 50]);
    expect(squareCenter('a1', 'black')).toEqual([750, 50]);
    expect(squareCenter('h8', 'black')).toEqual([50, 750]);
    expect(squareCenter('e4', 'white')).toEqual([450, 450]);
    expect(squareCenter('a9', 'white')).toBeUndefined();
});
it('renders review origins, destinations and consequences without candidate numbers or arrows',()=>{
    const {board,overlay}=setup();
    for(const orientation of ['white','black'] as const){
        overlay.setLayers(board,orientation,{reviewCues:[{square:'g2',kind:'origin',grade:'blunder',label:'Origin'},{square:'g4',kind:'destination',grade:'blunder',label:'Blunder destination'},{square:'e1',kind:'consequence',grade:'blunder',label:'King faces mate'}],marker:{square:'g4',grade:'blunder',label:'Blunder'}});
        expect(overlay.svg.querySelectorAll('[data-review-cue]')).toHaveLength(3);
        expect(overlay.svg.querySelector('[data-review-cue=consequence] title')?.textContent).toBe('King faces mate');
        expect(overlay.svg.querySelector('[data-marker] text')?.textContent).toBe('??');
        expect(overlay.svg.querySelectorAll('path,[data-candidate-ranks]')).toHaveLength(0);
        expect(overlay.svg.style.pointerEvents).toBe('none');
        expect(overlay.svg.querySelector('[data-review-cue=origin] rect')?.getAttribute('x')).toBe(orientation==='white'?'604':'104');
    }
    overlay.clear();expect(overlay.svg.childElementCount).toBe(0);
});
it('shares legal distinct top-three ranking between arrows and heatmap', () => {
    const fen = new Chess().fen();
    const candidates = [candidate('e2e4', .3), candidate('a1a8', 100), candidate('d2d4', .5), candidate('e2e4', .9), candidate('g1f3', .4), candidate('b1c3', .1)];
    const ranked = rankedCandidates(candidates, 'w', fen);
    expect(ranked.map(c => c.uci)).toEqual(['d2d4', 'g1f3', 'e2e4']);
    expect(candidateArrows(candidates, fen).map(a => a.rank)).toEqual([1, 2, 3]);
    expect(candidateHeatmap(ranked, 'w').map(c => c.rank)).toEqual([1, 2, 3]);
    expect(candidateArrows(candidates, 'bad fen')).toEqual([]);
});
it('honors typed mate winner and distance while ranking alternatives', () => {
    const losing = { ...candidate('e2e4', 100), engineScore: { kind: 'mate' as const, winner: 'b' as const, moves: 2 } };
    const winning = { ...candidate('d2d4', -100), engineScore: { kind: 'mate' as const, winner: 'w' as const, moves: 3 } };
    expect(rankedCandidates([losing, candidate('g1f3', .5), winning], 'w').map(c => c.uci)).toEqual(['d2d4', 'g1f3', 'e2e4']);
    const heatmap = candidateHeatmap([losing, winning], 'w');
    expect(heatmap[0]).toMatchObject({ rank: 1, mate: 3 });
    expect(heatmap[1].label).toContain('-M2');
    expect(heatmap.every(cell => cell.loss === undefined)).toBe(true);
});
it('draws lower ranks first and combines shared promotion endpoints', () => {
    const { board, overlay } = setup();
    overlay.setLayers(board, 'white', { arrows: [{ uci: 'a7a8q', kind: 'best', rank: 1 }, { uci: 'a7a8n', kind: 'alternative', rank: 2 }, { uci: 'h7h8q', kind: 'alternative', rank: 3 }] });
    const paths = overlay.svg.querySelectorAll('path');
    expect(paths).toHaveLength(6);
    expect(paths[0].getAttribute('stroke-dasharray')).toBe('7 9');
    expect(paths[4].getAttribute('stroke-width')).toBe('13');
    expect(overlay.svg.querySelector('[data-candidate-ranks="1,2"]')?.textContent).toBe('1/2');
    expect(overlay.svg.style.pointerEvents).toBe('none');
});
it('only maps searched destinations and uses the strongest duplicate destination', () => {
    const cells = candidateHeatmap([candidate('e2e4', .4), candidate('d2d4', .2), candidate('e3e4', .7)], 'w');
    expect(cells.map(c => c.square)).toEqual(['e4', 'd4']);
    expect(cells[0]).toMatchObject({ rank: 1, score: .7, loss: 0 });
    expect(cells[1].loss).toBeCloseTo(.5);
    expect(cells[0].label).toContain('White');
    expect(candidateHeatmap([], 'w')).toEqual([]);
    expect(candidateHeatmap([candidate('bad', 1)], 'w')).toEqual([]);
});
it('ranks Black candidates from Black perspective and keeps mate loss nonnumeric', () => {
    const cells = candidateHeatmap([candidate('e7e5', -.3), candidate('d7d5', -.8)], 'b');
    expect(cells[0].square).toBe('d5'); expect(cells[1].loss).toBeCloseTo(.5);
    const mates = candidateHeatmap([candidate('e7e5', -100, -5), candidate('d7d5', -100, -2), candidate('c7c5', -1)], 'b');
    expect(mates[0].square).toBe('d5'); expect(mates.every(c => c.loss === undefined)).toBe(true);
    const losing = candidateHeatmap([candidate('e2e4', -100, -2), candidate('d2d4', -100, -8)], 'w');
    expect(losing[0].square).toBe('d4');
});
it('renders independent heatmaps and arrows and keeps legacy arrow counts', () => {
    const { board, overlay } = setup();
    overlay.set(board, 'white', ['e2e4', 'd2d4']);
    expect(overlay.svg.querySelectorAll('path')).toHaveLength(4);
    expect(overlay.svg.style.pointerEvents).toBe('none'); expect(overlay.svg.getAttribute('aria-hidden')).toBe('true');
    const cells = candidateHeatmap([candidate('e2e4', .3)], 'w');
    overlay.setLayers(board, 'white', { heatmap: cells });
    expect(overlay.svg.querySelectorAll('rect')).toHaveLength(1);
    expect(overlay.svg.querySelectorAll('path')).toHaveLength(0);
    expect(overlay.svg.querySelector('rect')?.getAttribute('x')).toBe('400');
    overlay.setLayers(board, 'black', { heatmap: cells, arrows: [{ uci: 'e2e4', kind: 'played' }] });
    expect(overlay.svg.querySelector('rect')?.getAttribute('x')).toBe('300');
    expect(overlay.svg.querySelectorAll('path')).toHaveLength(2);
    overlay.setLayers(board, 'white', {}); expect(overlay.svg.style.display).toBe('none');
});
it('numbers a destination once with either overlay or both, including shared promotions', () => {
    const { board, overlay } = setup();
    const candidates = [candidate('a7a8q', .5), candidate('a7a8n', .3)];
    const heatmap = candidateHeatmap(candidates, 'w');
    const arrows = candidates.map((c, i) => ({uci:c.uci,kind:'best' as const,rank:i+1}));
    for (const layers of [{heatmap}, {arrows}, {heatmap,arrows}]) {
        overlay.setLayers(board, 'white', layers);
        expect(overlay.svg.querySelectorAll('text')).toHaveLength(1);
        expect(overlay.svg.querySelector('[data-destination="a8"]')?.textContent).toBe('1/2');
        overlay.setLayers(board, 'black', layers);
        expect(overlay.svg.querySelectorAll('text')).toHaveLength(1);
    }
});
it('coalesces scroll and resize, follows replacement boards and hides disconnected boards', () => {
    const { board, overlay } = setup(); overlay.set(board, 'white', ['e2e4']);
    board.getBoundingClientRect = () => ({ left: 60, top: -30, width: 240, height: 240 } as DOMRect);
    window.dispatchEvent(new Event('scroll')); window.dispatchEvent(new Event('resize')); resizeCallbacks[0]();
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1); vi.runAllTimers();
    expect(overlay.svg.style.left).toBe('60px'); expect(overlay.svg.style.width).toBe('240px');
    const replacement = document.createElement('div'); document.body.append(replacement);
    replacement.getBoundingClientRect = () => ({ left: 10, top: 10, width: 200, height: 200 } as DOMRect);
    overlay.set(replacement, 'white', ['e2e4']); expect(overlay.svg.style.width).toBe('200px');
    replacement.remove(); window.dispatchEvent(new Event('resize')); vi.runAllTimers(); expect(overlay.svg.style.display).toBe('none');
});
it('clears pending work, cleans listeners and supports distinct overlay instances', () => {
    const { board, overlay } = setup(); const other = new Overlay('kibitz-review-overlay'); overlays.push(other);
    expect(other.svg.id).not.toBe(overlay.svg.id);
    overlay.set(board, 'white', ['e2e4']); window.dispatchEvent(new Event('scroll')); overlay.clear(); vi.runAllTimers();
    expect(overlay.svg.childElementCount).toBe(0); expect(overlay.svg.style.display).toBe('none');
    overlay.destroy(); other.destroy(); vi.mocked(requestAnimationFrame).mockClear();
    window.dispatchEvent(new Event('resize')); window.dispatchEvent(new Event('scroll'));
    expect(requestAnimationFrame).not.toHaveBeenCalled(); expect(overlay.svg.isConnected).toBe(false);
    overlay.set(board, 'white', ['e2e4']); expect(overlay.svg.isConnected).toBe(false);
});
it('rejects malformed geometry and moves, and clears zero-sized boards', () => {
    const { board, overlay } = setup();
    overlay.setLayers(board, 'white', {
        arrows: [{ uci: 'e2e2', kind: 'best' }, { uci: 'bad', kind: 'alternative' }],
        heatmap: [{ square: 'z9', rank: 1, label: 'invalid', score: 0 }],
    });
    expect(overlay.svg.childElementCount).toBe(0); expect(overlay.svg.style.display).toBe('none');
    overlay.set(board, 'white', ['e2e4']);
    board.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 0 } as DOMRect);
    resizeCallbacks[0](); vi.runAllTimers();
    expect(overlay.svg.childElementCount).toBe(0); expect(overlay.svg.style.display).toBe('none');
});
it('clips every layer to scrolling ancestors and viewport without changing square coordinates', () => {
    const { board, overlay } = setup();
    const wrapper = document.createElement('section'); wrapper.style.overflow = 'hidden'; board.before(wrapper); wrapper.append(board);
    wrapper.getBoundingClientRect = () => ({ left: 50, top: 70, width: 240, height: 200 } as DOMRect);
    overlay.setLayers(board, 'white', { arrows: [{ uci: 'e2e4', kind: 'best' }],
        marker: { square: 'e4', grade: 'blunder', label: 'Blunder: e4' } });
    expect(overlay.svg.style.clipPath).toBe('inset(40px 130px 160px 30px)');
    expect(overlay.svg.querySelector('[data-marker="e4"] circle')?.getAttribute('cx')).toBe('478');
    expect(overlay.svg.querySelector('[data-marker="e4"] title')?.textContent).toBe('Blunder: e4');
    expect(overlay.svg.querySelector('path')?.getAttribute('d')).toContain('M 450 650');
    wrapper.getBoundingClientRect = () => ({ left: 500, top: 500, width: 100, height: 100 } as DOMRect);
    window.dispatchEvent(new Event('scroll')); vi.runAllTimers(); expect(overlay.svg.style.display).toBe('none');
});
it('clips boards above the viewport and rotates move markers with board orientation', () => {
    const { board, overlay } = setup();
    board.getBoundingClientRect = () => ({ left: -20, top: -80, width: 400, height: 400 } as DOMRect);
    overlay.setLayers(board, 'black', { marker: { square: 'a1', grade: 'good', label: 'Good move' } });
    expect(overlay.svg.style.clipPath).toBe('inset(80px 0px 0px 20px)');
    expect(overlay.svg.querySelector('circle')?.getAttribute('cx')).toBe('778');
    expect(overlay.svg.querySelector('circle')?.getAttribute('cy')).toBe('22');
});
it('respects paint containment and hides layers with hidden native boards', () => {
    const { board, overlay } = setup();
    const wrapper = document.createElement('section'); wrapper.style.contain = 'paint'; board.before(wrapper); wrapper.append(board);
    wrapper.getBoundingClientRect = () => ({ left: 20, top: 30, width: 200, height: 200 } as DOMRect);
    overlay.set(board, 'white', ['e2e4']); expect(overlay.svg.style.clipPath).toBe('inset(0px 200px 200px 0px)');
    wrapper.style.visibility = 'hidden'; overlay.set(board, 'white', ['e2e4']); expect(overlay.svg.style.display).toBe('none');
    wrapper.style.visibility = 'visible'; board.style.opacity = '0'; overlay.set(board, 'white', ['e2e4']); expect(overlay.svg.style.display).toBe('none');
});
