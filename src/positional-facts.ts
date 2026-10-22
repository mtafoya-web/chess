import { Chess, type Square } from 'chess.js';
import { playUci } from './chess';
import { buildBoardContext, colorName, pieceNames, type BoardHistory } from './board-context';

export interface PositionalFact {
    id: string; kind: 'development' | 'center' | 'opened-line' | 'castling'; branch: string; scope: string;
    effect: string; benefit: string; text: string; evidence: string; squares: Square[]; pieceId: string; rank: number;
}
const center: Square[] = ['d4', 'e4', 'd5', 'e5'];
function raySquares(board: Chess, origin: Square): Square[] {
    const piece = board.get(origin);
    if (!piece || !['b', 'q'].includes(piece.type)) return [];
    const directions = [[1, 1], [-1, 1], [1, -1], [-1, -1], ...(piece.type === 'q' ? [[1, 0], [-1, 0], [0, 1], [0, -1]] : [])];
    const squares: Square[] = [];
    for (const [dx, dy] of directions) {
        let x = origin.charCodeAt(0) + dx, y = Number(origin[1]) + dy;
        while (x >= 97 && x <= 104 && y >= 1 && y <= 8) {
            const square = `${String.fromCharCode(x)}${y}` as Square, target = board.get(square);
            if (!target || target.color !== piece.color) squares.push(square);
            if (target) break;
            x += dx; y += dy;
        }
    }
    return squares;
}
export function positionalFacts(fen: string, uci: string, branch: string, scope: string, history?: BoardHistory): PositionalFact[] {
    const before = new Chess(fen), after = new Chess(fen), move = playUci(after, uci);
    const side = colorName(move.color), piece = pieceNames[move.piece], facts: PositionalFact[] = [];
    const context = buildBoardContext(fen, history), identity = context.pieces.find(p => p.square === move.from)?.id ?? `${move.color}${move.piece}:${move.from}`;
    const add = (kind: PositionalFact['kind'], suffix: string, effect: string, benefit: string, squares: Square[], rank: number, pieceId = identity) => facts.push({ id: `${branch}.${kind}${suffix}`, kind, branch, scope, effect, benefit, text: `${effect} ${benefit}`, evidence: 'legal-before-after', squares, rank, pieceId });
    const homeRank = move.color === 'w' ? '1' : '8';
    const undeveloped = context.pieces.filter(p => p.color === move.color && ['b', 'n'].includes(p.type) && p.square[1] === homeRank).length;
    const original = identity === `${move.color}${move.piece}:${move.from}` && ['b', 'g', 'c', 'f'].includes(move.from[0]) && move.from[1] === homeRank;
    // Standard-start replay and identities distinguish original pieces from returned/promoted pieces.
    const neverMoved = history && !history.moves.slice(0, history.ply).some(m => m.slice(0, 2) === move.from);
    const opening = context.historyCompleteness === 'standard-start' && undeveloped >= 2 && context.inventory[move.color].p >= 6 && context.inventory[move.color].q === 1;
    const changedCenter = center.filter(square => after.attackers(square, move.color).includes(move.to) && !before.attackers(square, move.color).includes(move.from));
    if (opening && original && neverMoved && ['n', 'b'].includes(move.piece) && move.to[1] !== homeRank && (changedCenter.length || raySquares(after, move.to).length >= 3)) {
        add('development', '', `${side} brings a ${piece} into play.`, changedCenter.length ? `From ${move.to.toUpperCase()}, it helps contest the center.` : `From ${move.to.toUpperCase()}, it has more room to work.`, [move.from, move.to], 80);
    }
    if (move.piece === 'p' && center.includes(move.to)) add('center', '', `${side} places a pawn in the center on ${move.to.toUpperCase()}.`, 'That gives the pieces a central foothold to work around.', [move.to], 75);
    else if (changedCenter.length) {
        const enemyPawn = changedCenter.find(s => { const p = after.get(s); return p?.type === 'p' && p.color !== move.color; });
        const squares = (enemyPawn ? [enemyPawn] : changedCenter).map(s => s.toUpperCase()).join(' and ');
        add('center', '', `The ${piece} adds ${enemyPawn ? 'pressure to' : 'influence over'} ${squares}${enemyPawn ? `, where ${colorName(move.color === 'w' ? 'b' : 'w')} has a pawn` : ''}.`, 'This helps contest the center.', changedCenter, 70);
    }
    for (const row of before.board()) for (const p of row) {
        if (!p || p.color !== move.color || !['b', 'q'].includes(p.type) || p.square === move.from || !after.get(p.square)) continue;
        const oldRay = raySquares(before, p.square), gained = raySquares(after, p.square).filter(square => !oldRay.includes(square));
        // A cleared geometric ray must actually pass through the departed blocker.
        const through = gained.filter(square => {
            const dx = Math.sign(square.charCodeAt(0) - p.square.charCodeAt(0)), dy = Math.sign(Number(square[1]) - Number(p.square[1]));
            let x = p.square.charCodeAt(0) + dx, y = Number(p.square[1]) + dy;
            while (`${String.fromCharCode(x)}${y}` !== square) {
                if (`${String.fromCharCode(x)}${y}` === move.from) return true;
                x += dx; y += dy;
            }
            return square === move.from;
        });
        if (through.length) {
            add('opened-line', `.${p.square}`, `The move clears a line for the ${pieceNames[p.type]} on ${p.square.toUpperCase()}.`, `That gives ${side} more room to bring pieces into play.`, [p.square, move.from, ...through], p.type === 'b' ? 65 : 45, context.pieces.find(piece => piece.square === p.square)!.id);
        }
    }
    const rights = before.fen().split(' ')[2], retained = after.fen().split(' ')[2];
    for (const [right, rookFile, path, direction] of [[move.color === 'w' ? 'K' : 'k', 'h', ['f', 'g'], 'kingside'], [move.color === 'w' ? 'Q' : 'q', 'a', ['b', 'c', 'd'], 'queenside']] as const) {
        const kingSquare = `e${homeRank}` as Square, rookSquare = `${rookFile}${homeRank}` as Square;
        if (rights.includes(right) && retained.includes(right) && before.get(kingSquare)?.type === 'k' && before.get(kingSquare)?.color === move.color && before.get(rookSquare)?.type === 'r' && before.get(rookSquare)?.color === move.color && path.some(file => `${file}${homeRank}` === move.from) && !after.get(move.from)) {
            add('castling', `.${direction}`, `Clearing ${move.from.toUpperCase()} helps prepare ${direction} castling.`, `The king and rook retain that option once the path is clear and the king's route is safe.`, [move.from, kingSquare, rookSquare], 60);
        }
    }
    for (const fact of facts) {
        if (fact.kind === 'castling') fact.text = `${fact.effect.replace(/\.$/, '')} once the remaining path and king-safety conditions are satisfied.`;
        if (fact.kind === 'opened-line') fact.text = `${fact.effect.replace(/\.$/, '')}, giving ${side} more ways to bring pieces into play.`;
        if (fact.kind === 'center' && move.piece === 'p') fact.text = `${fact.effect.replace(/\.$/, '')}, giving the pieces a central foothold to work around.`;
    }
    return facts;
}
