import { Chess } from 'chess.js';
import { normalizedFen, replay } from './chess';
import type { NativeReviewSnapshot } from './site-review-types';

export interface Position { board: HTMLElement; orientation: 'white' | 'black'; fen?: string; status: string; allowed: boolean }
export function guidanceMode(url: URL): 'analysis' | 'review' {
    return /^\/(?:analysis|study|practice)(?:\/|$)/.test(url.pathname) && !/^\/analysis\/game\//.test(url.pathname) || /^\/play\/computer(?:\/|$)/.test(url.pathname) ? 'analysis' : 'review';
}
export function allowedContext(doc: Document, url: URL, native?: NativeReviewSnapshot): boolean {
    // Positive allow-list; a game URL alone never proves that a human game ended.
    if (doc.querySelector('.game-over-modal, .game-over-component, .rclock.running, .clock-component.clock-player-turn')) {
        if (doc.querySelector('.rclock.running, .clock-component.clock-player-turn')) return false;
    }
    if (doc.querySelector('.back-to-game, .analyse.is-relay, main.analyse[class*="variant-"]:not(.variant-standard)')) return false;
    if (native) {
        if (native.url !== url.href) return false;
        if (!native.allowed || !native.fen || !['www.chess.com', 'lichess.org'].includes(url.hostname) || url.protocol !== 'https:') return false;
        try { normalizedFen(native.fen); return true; } catch { return false; }
    }
    if (url.hostname === 'lichess.org') {
        if (doc.querySelector('.back-to-game, .analyse.is-relay')) return false;
        if (doc.querySelector('main.analyse[class*="variant-"]:not(.variant-standard)')) return false;
        if (/^\/(analysis|study)(\/|$)/.test(url.pathname)) return true;
        const result = doc.querySelector('.game__meta .result, .analyse__tools .result, .result-wrap .result')?.textContent?.trim();
        const status = doc.querySelector('.game__meta .status')?.textContent?.trim().toLowerCase() ?? '';
        const finished = !!result && /^(1-0|0-1|½-½|1\/2-1\/2)$/.test(result) || /^(?:draw|drawn)(?:\s*[•·—-]|\s*$)/.test(status) || /\b(?:white|black)\s+(?:is\s+victorious|wins|won)\b/.test(status);
        return !!doc.querySelector('.analyse__board, .round__app') && finished;
    }
    if (url.hostname === 'www.chess.com') {
        if (/^\/(analysis|practice)(\/|$)/.test(url.pathname)) return true;
        if (/^\/play\/computer(\/|$)/.test(url.pathname)) return true;
        return /^\/game\//.test(url.pathname) && !!doc.querySelector('.game-over-modal, .game-over-component, [data-game-status="finished"]');
    }
    return false;
}
function fullFen(doc: Document, board: HTMLElement): string | undefined {
    const inputs = doc.querySelectorAll<HTMLInputElement>('input[name="fen"], textarea[name="fen"], .analyse__underboard .fen input, .analyse__underboard .copyables input.copyable, input.copyable[readonly]');
    const values = [board.getAttribute('data-fen'), ...Array.from(inputs).filter(input => input !== doc.activeElement).map(input => input.value)];
    for (const value of values) {
        if (!value) continue;
        try { return normalizedFen(value); } catch { /* partial FEN is deliberately rejected */ }
    }
}
function historyFen(doc: Document, lichess: boolean): string | undefined {
    const selector = lichess ? '.analyse__moves move' : '.move-list .node, .vertical-move-list .node';
    const nodes = Array.from(doc.querySelectorAll<HTMLElement>(selector));
    if (!nodes.length) return;
    const selected = nodes.findIndex(n => n.matches('.active, .selected, [aria-current="true"]'));
    // Do not analyze the end of the game while a different ply is displayed.
    if (selected < 0) return;
    const firstPly = nodes[0].getAttribute('data-ply');
    if (!firstPly || Number(firstPly) !== 1) return;
    const chosen = nodes.slice(0, selected + 1);
    if (chosen.some((node, index) => Number(node.dataset.ply) !== index + 1)) return;
    const initial = doc.querySelector<HTMLElement>('[data-initial-fen]')?.dataset.initialFen;
    // Custom positions require their initial FEN; never guess missing castling rights.
    if (doc.querySelector('[data-variant]:not([data-variant="standard"]), .variant-link')) return;
    try { return replay(chosen.map(n => (n.dataset.san ?? n.textContent ?? '').trim().replace(/[!?]+$/g, '')), initial); }
    catch { return; }
}
// Match the reconstructed placement to visible pieces before trusting DOM history/FEN.
export function matchesBoard(board: HTMLElement, fen: string, lichess: boolean, orientation: Position['orientation']): boolean {
    const expected = new Chess(fen);
    const pieces = Array.from(board.querySelectorAll<HTMLElement>(lichess ? 'piece:not(.ghost)' : '.piece'));
    const occupied = expected.board().flat().filter(Boolean).length;
    if (pieces.length !== occupied) return false;
    const rect = board.getBoundingClientRect();
    const seen = new Set<string>();
    for (const piece of pieces) {
        let file: number, rank: number, color: string | undefined, type: string | undefined;
        if (!lichess) {
            const square = /\bsquare-([1-8])([1-8])\b/.exec(piece.className);
            const code = /\b([wb])([pnbrqk])\b/.exec(piece.className);
            if (!square || !code) return false;
            file = Number(square[1]) - 1; rank = Number(square[2]) - 1; color = code[1]; type = code[2];
        } else {
            if (!rect.width || !rect.height) return false;
            const p = piece.getBoundingClientRect();
            let x = Math.round((p.left - rect.left) / (rect.width / 8));
            let y = Math.round((p.top - rect.top) / (rect.height / 8));
            file = orientation === 'white' ? x : 7 - x;
            rank = orientation === 'white' ? 7 - y : y;
            color = piece.classList.contains('white') ? 'w' : piece.classList.contains('black') ? 'b' : undefined;
            const names: Record<string, string> = { pawn: 'p', knight: 'n', bishop: 'b', rook: 'r', queen: 'q', king: 'k' };
            type = Object.entries(names).find(([name]) => piece.classList.contains(name))?.[1];
        }
        if (file < 0 || rank < 0 || file > 7 || rank > 7) return false;
        const square = `${'abcdefgh'[file]}${rank + 1}`;
        const actual = expected.get(square as Parameters<Chess['get']>[0]);
        if (seen.has(square) || actual?.color !== color || actual?.type !== type) return false;
        seen.add(square);
    }
    return true;
}
export function readPosition(doc: Document = document, url = new URL(location.href), pageFen?: string, native?: NativeReviewSnapshot): Position | undefined {
    const lichess = url.hostname === 'lichess.org';
    const board = doc.querySelector<HTMLElement>(lichess ? '.analyse__board cg-board, .round__app cg-board, cg-board' : 'wc-chess-board, chess-board, .board');
    if (!board) return;
    const orientation = (lichess ? board.closest('.orientation-black') : board.matches('.flipped') || board.closest('.flipped')) ? 'black' : 'white';
    const allowed = allowedContext(doc, url, native);
    if (!allowed) return { board, orientation, allowed, status: 'Available in study, review and computer practice.' };
    let reliablePageFen: string | undefined;
    if (pageFen) { try { reliablePageFen = normalizedFen(pageFen); } catch { /* reject malformed site state */ } }
    const fen = reliablePageFen ?? fullFen(doc, board) ?? historyFen(doc, lichess);
    if (!fen || !matchesBoard(board, fen, lichess, orientation)) return { board, orientation, allowed, status: 'Waiting for a reliable position. You can use FEN in settings.' };
    return { board, orientation, allowed, fen, status: 'Ready' };
}
