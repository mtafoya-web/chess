// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { Card } from '../src/card';
import { buildBoardContext } from '../src/board-context';
import { Chess } from 'chess.js';
afterEach(() => { document.body.replaceChildren(); });
it('supports keyboard-native collapse and a separate close action', () => {
    const close = vi.fn(), card = new Card(close); document.body.append(card.host);
    const toggle = card.root.querySelector<HTMLButtonElement>('.brand')!;
    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(card.root.querySelector<HTMLElement>('#guidance')?.hidden).toBe(true);
    expect(close).not.toHaveBeenCalled();
    toggle.click(); expect(toggle.getAttribute('aria-expanded')).toBe('true');
    card.root.querySelector<HTMLButtonElement>('[data-close]')!.click(); expect(close).toHaveBeenCalledOnce();
});
it('keeps the arrival palette through surface, move-hash and board changes, then resamples on navigation', () => {
    document.body.innerHTML = '<section style="background-color:rgb(30,30,30);color:rgb(0,0,0)"><button style="color:rgb(0,0,0)">Site control</button><div id="board"></div></section>';
    const context = document.querySelector('section')!, board = document.getElementById('board')!;
    const card = new Card(() => {}); context.append(card.host); card.theme(board, false);
    expect(card.host.style.getPropertyValue('--k-bg')).toBe('rgb(30, 30, 30)');
    expect(card.host.style.getPropertyValue('--k-fg')).toBe('#eeeeee');
    context.style.backgroundColor = 'rgb(250,250,250)'; card.theme(board, false);
    expect(card.host.style.getPropertyValue('--k-bg')).toBe('rgb(30, 30, 30)');
    history.replaceState({}, '', '#move-10'); card.theme(board, false);
    expect(card.host.style.getPropertyValue('--k-bg')).toBe('rgb(30, 30, 30)');
    const replacement = document.createElement('div'); board.replaceWith(replacement); card.theme(replacement, false);
    expect(card.host.style.getPropertyValue('--k-bg')).toBe('rgb(30, 30, 30)');
    history.pushState({}, '', '/another-game'); card.theme(replacement, false);
    expect(card.host.style.getPropertyValue('--k-bg')).toBe('rgb(250, 250, 250)');
    expect(card.host.style.getPropertyValue('--k-fg')).toBe('rgb(0, 0, 0)');
});

it('keeps overlay toggles outside Details and disables them without verified candidates', () => {
    const card = new Card(() => {}); document.body.append(card.host);
    expect(card.heatmapToggle.closest('details')).toBeNull();
    expect(card.arrowsToggle.closest('details')).toBeNull();
    expect(card.layerControls.hidden).toBe(false);
    expect(card.heatmapToggle.disabled).toBe(true);
    card.setReviewMode(false);
    expect(card.layerControls.hidden).toBe(false);
    expect(card.reviewControls.hidden).toBe(true);
    const change = vi.fn(); card.onReviewLayers = change;
    card.heatmapToggle.disabled = false; card.heatmapToggle.click();
    expect(change).toHaveBeenCalledOnce();
    expect(card.heatmapToggle.checked).toBe(false);
    card.clear('Position changed');
    expect(card.heatmapToggle.disabled).toBe(true);
    expect(card.heatmapToggle.checked).toBe(false);
});

it('shows selected verified pieces and makes unknown capture history explicit', () => {
    const card = new Card(() => {}), board = new Chess(); board.move('e4');
    card.showPositionFacts(buildBoardContext(board.fen()));
    expect(card.positionFacts.hidden).toBe(false);
    expect(card.positionFacts.textContent).toContain('pawn');
    expect(card.positionFacts.textContent).toContain('e4');
    expect(card.positionFacts.textContent).toContain('Capture history unknown');
    expect(card.positionFacts.open).toBe(false);
    card.clear('Next move'); expect(card.positionFacts.hidden).toBe(true);
    expect(card.positionFacts.textContent).toBe('');
});
