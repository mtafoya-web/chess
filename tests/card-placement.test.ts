// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CardPlacement, placementCollisions, rectanglesOverlap } from '../src/card-placement';
let placements: CardPlacement[], callbacks: (() => void)[];
const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} }) as DOMRect;
const bounds = (el: Element, get: () => DOMRect) => { el.getBoundingClientRect = get; };
beforeEach(() => {
    placements = []; callbacks = [];
    vi.stubGlobal('ResizeObserver', class { constructor(cb: () => void) { callbacks.push(cb); } observe() {} disconnect() {} });
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 1));
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
    vi.useFakeTimers();
});
afterEach(() => { placements.forEach(p => p.destroy()); document.body.replaceChildren(); document.body.removeAttribute('class'); vi.useRealTimers(); vi.unstubAllGlobals(); });
function fixture(width = 800) {
    vi.stubGlobal('innerWidth', width);
    document.body.innerHTML = '<main style="display:grid" class="analyse"><div class="analyse__board"><div id="board"></div></div><div class="analyse__tools" style="display:block;overflow:visible;max-height:none;position:static"><button id="native">Native tools</button></div><div class="analyse__controls"><button>Native navigation</button></div></main><footer><button>Footer control</button></footer>';
    const board = document.getElementById('board')!, main = document.querySelector('main')!, adjacent = document.querySelector<HTMLElement>('.analyse__tools')!;
    const host = document.createElement('div'); host.style.height = '200px';
    const placement = new CardPlacement(host); placements.push(placement);
    bounds(board, () => rect(0, 0, 500, 500));
    bounds(main, () => rect(0, 0, width, 600));
    bounds(document.querySelector('.analyse__controls')!, () => rect(0, 500, 500, 100));
    bounds(document.getElementById('native')!, () => rect(600, 0, 300, 100));
    bounds(document.querySelector('footer button')!, () => rect(0, 900, 300, 44));
    bounds(adjacent, () => rect(600, 0, 300, 500));
    bounds(placement.slot, () => rect(0, 600, Math.min(width, 560), 200));
    bounds(host, () => placement.slot.getBoundingClientRect());
    return { host, placement, board, main, adjacent };
}
it('allocates below the complete narrow board/control group, outside its fixed grid', () => {
    const { placement, board, main, host } = fixture(800); placement.attach(board, true);
    expect(placement.slot.parentElement).toBe(document.body); expect(main.nextElementSibling).toBe(placement.slot);
    expect(placement.slot.contains(host)).toBe(true);
    expect(placementCollisions(host)).toEqual([]);
    expect(placement.slot.style.position).toBe('relative'); expect(placement.slot.style.height).toBe('auto');
});
it('rejects adjacent columns whose measured height does not grow with reserved content', () => {
    const { placement, board, main, adjacent } = fixture(1400);
    bounds(placement.slot, () => placement.slot.parentElement === adjacent ? rect(600, 100, 300, 200) : rect(0, 600, 560, 200));
    placement.attach(board, true);
    expect(main.nextElementSibling).toBe(placement.slot);
    expect(placement.slot.style.minHeight).toBe('0px');
});
it('uses a growing adjacent column, then moves out when expanded content escapes its grid track', () => {
    const { placement, board, main, adjacent, host } = fixture(1400);
    let hostHeight = 200;
    const slotHeight = () => Math.max(hostHeight, Number.parseFloat(placement.slot.style.minHeight) || 0);
    bounds(placement.slot, () => placement.slot.parentElement === adjacent ? rect(600, 100, 300, slotHeight()) : rect(0, 600, 560, hostHeight));
    bounds(host, () => placement.slot.getBoundingClientRect());
    bounds(adjacent, () => rect(600, 0, 300, 100 + (placement.slot.parentElement === adjacent ? slotHeight() : 0)));
    placement.attach(board, true); expect(placement.slot.parentElement).toBe(adjacent);
    hostHeight = 700; callbacks[0](); vi.runAllTimers();
    expect(main.nextElementSibling).toBe(placement.slot); expect(placement.slot.parentElement).toBe(document.body);
});
it('uses measured adjacent room below the former 1000px cutoff', () => {
    const { placement, board, adjacent, host } = fixture(940);
    const slotHeight = () => Math.max(200, Number.parseFloat(placement.slot.style.minHeight) || 0);
    bounds(placement.slot, () => rect(600, 100, 300, slotHeight()));
    bounds(host, () => placement.slot.getBoundingClientRect());
    bounds(adjacent, () => rect(600, 0, 300, 100 + (placement.slot.parentElement === adjacent ? slotHeight() : 0)));
    placement.attach(board, true); expect(placement.slot.parentElement).toBe(adjacent);
});
it('reserves a reversible adjacent grid column around fixed native tools without shrinking the board', () => {
    const { placement, board, adjacent, host, main } = fixture(940);
    adjacent.style.maxHeight = '500px';
    const original = document.createElement.bind(document);
    const create = vi.spyOn(document, 'createElement').mockImplementation(((tag: string, options?: ElementCreationOptions) => {
        const element = original(tag, options);
        if (tag === 'div') bounds(element, () => rect(600, 0, 300, 500 + (element.contains(placement.slot) ? Math.max(200, Number.parseFloat(placement.slot.style.minHeight) || 0) + 12 : 0)));
        return element;
    }) as typeof document.createElement);
    bounds(main, () => rect(0, 0, 940, 900));
    bounds(placement.slot, () => rect(600, 512, 300, Math.max(200, Number.parseFloat(placement.slot.style.minHeight) || 0)));
    bounds(host, () => placement.slot.getBoundingClientRect());
    bounds(document.getElementById('native')!, () => rect(600, 212, 300, 100));
    placement.attach(board, true);
    const wrapper = document.querySelector('[data-kibitz-column]');
    expect(wrapper?.contains(placement.slot)).toBe(true); expect(wrapper?.contains(adjacent)).toBe(true);
    expect(adjacent.nextElementSibling).toBe(placement.slot);
    expect(board.getBoundingClientRect().width).toBe(500);
    placement.destroy(); expect(main.contains(adjacent)).toBe(true); expect(document.querySelector('[data-kibitz-column]')).toBeNull();
    create.mockRestore();
});
it('retries adjacent placement once after native layout settles following card growth', () => {
    const { placement, board, main, adjacent, host } = fixture(940);
    let hostHeight = 200, mainHeight = 600;
    const slotHeight = () => Math.max(hostHeight, Number.parseFloat(placement.slot.style.minHeight) || 0);
    bounds(main, () => rect(0, 0, 940, mainHeight));
    bounds(placement.slot, () => placement.slot.parentElement === adjacent ? rect(600, 100, 300, slotHeight()) : rect(0, mainHeight, 560, hostHeight));
    bounds(host, () => placement.slot.getBoundingClientRect());
    bounds(adjacent, () => rect(600, 0, 300, 100 + (placement.slot.parentElement === adjacent ? slotHeight() : 0)));
    placement.attach(board, true); expect(placement.slot.parentElement).toBe(adjacent);
    hostHeight = 700; callbacks[0](); vi.advanceTimersByTime(1);
    expect(placement.slot.parentElement).toBe(document.body);
    mainHeight = 1000; vi.runAllTimers(); expect(placement.slot.parentElement).toBe(adjacent);
    mainHeight = 600; callbacks[0](); vi.runAllTimers();
    expect(placement.slot.parentElement).toBe(document.body);
    const observer = new MutationObserver(() => {}); observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    callbacks[0](); vi.runAllTimers(); expect(observer.takeRecords()).toEqual([]); observer.disconnect();
});
it('does not repeatedly mutate an established slot and removes its owned allocation', () => {
    const { placement, board, host } = fixture(); placement.attach(board, true);
    const observer = new MutationObserver(() => {}); observer.observe(document.body, { subtree: true, childList: true, attributes: true });
    placement.attach(board, true); expect(observer.takeRecords()).toEqual([]);
    placement.destroy(); expect(host.isConnected).toBe(false); expect(document.querySelector('[data-kibitz-slot]')).toBeNull();
    placement.attach(board, true); expect(host.isConnected).toBe(false); observer.disconnect();
});
it('moves outside enclosing row/fixed layout wrappers and reattaches after board replacement', () => {
    const { placement, board, main } = fixture();
    const wrapper = document.createElement('div'); wrapper.style.cssText = 'display:flex;flex-direction:row'; main.before(wrapper); wrapper.append(main);
    placement.attach(board, true); expect(wrapper.nextElementSibling).toBe(placement.slot);
    const replacement = document.createElement('div'), newMain = document.createElement('main'); newMain.style.display = 'grid'; newMain.append(replacement); document.body.append(newMain);
    bounds(replacement, () => rect(0, 1000, 400, 400)); placement.attach(replacement, true);
    expect(newMain.nextElementSibling).toBe(placement.slot);
});
it('reports real control intersections while allowing touching edges and empty geometry', () => {
    expect(rectanglesOverlap(rect(0, 0, 100, 100), rect(100, 0, 100, 100))).toBe(false);
    expect(rectanglesOverlap(rect(0, 0, 100, 100), rect(90, 90, 100, 100))).toBe(true);
    expect(rectanglesOverlap(rect(0, 0, 0, 100), rect(0, 0, 100, 100))).toBe(false);
    const { placement, board, host } = fixture(); placement.attach(board, true);
    const control = document.getElementById('native')!; bounds(control, () => rect(0, 650, 100, 44));
    expect(placementCollisions(host)).toContain(control);
});
it('keeps the allocation inside BODY when Chess.com puts board-layout on BODY', () => {
    const { placement, board, main } = fixture(800);
    const layout = document.createElement('div'); layout.className = 'board-layout-main'; layout.style.display = 'grid';
    bounds(layout, () => main.getBoundingClientRect());
    main.replaceWith(layout); while (main.firstChild) layout.append(main.firstChild);
    document.body.className = 'board-layout';
    placement.attach(board, false);
    expect(placement.slot.parentElement).toBe(document.body);
    expect(document.body.contains(placement.slot)).toBe(true);
    expect([...document.documentElement.children].every(child => child === document.head || child === document.body)).toBe(true);
    const replacement = document.createElement('div'), nextLayout = document.createElement('div');
    nextLayout.className = 'board-layout-main'; nextLayout.append(replacement); document.body.append(nextLayout);
    bounds(replacement, () => rect(0, 1000, 400, 400));
    placement.attach(replacement, false);
    expect(document.body.lastElementChild).toBe(placement.slot);
});

