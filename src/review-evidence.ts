import { Chess, type Color, type Move, type Square } from 'chess.js';
import { playUci } from './chess';
import { colorName, pieceNames } from './piece-names';
import { readableMove } from './readable-move';
import type { Evaluation } from './types';
import type { ReviewMove } from './review-types';

const values = {p: 1, n: 3, b: 3, r: 5, q: 9, k: 0};
const center: Square[] = ['d4', 'e4', 'd5', 'e5'];
export interface EvidenceStep {
    index: number; uci: string; san: string; words: string; moveNumber: number;
    color: Color; from: Square; to: Square; piece: Move['piece']; captured?: Move['captured'];
    beforeFen: string; afterFen: string; check: boolean; mate: boolean; enPassant: boolean;
    attackerOrigin?: Square; victimOrigin?: Square; recaptures: string[];
}
export interface EvidenceLine {
    rootFen: string; steps: EvidenceStep[]; depth?: number; invalidTail: boolean;
    materialChange: number; unsettled: boolean;
}
export interface ReviewCause {
    kind: 'mate' | 'material' | 'central-support' | 'development-space' | 'king-lines';
    change: 'new' | 'worsened' | 'left-unresolved' | 'comparison';
    text: string; steps: number[]; square?: Square; motif?: 'fork' | 'pin';
    comparison?: {actualRecaptures: string[]; preferredRecaptures: string[]};
}
export interface ReviewEvidence {
    beforeFen: string; afterFen: string; played: string; preferred?: string;
    actual: EvidenceLine; preferredLine?: EvidenceLine; causes: ReviewCause[];
    existingTension: Square[]; materialDifference?: number;
    actualMaterialChange: number;
    evaluation?: {beforeWhite: number; afterWhite: number; moverDeltaCp?: number};
    verifiedHistory?: {initialFen: string; recentMoves: string[]; ply: number};
}
function material(board: Chess, side: Color) {
    return board.board().flat().reduce((sum, p) => sum + (p ? values[p.type] * (p.color === side ? 1 : -1) : 0), 0);
}
/** Preserve the legally verified prefix, but never treat an invalid tail as evidence. */
export function evidenceLine(fen: string, result: Evaluation, side: Color): EvidenceLine {
    const board = new Chess(fen), initial = material(board, side);
    const candidate = result.candidates.find(c => c.uci === result.bestMove);
    const pv = candidate?.uciPv?.length ? candidate.uciPv : result.bestMove ? [result.bestMove] : [];
    const origins = new Map<Square, Square>();
    for (const p of board.board().flat()) if (p) origins.set(p.square, p.square);
    const line: EvidenceLine = {rootFen: fen, steps: [], depth: candidate?.depth ?? result.depth, invalidTail: false, materialChange: 0, unsettled: false};
    for (const uci of pv.slice(0, 10)) {
        const beforeFen = board.fen(), words = (() => { try { return readableMove(beforeFen, uci); } catch { return ''; } })();
        let step: Move;
        try { step = playUci(board, uci); } catch { line.invalidTail = true; break; }
        const captureSquare = (step.isEnPassant() ? `${step.to[0]}${step.from[1]}` : step.to) as Square;
        const victimOrigin = step.captured ? origins.get(captureSquare) : undefined;
        const attackerOrigin = origins.get(step.from);
        origins.delete(step.from); origins.delete(captureSquare);
        if (attackerOrigin) origins.set(step.to, attackerOrigin);
        if (step.isKingsideCastle() || step.isQueensideCastle()) {
            const from = `${step.isKingsideCastle() ? 'h' : 'a'}${step.from[1]}` as Square;
            const to = `${step.isKingsideCastle() ? 'f' : 'd'}${step.from[1]}` as Square;
            const rook = origins.get(from); origins.delete(from); if (rook) origins.set(to, rook);
        }
        line.steps.push({index: line.steps.length, uci, san: step.san, words, moveNumber: Number(beforeFen.split(' ')[5]),
            color: step.color, from: step.from, to: step.to, piece: step.piece, captured: step.captured,
            beforeFen, afterFen: board.fen(), check: board.isCheck(), mate: board.isCheckmate(), enPassant: step.isEnPassant(), attackerOrigin, victimOrigin,
            recaptures: step.captured ? board.moves({verbose: true}).filter(m => m.captured && m.to === step.to).map(m => m.lan) : []});
    }
    line.materialChange = material(board, side) - initial;
    const last = line.steps.at(-1);
    // An exchange cut off before a legal recapture is not a settled material result.
    line.unsettled = !!last?.captured && last.recaptures.length > 0;
    return line;
}
export function formatEvidenceLine(line: EvidenceLine): string | undefined {
    if (!line.steps.length) return;
    return line.steps.map(s => `${s.moveNumber}${s.color === 'w' ? '.' : '...'} ${s.san} (${s.words})`).join(' ')
        + (line.invalidTail ? ' [Remaining line failed legal validation.]' : '');
}
/** Hypothetical capture used only to compare legal recaptures, not to search a new PV. */
function captureAt(fen: string, attacker: Square, target: Square, color: Color) {
    const parts = fen.split(' ');
    if (parts[1] !== color) { parts[1] = color; parts[3] = '-'; }
    try {
        const board = new Chess(parts.join(' '));
        const capture = board.moves({verbose: true}).find(m => m.from === attacker && m.to === target && m.captured && m.captured !== 'k');
        if (!capture) return;
        board.move(capture);
        return board.moves({verbose: true}).filter(m => m.captured && m.to === target).map(m => m.lan);
    } catch { return; }
}
function motif(step: EvidenceStep, victim: Square): {kind: 'fork' | 'pin'; text: string} | undefined {
    const board = new Chess(step.afterFen), enemy = step.color === 'w' ? 'b' : 'w';
    const targets = board.board().flat().filter(p => p && p.color === enemy && (p.type === 'k' || values[p.type] >= 3)
        && board.attackers(p.square, step.color).includes(step.to)
        && (p.type === 'k' ? step.check : captureAt(step.afterFen, step.to, p.square, step.color) !== undefined));
    if (targets.some(p => p!.square === victim) && targets.length >= 2 && (targets.some(p => p!.type === 'k') || values[step.piece] <= Math.min(...targets.map(p => values[p!.type])))) {
        return {kind: 'fork', text: `The ${pieceNames[step.piece]} on ${step.to.toUpperCase()} attacks ${targets.map(p => `${pieceNames[p!.type]} on ${p!.square.toUpperCase()}`).join(' and ')} at once: a fork.`};
    }
    if (!['b', 'r', 'q'].includes(step.piece)) return;
    const king = board.board().flat().find(p => p?.color === enemy && p.type === 'k');
    if (!king) return;
    const dx = king.square.charCodeAt(0) - step.to.charCodeAt(0), dy = Number(king.square[1]) - Number(step.to[1]);
    if (!(dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy)) || (step.piece === 'b' && (!dx || !dy)) || (step.piece === 'r' && dx && dy)) return;
    const between: Square[] = [];
    for (let x = step.to.charCodeAt(0) + Math.sign(dx), y = Number(step.to[1]) + Math.sign(dy);
        `${String.fromCharCode(x)}${y}` !== king.square; x += Math.sign(dx), y += Math.sign(dy)) {
        const sq = `${String.fromCharCode(x)}${y}` as Square;
        if (board.get(sq)) between.push(sq);
    }
    if (between.length === 1 && between[0] === victim && board.get(victim)?.color === enemy) {
        return {kind: 'pin', text: `The ${pieceNames[board.get(victim)!.type]} on ${victim.toUpperCase()} is pinned to its king by the ${pieceNames[step.piece]} on ${step.to.toUpperCase()}.`};
    }
}
function pinnedRecapturer(step: EvidenceStep, side: Color) {
    if (step.recaptures.length) return;
    const board = new Chess(step.afterFen);
    for (const defender of board.attackers(step.to, side)) {
        for (const slider of board.board().flat()) {
            if (!slider || slider.color === side || !['b', 'r', 'q'].includes(slider.type)) continue;
            const pin = motif({...step, to: slider.square, piece: slider.type, color: slider.color}, defender);
            if (pin?.kind === 'pin') return pin;
        }
    }
}
function trackedSquare(steps: EvidenceStep[], origin: Square, index: number) {
    let square: Square | undefined = origin;
    for (const step of steps.slice(0, index + 1)) {
        if (step.victimOrigin === origin) return;
        if (step.from === square) square = step.to;
        if (step.san.startsWith('O-O')) {
            const queenside = step.san.startsWith('O-O-O');
            if (square === `${queenside ? 'a' : 'h'}${step.from[1]}`) square = `${queenside ? 'd' : 'f'}${step.from[1]}` as Square;
        }
    }
    return square;
}
export function reviewEvidence(move: ReviewMove, before: Evaluation | undefined, after: Evaluation): ReviewEvidence {
    const original = new Chess(move.beforeFen), shown = new Chess(move.afterFen), side = move.color, enemy = side === 'w' ? 'b' : 'w';
    const verified = new Chess(move.beforeFen), played = playUci(verified, move.uci);
    if (verified.fen() !== shown.fen() || played.color !== side) throw new Error('Review evidence position mismatch.');
    const actual = evidenceLine(move.afterFen, after, side);
    const preferredLine = before?.bestMove && before.bestMove !== move.uci ? evidenceLine(move.beforeFen, before, side) : undefined;
    const actualMaterial = material(shown, side) - material(original, side) + actual.materialChange;
    const materialDifference = preferredLine?.steps.length && !preferredLine.invalidTail && !preferredLine.unsettled
        ? preferredLine.materialChange - actualMaterial : undefined;
    const evidence: ReviewEvidence = {beforeFen: move.beforeFen, afterFen: move.afterFen, played: move.uci, preferred: before?.bestMove,
        actual, preferredLine, causes: [], existingTension: [], materialDifference, actualMaterialChange: actualMaterial,
        evaluation: before ? {beforeWhite: before.whiteScore, afterWhite: after.whiteScore,
            moverDeltaCp: before.engineScore?.kind !== 'mate' && after.engineScore?.kind !== 'mate' ? Math.round((after.whiteScore - before.whiteScore) * (side === 'w' ? 1 : -1) * 100) : undefined} : undefined};
    const beforeSquare = (square: Square): Square => {
        if (square === played.to) return played.from;
        if (played.isKingsideCastle() && square === `f${played.from[1]}`) return `h${played.from[1]}` as Square;
        if (played.isQueensideCastle() && square === `d${played.from[1]}`) return `a${played.from[1]}` as Square;
        return square;
    };
    const mate = actual.steps.find(s => s.color === enemy && s.mate);
    if (mate && !actual.invalidTail) {
        const king = shown.board().flat().find(p => p?.color === side && p.type === 'k');
        evidence.causes.push({kind: 'mate', change: before?.engineScore?.kind === 'mate' && before.engineScore.winner === enemy ? 'left-unresolved' : 'new', steps: actual.steps.slice(0, mate.index + 1).map(s => s.index), square: king?.square,
            text: `${mate.index === 0 ? `${colorName(enemy)} can deliver checkmate` : 'The searched continuation reaches checkmate'} with ${mate.san} (${mate.words}).${mate.index ? ' This is one searched line, not proof that every reply forces this outcome.' : ''}`});
        return evidence;
    }
    // Consider the complete exchange, including the played move's material credit.
    for (const step of actual.steps.filter(s => s.color === enemy && s.captured && s.victimOrigin)) {
        const square = step.victimOrigin!, oldSquare = beforeSquare(square), piece = shown.get(square);
        if (!piece || piece.color !== side) continue;
        const oldAttack = original.isAttacked(oldSquare, enemy);
        const oldRecaptures = step.attackerOrigin && captureAt(move.beforeFen, step.attackerOrigin, oldSquare, enemy);
        const newlyLegal = oldAttack && oldRecaptures === undefined && step.index === 0;
        if (oldRecaptures !== undefined && !evidence.existingTension.includes(square)) evidence.existingTension.push(square);
        const lostRecapture = oldRecaptures && oldRecaptures.length > 0 && step.recaptures.length === 0;
        const changed = !oldAttack || newlyLegal || !!lostRecapture || materialDifference !== undefined && materialDifference > 0;
        // Do not frame equal trades, unfinished exchanges, or invalid lines as losses.
        if (!changed || actualMaterial >= 0 || actual.invalidTail || actual.unsettled) continue;
        const trigger = actual.steps.slice(0, step.index + 1).filter(s => s.color === enemy).map(s => {
            const target = trackedSquare(actual.steps, square, s.index);
            return target ? motif(s, target) : undefined;
        }).find(m => m) ?? pinnedRecapturer(step, side);
        const change = !oldAttack || newlyLegal ? 'new' : lostRecapture ? 'worsened' : 'left-unresolved';
        const loss = Math.abs(actualMaterial);
        evidence.causes.push({kind: 'material', change, steps: actual.steps.map(s => s.index), square, motif: trigger?.kind,
            text: `${oldRecaptures !== undefined ? `${square.toUpperCase()} was already under attack. ` : ''}${newlyLegal ? 'The attacker could not legally make this capture before the played move. ' : ''}${lostRecapture ? `Moving the ${pieceNames[original.get(move.uci.slice(0, 2) as Square)!.type]} removes a legal recapture. ` : ''}${trigger ? trigger.text + ' ' : ''}In the searched continuation, ${colorName(enemy)} captures the ${pieceNames[piece.type]} ${step.to === square ? `on ${square.toUpperCase()}` : `originally on ${square.toUpperCase()}`} with ${step.san} (${step.words})${step.enPassant ? ` en passant on ${step.to.toUpperCase()}` : ''}. The shown exchanges leave ${colorName(side)} down ${loss} material point${loss === 1 ? '' : 's'} relative to before the played move.`});
        break;
    }
    if (evidence.causes.length || actual.invalidTail) return evidence;
    const reply = actual.steps[0], preferred = preferredLine?.steps[0];
    if (!reply || !preferred || preferredLine?.invalidTail) return evidence;
    const preferredBoard = new Chess(preferred.afterFen);
    // Compare legal responses to the same central capture, rather than count geometric defenders.
    if (reply.captured && center.includes(reply.to)) {
        const current = captureAt(move.afterFen, reply.from, reply.to, enemy);
        const alternative = captureAt(preferred.afterFen, reply.from, reply.to, enemy);
        if (current && alternative && alternative.length > current.length) {
            const recapturers = current.map(uci => `${pieceNames[new Chess(reply.afterFen).get(uci.slice(0, 2) as Square)!.type]} on ${uci.slice(0, 2).toUpperCase()}`).join(' or ');
            evidence.causes.push({kind: 'central-support', change: 'comparison', steps: [0], comparison: {actualRecaptures: current, preferredRecaptures: alternative}, text:
                `${reply.to.toUpperCase()} is under central pressure. After ${reply.san} (${reply.words}), ${colorName(side)} has ${current.length} legal recapture option${current.length === 1 ? '' : 's'}${recapturers ? ` (${recapturers})` : ''}, compared with ${alternative.length} after the engine's preferred move. The preferred continuation gives ${colorName(side)} more ways to resolve the central tension.`});
        }
    }
    // A pawn break can take away a concrete development square without making the knight move illegal.
    if (!evidence.causes.length && reply.piece === 'p' && center.includes(reply.to)) {
        const pushed = new Chess(reply.afterFen);
        for (const knight of shown.board().flat().filter(p => p?.color === side && p.type === 'n' && p.square[1] === (side === 'w' ? '1' : '8'))) {
            if (preferred.piece !== 'n' || preferred.from !== knight!.square || preferred.to[1] === knight!.square[1]) continue;
            for (const sq of ['c3', 'f3', 'c6', 'f6'] as Square[]) {
                const dx = Math.abs(sq.charCodeAt(0) - knight!.square.charCodeAt(0)), dy = Math.abs(Number(sq[1]) - Number(knight!.square[1]));
                if (dx * dy !== 2 || shown.get(sq) || !pushed.attackers(sq, enemy).includes(reply.to) || shown.attackers(sq, enemy).includes(reply.from)) continue;
                if (preferredBoard.attackers(sq, enemy).includes(reply.from)) continue;
                evidence.causes.push({kind: 'development-space', change: 'comparison', steps: [0], text:
                    `The searched reply ${reply.san} (${reply.words}) gives ${colorName(enemy)}'s pawn control of ${sq.toUpperCase()}. That puts pawn pressure on a development square while ${colorName(side)}'s knight remains on ${knight!.square.toUpperCase()}. The preferred line brings that knight off its back rank first; pawn pressure does not make the knight move illegal.`});
                break;
            }
            if (evidence.causes.length) break;
        }
    }
    // Report a concrete newly opened checking line, not a generic 'weakened king' assertion.
    if (!evidence.causes.length && reply.check && !reply.mate && original.get(move.uci.slice(0, 2) as Square)?.type === 'p') {
        const king = shown.board().flat().find(p => p?.color === side && p.type === 'k');
        if (king && !original.isAttacked(king.square, enemy) && move.uci[0] !== 'a' && move.uci[0] !== 'h'
            && Math.abs(move.uci.charCodeAt(0) - king.square.charCodeAt(0)) <= 1) {
            const oldCheck = new Chess(preferred.afterFen);
            try {
                playUci(oldCheck, reply.uci);
                if (!oldCheck.isCheck()) evidence.causes.push({kind: 'king-lines', change: 'comparison', steps: [0], square: king.square,
                    text: `The pawn move changes the lines near ${colorName(side)}'s king. The searched reply ${reply.san} (${reply.words}) gives check; the same reply does not check in the preferred position. Check requires a response, but does not by itself prove material loss.`});
            } catch { /* Different branches cannot be compared by assuming a legal reply. */ }
        }
    }
    return evidence;
}
