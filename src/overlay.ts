import { squareCenter, validOverlayMove, type Orientation, type OverlayLayers } from './overlay-model';
export { candidateHeatmap, candidateArrows, rankedCandidates, type HeatCell, type OverlayArrow, type OverlayLayers, type MoveMarker } from './overlay-model';
const NS = 'http://www.w3.org/2000/svg';
/** Clip the overlay to every scrolling/clipping ancestor, as native board pieces are. */
export function overlayClip(board: HTMLElement, rect = board.getBoundingClientRect()) {
    const boardStyle = getComputedStyle(board);
    if (boardStyle.visibility === 'hidden' || boardStyle.visibility === 'collapse' || boardStyle.opacity === '0') return { visible: false, inset: '0px 0px 0px 0px' };
    let left = Math.max(0, rect.left), top = Math.max(0, rect.top);
    let right = Math.min(document.documentElement.clientWidth || innerWidth, rect.right ?? rect.left + rect.width);
    let bottom = Math.min(document.documentElement.clientHeight || innerHeight, rect.bottom ?? rect.top + rect.height);
    for (let ancestor = board.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor), bounds = ancestor.getBoundingClientRect();
        if (style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0') return { visible: false, inset: '0px 0px 0px 0px' };
        const clips = (value: string) => /^(hidden|clip|scroll|auto)$/.test(value);
        const paintContainment = /\b(paint|strict|content)\b/.test(style.contain);
        if (paintContainment || clips(style.overflowX || style.overflow)) {
            left = Math.max(left, bounds.left + ancestor.clientLeft);
            right = Math.min(right, bounds.left + ancestor.clientLeft + (ancestor.clientWidth || bounds.width));
        }
        if (paintContainment || clips(style.overflowY || style.overflow)) {
            top = Math.max(top, bounds.top + ancestor.clientTop);
            bottom = Math.min(bottom, bounds.top + ancestor.clientTop + (ancestor.clientHeight || bounds.height));
        }
    }
    return { visible: right > left && bottom > top,
        inset: `${Math.max(0, top - rect.top)}px ${Math.max(0, rect.left + rect.width - right)}px ${Math.max(0, rect.top + rect.height - bottom)}px ${Math.max(0, left - rect.left)}px` };
}
export class Overlay {
    readonly svg = document.createElementNS(NS, 'svg');
    private board?: HTMLElement;
    private orientation: Orientation = 'white';
    private layers: OverlayLayers = {};
    private frame?: number;
    private destroyed = false;
    private schedule = () => {
        if (this.destroyed || this.frame !== undefined) return;
        this.frame = requestAnimationFrame(() => { this.frame = undefined; this.draw(); });
    };
    private resize = new ResizeObserver(this.schedule);
    constructor(id = 'kibitz-overlay') {
        this.svg.id = id;
        this.svg.setAttribute('aria-hidden', 'true');
        this.svg.setAttribute('viewBox', '0 0 800 800');
        this.svg.setAttribute('preserveAspectRatio', 'none');
        this.svg.style.cssText = 'position:fixed;pointer-events:none;z-index:50;overflow:hidden;display:none';
        document.documentElement.append(this.svg);
        window.addEventListener('scroll', this.schedule, { passive: true, capture: true });
        window.addEventListener('resize', this.schedule, { passive: true });
    }
    set(board: HTMLElement, orientation: Orientation, moves: string[]) {
        this.setLayers(board, orientation, { arrows: moves.map((uci, i) => ({ uci, kind: i ? 'alternative' : 'best' })) });
    }
    setLayers(board: HTMLElement, orientation: Orientation, layers: OverlayLayers) {
        if (this.destroyed) return;
        if (this.board !== board) { this.resize.disconnect(); this.resize.observe(board); }
        this.board = board; this.orientation = orientation; this.layers = layers; this.draw();
    }
    clear() {
        this.layers = {}; this.resize.disconnect(); this.board = undefined;
        if (this.frame !== undefined) { cancelAnimationFrame(this.frame); this.frame = undefined; }
        this.svg.replaceChildren(); this.svg.style.display = 'none';
    }
    destroy() {
        this.clear(); this.destroyed = true;
        window.removeEventListener('scroll', this.schedule, true);
        window.removeEventListener('resize', this.schedule);
        this.svg.remove();
    }
    private draw() {
        const rect = this.board?.getBoundingClientRect();
        this.svg.replaceChildren();
        if (!rect || !this.board?.isConnected || rect.width <= 0 || rect.height <= 0) { this.svg.style.display = 'none'; return; }
        const clip = overlayClip(this.board, rect);
        if (!clip.visible) { this.svg.style.display = 'none'; return; }
        Object.assign(this.svg.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, clipPath: `inset(${clip.inset})` });
        const labels = new Map<string, Set<number>>();
        for (const cue of this.layers.reviewCues ?? []) {
            const center = squareCenter(cue.square, this.orientation); if (!center) continue;
            const [x,y]=center, group=document.createElementNS(NS,'g');
            group.dataset.reviewCue=cue.kind; group.dataset.square=cue.square;
            const tile=document.createElementNS(NS,'rect');
            tile.setAttribute('x',String(x-46)); tile.setAttribute('y',String(y-46));
            tile.setAttribute('width','92'); tile.setAttribute('height','92'); tile.setAttribute('rx','8');
            tile.setAttribute('fill',cue.kind==='consequence'?'none':cue.grade==='inaccuracy'?'#d3a52d':'#c9454d');
            tile.setAttribute('fill-opacity',cue.kind==='origin'?'.1':'.2');
            tile.setAttribute('stroke',cue.kind==='consequence'?'#f0b342':cue.grade==='inaccuracy'?'#a4750d':'#b63c42');
            tile.setAttribute('stroke-width',cue.kind==='consequence'?'7':'5');
            if(cue.kind!=='destination')tile.setAttribute('stroke-dasharray',cue.kind==='consequence'?'5 7':'14 8');
            const title=document.createElementNS(NS,'title'); title.textContent=cue.label;
            group.append(title,tile); this.svg.append(group);
        }
        for (const cell of this.layers.heatmap ?? []) {
            const center = squareCenter(cell.square, this.orientation);
            if (!center || !Number.isFinite(cell.rank) || cell.rank < 1) continue;
            const [x, y] = center;
            const group = document.createElementNS(NS, 'g'); group.dataset.square = cell.square;
            const tile = document.createElementNS(NS, 'rect');
            tile.setAttribute('x', String(x - 50)); tile.setAttribute('y', String(y - 50));
            tile.setAttribute('width', '100'); tile.setAttribute('height', '100');
            tile.setAttribute('fill', cell.rank === 1 ? '#57ad72' : '#e2b457'); tile.setAttribute('fill-opacity', '.28');
            tile.setAttribute('stroke', cell.rank === 1 ? '#36834d' : '#9b7223'); tile.setAttribute('stroke-width', '4');
            if (cell.rank !== 1) tile.setAttribute('stroke-dasharray', '10 6');
            const ranks = labels.get(cell.square) ?? new Set<number>();
            for (const rank of cell.ranks ?? [cell.rank]) if (Number.isInteger(rank) && rank > 0) ranks.add(rank);
            labels.set(cell.square, ranks);
            const title = document.createElementNS(NS, 'title'); title.textContent = cell.label;
            group.append(title, tile); this.svg.append(group);
        }
        const arrows = [...(this.layers.arrows ?? [])].sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0));
        for (const arrow of arrows) {
            if (!validOverlayMove(arrow.uci)) continue;
            const [x1, y1] = squareCenter(arrow.uci.slice(0, 2), this.orientation)!;
            const [x2, y2] = squareCenter(arrow.uci.slice(2, 4), this.orientation)!;
            const angle = Math.atan2(y2 - y1, x2 - x1), c = Math.cos(angle), s = Math.sin(angle);
            const color = arrow.kind === 'best' ? '#77a94c' : arrow.kind === 'played' ? '#5d99e5' : '#d5a54b';
            const path = document.createElementNS(NS, 'path');
            path.setAttribute('d', `M ${x1} ${y1} L ${x2 - c * 22} ${y2 - s * 22}`);
            path.setAttribute('stroke', color); path.setAttribute('stroke-width', arrow.rank === 1 || !arrow.rank ? '13' : '9'); path.setAttribute('stroke-linecap', 'round');
            if (arrow.rank && arrow.rank > 1) path.setAttribute('stroke-dasharray', arrow.rank === 2 ? '20 8' : '7 9');
            const head = document.createElementNS(NS, 'path');
            head.setAttribute('d', `M ${x2} ${y2} L ${x2 - c * 37 - s * 20} ${y2 - s * 37 + c * 20} L ${x2 - c * 37 + s * 20} ${y2 - s * 37 - c * 20} Z`);
            head.setAttribute('fill', color);
            for (const el of [path, head]) { el.setAttribute('opacity', arrow.kind === 'alternative' ? '.5' : '.78'); this.svg.append(el); }
        }
        // Combine ranks sharing a destination (including different promotion choices).
        for (const arrow of arrows) if (arrow.rank && validOverlayMove(arrow.uci)) {
            const square = arrow.uci.slice(2, 4);
            const ranks = labels.get(square) ?? new Set<number>();
            ranks.add(arrow.rank); labels.set(square, ranks);
        }
        for (const [square, values] of labels) {
            const ranks = [...values].sort((a, b) => a - b);
            const [x, y] = squareCenter(square, this.orientation)!;
            const label = document.createElementNS(NS, 'text');
            label.dataset.candidateRanks = ranks.join(',');
            label.dataset.destination = square;
            label.setAttribute('x', String(x + 29)); label.setAttribute('y', String(y + 35));
            label.setAttribute('text-anchor', 'middle'); label.setAttribute('font-size', '23');
            label.setAttribute('font-weight', '700'); label.setAttribute('fill', '#fff');
            label.setAttribute('stroke', '#222'); label.setAttribute('stroke-width', '5'); label.setAttribute('paint-order', 'stroke');
            label.textContent = ranks.join('/'); this.svg.append(label);
        }
        const marker = this.layers.marker, center = marker && squareCenter(marker.square, this.orientation);
        if (marker && center) {
            const [x, y] = center, group = document.createElementNS(NS, 'g');
            group.dataset.marker = marker.square;
            const badge = document.createElementNS(NS, 'circle');
            badge.setAttribute('cx', String(x + 28)); badge.setAttribute('cy', String(y - 28)); badge.setAttribute('r', '19');
            badge.setAttribute('fill', marker.grade === 'blunder' || marker.grade === 'mistake' ? '#b63c42' : marker.grade === 'inaccuracy' ? '#996500' : '#326d4d');
            badge.setAttribute('stroke', '#fff'); badge.setAttribute('stroke-width', '3');
            const text = document.createElementNS(NS, 'text');
            text.setAttribute('x', String(x + 28)); text.setAttribute('y', String(y - 20)); text.setAttribute('text-anchor', 'middle');
            text.setAttribute('font-size', '22'); text.setAttribute('font-weight', '700'); text.setAttribute('fill', '#fff');
            text.textContent = marker.grade === 'blunder' ? '??' : marker.grade === 'mistake' ? '?' : marker.grade === 'inaccuracy' ? '?!' : marker.grade === 'missed-mate' ? 'M?' : marker.grade === 'unknown' ? '·' : '✓';
            const title = document.createElementNS(NS, 'title'); title.textContent = marker.label;
            group.append(title, badge, text); this.svg.append(group);
        }
        this.svg.style.display = this.svg.childElementCount ? 'block' : 'none';
    }
}
