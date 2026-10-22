/** A normal-flow allocation owned by Kibitz; never put guidance into a board's grid row. */
export class CardPlacement {
    readonly slot = document.createElement('div');
    private board?: HTMLElement;
    private adjacent?: HTMLElement;
    private reservation?: { wrapper: HTMLElement; candidate: HTMLElement };
    private viewport = -1;
    private frame?: number;
    private retryFrame?: number;
    private retryUsed = false;
    private retryRequested = false;
    private lichess = false;
    private destroyed = false;
    private resize = new ResizeObserver(() => {
        if (this.frame !== undefined || this.destroyed) return;
        this.frame = requestAnimationFrame(() => {
            this.frame = undefined;
            if (this.board?.isConnected && this.slot.isConnected) this.validate();
        });
    });
    constructor(private readonly host: HTMLElement) {
        this.slot.dataset.kibitzSlot = '';
        this.slot.style.cssText = 'display:flow-root;position:relative;box-sizing:border-box;width:100%;min-width:0;max-width:100%;height:auto;flex:0 0 auto;grid-column:1 / -1;clear:both;';
        this.resize.observe(host);
    }
    attach(board: HTMLElement, lichess: boolean) {
        if (this.destroyed || !board.isConnected) return;
        const viewport = document.documentElement.clientWidth || innerWidth;
        const layoutChanged = this.board !== board || this.viewport !== viewport || !this.slot.isConnected;
        const changed = layoutChanged || this.retryRequested;
        if (layoutChanged) this.retryUsed = false;
        this.retryRequested = false;
        this.board = board; this.viewport = viewport; this.lichess = lichess;
        if (this.host.parentElement !== this.slot) this.slot.append(this.host);
        if (!changed) { this.validate(); return; }
        this.releaseReservation();
        this.adjacent = undefined;
        {
            const candidates = document.querySelectorAll<HTMLElement>(lichess ? '.analyse__tools' : '.analysis-sidebar, .sidebar-component');
            for (const candidate of candidates) {
                if (!this.canTryAdjacent(candidate, board)) continue;
                candidate.append(this.slot);
                const card = this.host.getBoundingClientRect(), boardRect = board.getBoundingClientRect();
                if (card.top < boardRect.bottom && card.bottom > boardRect.top && !rectanglesOverlap(card, boardRect)
                    && this.provesGrowth(candidate) && this.isAllocated() && !placementCollisions(this.host).length) {
                    this.adjacent = candidate; return;
                }
            }
            // Fixed-height site tool panes cannot safely contain an extra card.
            // Reserve a separate, reversible column around that pane instead.
            for (const candidate of candidates) {
                if (this.reserveBeside(candidate, board)) return;
            }
        }
        this.placeBelow();
    }
    private reserveBeside(candidate: HTMLElement, board: HTMLElement): boolean {
        if (candidate.contains(board) || !candidate.parentElement || candidate.parentElement === document.body) return false;
        const before = board.getBoundingClientRect(), rect = candidate.getBoundingClientRect(), style = getComputedStyle(candidate);
        const parentStyle = getComputedStyle(candidate.parentElement);
        if (rect.width < 260 || rect.left < 0 || rect.right > this.viewport || rect.left < before.right - 1 && rect.right > before.left + 1
            || !/grid/.test(parentStyle.display) || /^(absolute|fixed)$/.test(style.position)) return false;
        const wrapper = document.createElement('div');
        wrapper.dataset.kibitzColumn = '';
        wrapper.style.cssText = 'display:flex;flex-direction:column;gap:12px;min-width:0;align-self:start;position:relative;';
        wrapper.style.gridArea = style.gridArea;
        candidate.before(wrapper); wrapper.append(this.slot, candidate);
        this.reservation = { wrapper, candidate };
        const after = board.getBoundingClientRect(), card = this.host.getBoundingClientRect();
        if (Math.abs(before.width - after.width) <= 1 && Math.abs(before.height - after.height) <= 1
            && card.top < before.bottom && card.bottom > before.top && !rectanglesOverlap(card, after)
            && this.provesGrowth(wrapper) && this.isAllocated() && !placementCollisions(this.host).length) {
            this.adjacent = wrapper; return true;
        }
        this.releaseReservation(); return false;
    }
    private releaseReservation() {
        if (!this.reservation) return;
        const { wrapper, candidate } = this.reservation;
        if (wrapper.parentElement) wrapper.before(candidate);
        if (wrapper.contains(this.slot)) wrapper.before(this.slot);
        wrapper.remove(); this.reservation = undefined;
    }
    private canTryAdjacent(candidate: HTMLElement, board: HTMLElement) {
        if (candidate.contains(board) || candidate === this.slot || this.host.contains(candidate)) return false;
        const rect = candidate.getBoundingClientRect(), boardRect = board.getBoundingClientRect(), style = getComputedStyle(candidate);
        return rect.width >= 260 && rect.left >= 0 && rect.right <= this.viewport
            && (rect.left >= boardRect.right || rect.right <= boardRect.left)
            && /^(block|flow-root|flex)$/.test(style.display)
            && (style.display !== 'flex' || style.flexDirection === 'column')
            && !/^(absolute|fixed|sticky)$/.test(style.position)
            && !/(hidden|clip|scroll|auto)/.test(`${style.overflow} ${style.overflowY}`)
            && (!style.maxHeight || style.maxHeight === 'none');
    }
    /** Measured growth distinguishes an auto-height column from a fixed grid track. */
    private provesGrowth(candidate: HTMLElement) {
        const baseline = candidate.getBoundingClientRect().height;
        const height = this.slot.getBoundingClientRect().height;
        this.slot.style.minHeight = `${height + 96}px`;
        const grown = candidate.getBoundingClientRect().height;
        this.slot.style.minHeight = '0px';
        return grown - baseline >= 94;
    }
    private isAllocated() {
        const slot = this.slot.getBoundingClientRect(), host = this.host.getBoundingClientRect();
        if (slot.width <= 0 || slot.height + 2 < host.height || host.left < -1 || host.right > this.viewport + 1) return false;
        for (let ancestor = this.slot.parentElement; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
            const style = getComputedStyle(ancestor), rect = ancestor.getBoundingClientRect();
            // Growing content must enlarge its ancestors, rather than escape fixed tracks.
            if (slot.bottom > rect.bottom + 2 || slot.top < rect.top - 2) return false;
            if (/(hidden|clip)/.test(`${style.overflowX} ${style.overflow}`) && (slot.left < rect.left - 1 || slot.right > rect.right + 1)) return false;
        }
        return true;
    }
    private placeBelow() {
        const board = this.board;
        if (!board) return;
        this.releaseReservation();
        this.adjacent = undefined;
        let anchor = board.closest<HTMLElement>('main.analyse, main.round, .analyse, .round__app, .board-layout-main, .board-layout, main')
            ?? board.closest<HTMLElement>('.board-wrapper, .analyse__board') ?? board.parentElement ?? board;
        // Include every native control row and move list in the complete site layout.
        const outer = anchor.closest<HTMLElement>('.board-layout, main');
        if (outer && outer.contains(anchor)) anchor = outer;
        while (anchor.parentElement && anchor.parentElement !== document.body) {
            const parent = anchor.parentElement, style = getComputedStyle(parent);
            if (/^(block|flow-root)$/.test(style.display) && !/^(absolute|fixed)$/.test(style.position)
                && !/(hidden|clip|scroll|auto)/.test(`${style.overflow} ${style.overflowY}`)) break;
            anchor = parent;
        }
        this.insertAfter(anchor);
        // An otherwise normal-looking wrapper may still have a fixed height. Move
        // outside it when geometry shows clipping or a collision with native controls.
        while (this.slot.parentElement && this.slot.parentElement !== document.body
            && (!this.isAllocated() || placementCollisions(this.host).length)) {
            anchor = this.slot.parentElement;
            this.insertAfter(anchor);
        }
    }
    private insertAfter(anchor: HTMLElement) {
        // Chess.com also uses board-layout on BODY. Keep the allocation inside
        // the document body instead of inserting an HTML sibling after BODY.
        if (anchor === document.body || anchor === document.documentElement) {
            if (document.body.lastElementChild !== this.slot) document.body.append(this.slot);
            return;
        }
        if (anchor !== this.slot && anchor.nextElementSibling !== this.slot) anchor.after(this.slot);
    }
    private validate() {
        if (this.adjacent && (!this.isAllocated() || placementCollisions(this.host).length)) {
            this.placeBelow();
            // Site tracks may settle one frame after Details/text growth. Allow
            // one measured retry per board/viewport, never an observer-driven loop.
            if (!this.retryUsed && this.retryFrame === undefined) {
                this.retryUsed = true;
                this.retryFrame = requestAnimationFrame(() => {
                    this.retryFrame = undefined;
                    if (this.destroyed || !this.board?.isConnected) return;
                    this.retryRequested = true; this.attach(this.board, this.lichess);
                });
            }
        }
        else if (!this.adjacent && this.slot.isConnected && (!this.isAllocated() || placementCollisions(this.host).length)) this.placeBelow();
    }
    destroy() {
        this.destroyed = true; this.resize.disconnect();
        if (this.frame !== undefined) cancelAnimationFrame(this.frame);
        if (this.retryFrame !== undefined) cancelAnimationFrame(this.retryFrame);
        this.releaseReservation(); this.slot.remove(); this.board = undefined;
    }
}
export function rectanglesOverlap(a: DOMRect, b: DOMRect): boolean {
    return a.width > 0 && a.height > 0 && b.width > 0 && b.height > 0
        && Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1
        && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
}
/** Geometry diagnostic shared with browser checks. Shadow-root controls are excluded. */
export function placementCollisions(host: HTMLElement, scope: ParentNode = document): HTMLElement[] {
    const card = host.getBoundingClientRect();
    return [...scope.querySelectorAll<HTMLElement>('button, input, select, textarea, .analyse__controls, .board-controls, .board-layout-controls')]
        .filter(element => !host.contains(element) && !element.contains(host) && getComputedStyle(element).visibility !== 'hidden'
            && rectanglesOverlap(card, element.getBoundingClientRect()));
}
