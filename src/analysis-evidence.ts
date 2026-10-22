import { Chess, type Color, type Square } from 'chess.js';
import { playUci } from './chess';
import { colorName } from './piece-names';
import type { Evaluation } from './types';
import type { AnalysisOpeningContext } from './opening-context';

export interface AnalysisStep {index: number; afterFen: string; uci: string; san: string; color: Color; moveNumber: number; from: Square; to: Square; piece: string; castle?: 'kingside' | 'queenside'}
export interface AnalysisEvidence {
    fen: string; recommended: AnalysisStep; pv: AnalysisStep[]; invalidTail: boolean; depth?: number;
    controlDelta: {square: Square; before: boolean; after: boolean}[];
    targetsContested: Square[];
    opponentCentralPushes: {step: number; square: Square; san: string}[];
    kingSafety: Record<Color, {rights: {kingside: boolean; queenside: boolean}; pvCastling?: {side: 'kingside' | 'queenside'; step: number}}>;
    fianchettos: {color: Color; wing: 'kingside' | 'queenside'; pawn: Square; bishopFrom: Square; bishopTo: Square; status: 'setup' | 'pv-confirmed' | 'established'; step?: number}[];
    opening?: AnalysisOpeningContext;
}
/** Strategic observations are scoped to the legal top-PV prefix, never guessed from SAN text. */
export function analysisEvidence(fen: string, result: Evaluation): AnalysisEvidence | undefined {
    const original = new Chess(fen), board = new Chess(fen);
    const candidate = result.candidates.find(c => c.uci === result.bestMove);
    const raw = candidate?.uciPv?.length ? candidate.uciPv : result.bestMove ? [result.bestMove] : [];
    if (!raw.length || raw[0] !== result.bestMove) return;
    const pv: AnalysisStep[] = [];
    let invalidTail = false, after: Chess | undefined;
    for (const uci of raw.slice(0, 10)) {
        const moveNumber = Number(board.fen().split(' ')[5]);
        try {
            const move = playUci(board, uci);
            pv.push({index: pv.length, afterFen: board.fen(), uci, san: move.san, color: move.color, moveNumber, from: move.from, to: move.to, piece: move.piece,
                castle: move.isKingsideCastle() ? 'kingside' : move.isQueensideCastle() ? 'queenside' : undefined});
            if (pv.length === 1) after = new Chess(board.fen());
        } catch { invalidTail = true; break; }
    }
    if (!after || !pv.length) return;
    const recommended = pv[0], side = recommended.color;
    const controlDelta: AnalysisEvidence['controlDelta'] = [];
    for (const file of 'abcdefgh') for (let rank = 1; rank <= 8; rank++) {
        const square = `${file}${rank}` as Square;
        const before = original.attackers(square, side).includes(recommended.from), next = after.attackers(square, side).includes(recommended.to);
        if (before !== next) controlDelta.push({square, before, after: next});
    }
    const rights = original.fen().split(' ')[2];
    const kingSafety: AnalysisEvidence['kingSafety'] = {w: {rights: {kingside: rights.includes('K'), queenside: rights.includes('Q')}}, b: {rights: {kingside: rights.includes('k'), queenside: rights.includes('q')}}};
    for (const step of pv) if (step.castle) kingSafety[step.color].pvCastling = {side: step.castle, step: step.index};
    const fianchettos: AnalysisEvidence['fianchettos'] = [];
    for (const color of ['w', 'b'] as const) for (const wing of ['kingside', 'queenside'] as const) {
        const pawn = `${wing === 'kingside' ? 'g' : 'b'}${color === 'w' ? '3' : '6'}` as Square;
        const bishopFrom = `${wing === 'kingside' ? 'f' : 'c'}${color === 'w' ? '1' : '8'}` as Square;
        const bishopTo = `${wing === 'kingside' ? 'g' : 'b'}${color === 'w' ? '2' : '7'}` as Square;
        if (original.get(pawn)?.type !== 'p' || original.get(pawn)?.color !== color) continue;
        if (original.get(bishopTo)?.type === 'b' && original.get(bishopTo)?.color === color) {
            fianchettos.push({color, wing, pawn, bishopFrom, bishopTo, status: 'established'}); continue;
        }
        if (original.get(bishopFrom)?.type !== 'b' || original.get(bishopFrom)?.color !== color || original.get(bishopTo)) continue;
        const step = pv.find(s => s.color === color && s.piece === 'b' && s.from === bishopFrom && s.to === bishopTo);
        fianchettos.push({color, wing, pawn, bishopFrom, bishopTo, status: step ? 'pv-confirmed' : 'setup', step: step?.index});
    }
    return {fen, recommended, pv, invalidTail, depth: candidate?.depth ?? result.depth, controlDelta,
        targetsContested: controlDelta.filter(d => d.after && ['d4','e4','d5','e5'].includes(d.square)).map(d => d.square),
        opponentCentralPushes: pv.filter(s => s.color !== side && s.piece === 'p' && ['d4','e4','d5','e5'].includes(s.to) && s.from[0] === s.to[0]).map(s => ({step: s.index, square: s.to, san: s.san})),
        kingSafety, fianchettos};
}
export function analysisPlanFacts(evidence: AnalysisEvidence) {
    const side = evidence.recommended.color, facts: {id: string; text: string; rank: number; steps: number[]}[] = [];
    const castle = evidence.kingSafety[side].pvCastling;
    if (castle) {
        const setup = evidence.fianchettos.find(f => f.color === side && f.status === 'pv-confirmed' && f.step! < castle.step);
        facts.push({id: `recommended.castling.${castle.side}`, rank: 68, steps: setup ? [setup.step!, castle.step] : [castle.step],
            text: `The searched line has ${colorName(side)} ${setup ? `develop the bishop to ${setup.bishopTo.toUpperCase()} and then ` : ''}castle ${castle.side} with ${evidence.pv[castle.step].san}`});
    }
    for (const setup of evidence.fianchettos.filter(f => f.color === side && f.status === 'pv-confirmed')) {
        facts.push({id: `recommended.fianchetto.${setup.wing}`, rank: 66, steps: [setup.step!],
            text: `With the pawn on ${setup.pawn.toUpperCase()}, the searched line develops ${colorName(side)}'s bishop from ${setup.bishopFrom.toUpperCase()} to ${setup.bishopTo.toUpperCase()}, a fianchetto`});
    }
    return facts;
}
/** Defense in depth for approved prose as well as provider fact selection. */
export function analysisFactAllowed(text: string, evidence: AnalysisEvidence, actor = evidence.recommended.color) {
    const long = /\b(?:queenside castling|long castling|castl(?:e|es|ed|ing) (?:queenside|long)|O-O-O|0-0-0)\b/i.test(text);
    const short = /\b(?:kingside castling|short castling|castl(?:e|es|ed|ing) (?:kingside|short)|(?<![-O0])(?:O-O|0-0)(?![-O0]))\b/i.test(text);
    const side = evidence.kingSafety[actor].pvCastling?.side;
    if (long && side !== 'queenside' || short && side !== 'kingside') return false;
    // Controlling a square does not forbid a pawn push, especially one explicitly in the PV.
    if (/\b(?:prevents?|stops?|rules? out)\b.*\b(?:d4|e4|d5|e5)\b/i.test(text)) return false;
    return true;
}
