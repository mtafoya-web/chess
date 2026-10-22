import { Chess, type Square } from 'chess.js';
import { playUci } from './chess';
import { namedPiece, colorName, type ContextPiece } from './board-context';

export interface ThreatFact { id: string; scope: string; branch: string; text: string; meaning?: string; evidence: 'attack-map' | 'legal-move'; attacker?: ContextPiece; target?: ContextPiece; supportingMoves: string[] }
function pieceAt(board: Chess, square: Square): ContextPiece | undefined {
    const piece = board.get(square); return piece ? { ...piece, square, id: `${piece.color}${piece.type}:${square}` } : undefined;
}
/** Attack maps describe geometry, including pinned attackers. They never imply a legal capture or a win. */
export function moveThreatFacts(fen: string, uci: string, branch: string, scope: string): ThreatFact[] {
    const before = new Chess(fen), after = new Chess(fen), move = playUci(after, uci);
    const mover = pieceAt(before, move.from)!, moved = pieceAt(after, move.to)!;
    const facts: ThreatFact[] = [];
    if (after.isCheckmate()) facts.push({ id: `${branch}.mate`, branch, scope, text: `${namedPiece(moved)} delivers checkmate.`, meaning: 'Checkmate means the king is under attack and no legal reply can save it; the game is over.', evidence: 'legal-move', supportingMoves: [uci] });
    else if (after.isCheck()) facts.push({ id: `${branch}.check`, branch, scope, text: `${namedPiece(moved)} checks ${colorName(move.color === 'w' ? 'b' : 'w')}'s king on ${after.board().flat().find(p => p?.type === 'k' && p.color !== move.color)!.square}.`, meaning: 'Check means the king is under attack; the reply must remove the check, but the king does not always have to move.', evidence: 'legal-move', supportingMoves: [uci] });
    if (move.captured) {
        const square = (move.isEnPassant() ? `${move.to[0]}${move.from[1]}` : move.to) as Square, target = pieceAt(before, square)!;
        facts.push({ id: `${branch}.capture`, branch, scope, text: `${namedPiece(mover)} captures ${namedPiece(target)}${move.isEnPassant() ? ' en passant' : ''}.`, meaning: 'A capture removes that piece from the board; it does not by itself prove a lasting material gain.', evidence: 'legal-move', attacker: mover, target, supportingMoves: [uci] });
    }
    const enemy = move.color === 'w' ? 'b' : 'w';
    if (before.isAttacked(move.from, enemy) && !after.isAttacked(move.to, enemy)) facts.push({ id: `${branch}.escape`, branch, scope, text: `${namedPiece(mover)} leaves an attacked square and reaches a square outside the opponent's current attack map.`, evidence: 'attack-map', attacker: mover, supportingMoves: [uci] });
    for (const row of after.board()) for (const p of row) {
        if (!p || p.color === move.color || p.type === 'k') continue;
        if (after.attackers(p.square, move.color).includes(move.to) && !before.attackers(p.square, move.color).includes(move.from)) {
            const target = pieceAt(after, p.square)!;
            facts.push({ id: `${branch}.attack.${p.square}`, branch, scope, text: `After the move, ${namedPiece(moved)} attacks ${namedPiece(target)}; that alone does not establish a material win.`, evidence: 'attack-map', attacker: moved, target, supportingMoves: [uci] });
        }
    }
    return facts;
}
