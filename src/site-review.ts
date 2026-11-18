import { readBoardPlacement, type Position } from './adapters';
import { normalizedFen } from './chess';
import { fenAt } from './review-session';
import type { ReviewSession } from './review-types';
import type { NativeReviewSnapshot } from './site-review-types';
import { parseLichessGameUrl } from './site-game-route';

export { readSiteSnapshot as readNativeReview } from './site-snapshot';

export function resolveReviewPly(session: ReviewSession, snapshot: NativeReviewSnapshot): number | undefined {
    if (!snapshot.allowed || !snapshot.fen || !session.source) return;
    try {
        const selected = new URL(snapshot.url), source = new URL(session.source.url);
        if (selected.protocol !== 'https:' || source.protocol !== 'https:' || selected.hostname !== source.hostname) return;
        const study = session.source.gameId === 'study' && !snapshot.gameId && selected.pathname === source.pathname && (selected.hostname === 'lichess.org' ? /^\/(analysis|study)(\/|$)/.test(selected.pathname) : selected.hostname === 'www.chess.com' && /^\/(analysis|practice)(\/|$)/.test(selected.pathname));
        const currentId = selected.hostname === 'lichess.org' ? parseLichessGameUrl(selected)?.gameId
            : selected.hostname === 'www.chess.com' ? /^\/(?:game\/(?:live|daily)|live\/game|analysis\/game\/(?:live|daily))\/(\d+)(?:\/|$)/.exec(selected.pathname)?.[1] : undefined;
        if (!study && (snapshot.gameId !== session.source.gameId || !!currentId && currentId !== session.source.gameId)) return;
        const fen = normalizedFen(snapshot.fen);
        if (snapshot.initialFen && normalizedFen(snapshot.initialFen) !== session.initialFen) return;
        const matches = (ply: number) => {
            if (normalizedFen(fenAt(session, ply)) !== fen) return false;
            return !snapshot.moves || (snapshot.moves.length >= ply && snapshot.moves.slice(0, ply).every((move, index) => move === session.moves[index].san || move === session.moves[index].uci));
        };
        if (snapshot.ply !== undefined) return Number.isInteger(snapshot.ply) && snapshot.ply >= 0 && snapshot.ply <= session.moves.length && matches(snapshot.ply) ? snapshot.ply : undefined;
        const found: number[] = [];
        for (let ply = 0; ply <= session.moves.length; ply++) if (matches(ply)) found.push(ply);
        return found.length === 1 ? found[0] : undefined;
    } catch { return; }
}

/** Reconstruct missing FEN only from an unambiguous captured mainline. */
export function bindCapturedSnapshot(session: ReviewSession, snapshot: NativeReviewSnapshot): NativeReviewSnapshot {
    if (snapshot.fen || !snapshot.allowed || !snapshot.placement || snapshot.path && !snapshot.moves) return snapshot;
    const positions = [session.initialFen,...session.moves.map(move=>move.afterFen)];
    const plies = snapshot.ply !== undefined ? [snapshot.ply] : positions.map((_,ply)=>ply);
    const matches = plies.filter(ply=>positions[ply]?.split(' ')[0]===snapshot.placement && resolveReviewPly(session,{...snapshot,ply,fen:positions[ply]})===ply);
    return matches.length===1 ? {...snapshot,ply:matches[0],fen:positions[matches[0]]} : snapshot;
}
export function bindCapturedPosition(session: ReviewSession, snapshot: NativeReviewSnapshot, position: Position): NativeReviewSnapshot {
    if (snapshot.fen) return snapshot;
    return bindCapturedSnapshot(session,{...snapshot,placement:readBoardPlacement(position.board,new URL(snapshot.url).hostname==='lichess.org',position.orientation)});
}