it('detects notation and evaluation intersections even when they contain no buttons', () => {
    const {placement,board,host} = fixture(); placement.attach(board,true);
    for (const className of ['move-list','evaluation-bar','tview2','round__moves']) {
        const native = document.createElement('div'); native.className = className;
        document.body.append(native); bounds(native,()=>rect(0,650,200,60));
        expect(placementCollisions(host)).toContain(native); native.remove();
    }
});
it('rechecks sticky native widgets on scroll and moves guidance into safe flow', () => {
    const {placement,board,main,adjacent,host} = fixture(940);
    const slotHeight = () => Math.max(200,Number.parseFloat(placement.slot.style.minHeight)||0);
    bounds(placement.slot,()=>placement.slot.parentElement===adjacent?rect(600,100,300,slotHeight()):rect(0,600,560,200));
    bounds(host,()=>placement.slot.getBoundingClientRect());
    bounds(adjacent,()=>rect(600,0,300,100+(placement.slot.parentElement===adjacent?slotHeight():0)));
    placement.attach(board,true); expect(placement.slot.parentElement).toBe(adjacent);
    const bar=document.createElement('div');bar.className='evaluation-bar';adjacent.append(bar);
    bounds(bar,()=>rect(600,150,30,200));
    window.dispatchEvent(new Event('scroll'));vi.runAllTimers();
    expect(main.nextElementSibling).toBe(placement.slot);
    expect(placementCollisions(host)).toEqual([]);
});