// Native variation/history methods differ across site builds. Until a method is
// positively supported, retain the site's own controls and textual continuation.
export function navigateNativeReview(request: { direction: 'previous' | 'next' | 'first' | 'last' | 'select'; ply?: number; expectedUrl: string; initialFen?: string; moves?: string[]; gameId?: string }): { ok: boolean } {
    if (location.href !== request.expectedUrl) return { ok: false };
    if (location.protocol !== 'https:' || !['www.chess.com','lichess.org'].includes(location.hostname) || document.querySelector('.rclock.running,.clock-component.clock-player-turn,.back-to-game')) return {ok:false};
    if (document.querySelector('.round__app[class*="variant-"]:not(.variant-standard),main.analyse[class*="variant-"]:not(.variant-standard)')) return {ok:false};
    const round = location.hostname === 'lichess.org' && document.querySelector<HTMLElement>('.round__app');
    if (round && request.initialFen && request.moves && request.gameId) {
        const id = /^\/(?:game\/)?([a-zA-Z0-9]{8})(?:[a-zA-Z0-9]{4})?(?:\/(?:white|black))?(?:\/analysis)?\/?$/.exec(location.pathname)?.[1];
        const result = round.querySelector('.result-wrap .result')?.textContent?.trim();
        if (id !== request.gameId || !result || !/^(?:1-0|0-1|½-½|1\/2-1\/2)$/.test(result) || request.moves.length > 1500) return {ok:false};
        const selected = round.querySelector<HTMLElement>('.a1t');
        const normalize = (text: string) => text.trim().replace(/[!?]+$/g, '').replace(/0/g, 'O');
        const moveNodes = selected?.parentElement ? [...selected.parentElement.children].filter(node => node.tagName === selected.tagName && normalize(node.firstChild?.textContent ?? '') !== '…') as HTMLElement[] : [];
        if (selected && (moveNodes.length !== request.moves.length || moveNodes.some((node, index) => normalize(node.firstChild?.textContent ?? '') !== normalize(request.moves![index])))) return {ok:false};
        const current = selected ? moveNodes.indexOf(selected) + 1 : 0;
        const target = request.direction === 'first' ? 0 : request.direction === 'last' ? request.moves.length : request.direction === 'previous' ? current - 1 : request.direction === 'next' ? current + 1 : request.ply;
        if (target === undefined || !Number.isInteger(target) || target < 0 || target > request.moves.length) return {ok:false};
        if (selected && current === target) return {ok:true};
        const fen = request.initialFen.split(/\s+/);
        if (fen.length !== 6 || !/^[wb]$/.test(fen[1]) || !/^[1-9]\d*$/.test(fen[5])) return {ok:false};
        const rootPly = (Number(fen[5]) - 1) * 2 + (fen[1] === 'b' ? 1 : 0);
        const control = [...round.querySelectorAll<HTMLButtonElement>('button[data-ply]')].find(button => button.dataset.ply === String(rootPly + target) && !button.disabled && button.getAttribute('aria-disabled') !== 'true');
        if (control) { control.click(); return {ok:true}; }
        if (target > 0 && moveNodes[target - 1]) {
            moveNodes[target - 1].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, buttons: 1 }));
            return {ok:true};
        }
        return {ok:false};
    }
    if ((request.direction === 'first' || request.direction === 'select' && request.ply === 0)) {
        const nodes = [...document.querySelectorAll<HTMLElement>('.analyse__controls [data-act="first"], .analyse__controls .first, .analyse__controls [data-icon=""], .board-controls [data-action="first"], .board-controls [aria-label="First Move"], [data-cy="move-first"]')];
        const available = [...new Set(nodes)].filter(n => !n.hasAttribute('disabled') && n.getAttribute('aria-disabled') !== 'true');
        if (available.length !== 1) return { ok: false };
        available[0].click(); return { ok: true };
    }
    if(request.direction==='select' && Number.isInteger(request.ply) && request.ply!>0 && request.ply!<=1500){
        const nodes=[...document.querySelectorAll<HTMLElement>('.move-list [data-ply],.vertical-move-list [data-ply],.analyse__moves [data-ply],.tview2 [data-ply],.round__moves [data-ply]')].filter(node=>Number(node.dataset.ply)===request.ply);
        if(nodes.length!==1 || nodes[0].getAttribute('aria-disabled')==='true' || nodes[0].hasAttribute('disabled'))return {ok:false};
        nodes[0].click(); return {ok:true};
    }
    return { ok: false };
}
