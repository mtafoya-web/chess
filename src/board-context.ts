import { Chess, DEFAULT_POSITION, type Color, type PieceSymbol, type Square } from 'chess.js';
import { normalizedFen, playUci } from './chess';
import { colorName, pieceNames } from './piece-names';
export { colorName, pieceNames } from './piece-names';

export interface BoardHistory { sessionId: string; initialFen: string; moves: string[]; ply: number }
export interface ContextPiece { id: string; color: Color; type: PieceSymbol; square: Square }
export interface CaptureFact { ply: number; by: ContextPiece; captured: ContextPiece; square: Square }
export interface PromotionFact { ply: number; pieceId: string; origin: Square; square: Square; color: Color; to: PieceSymbol }
export interface ContextMove { ply: number; uci: string; color: Color; piece: PieceSymbol; from: Square; to: Square; beforeFen: string; afterFen: string; captured?: ContextPiece; promotion?: PieceSymbol; castle?: 'king' | 'queen' }
export interface BoardContext {
    schemaVersion: 1; key: string; sessionId?: string; ply?: number; fen: string;
    historyCompleteness: 'standard-start' | 'custom-start' | 'position-only';
    turn: Color; fullmove: number; castling: string; enPassant: string; terminal?: string;
    pieces: ContextPiece[]; inventory: Record<Color, Record<PieceSymbol, number>>;
    captures: CaptureFact[]; promotions: PromotionFact[]; played?: ContextMove;
}
export const namedPiece = (piece: Pick<ContextPiece, 'color' | 'type' | 'square'>) => `${colorName(piece.color)}'s ${pieceNames[piece.type]} on ${piece.square}`;

/** Replays the selected prefix. The model never maintains occupancy or capture memory. */
export function buildBoardContext(fen: string, history?: BoardHistory): BoardContext {
    const expected = normalizedFen(fen);
    const initial = history ? normalizedFen(history.initialFen) : expected;
    if (history && (!Number.isInteger(history.ply) || history.ply < 0 || history.ply > history.moves.length || history.moves.length > 2000)) throw new Error('Invalid board history.');
    const board = new Chess(initial);
    const pieces = new Map<Square, ContextPiece>();
    for (const row of board.board()) for (const p of row) if (p) pieces.set(p.square, { id: `${p.color}${p.type}:${p.square}`, ...p });
    const captures: CaptureFact[] = [], promotions: PromotionFact[] = [];
    let played: ContextMove | undefined;
    for (let index = 0; index < (history?.ply ?? 0); index++) {
        const beforeFen = board.fen(), move = playUci(board, history!.moves[index]);
        const piece = pieces.get(move.from);
        if (!piece) throw new Error('Missing moving piece.');
        const captureSquare = (move.isEnPassant() ? `${move.to[0]}${move.from[1]}` : move.to) as Square;
        const captured = pieces.get(captureSquare);
        if (move.captured) {
            if (!captured || captured.color === piece.color || captured.type !== move.captured) throw new Error('Capture history mismatch.');
            captures.push({ ply: index + 1, by: { ...piece }, captured: { ...captured }, square: captureSquare });
            pieces.delete(captureSquare);
        }
        pieces.delete(move.from);
        if (move.isKingsideCastle() || move.isQueensideCastle()) {
            const rank = move.from[1], from = `${move.isKingsideCastle() ? 'h' : 'a'}${rank}` as Square;
            const to = `${move.isKingsideCastle() ? 'f' : 'd'}${rank}` as Square, rook = pieces.get(from);
            if (!rook || rook.type !== 'r' || rook.color !== move.color) throw new Error('Castling history mismatch.');
            pieces.delete(from); pieces.set(to, { ...rook, square: to });
        }
        if (move.promotion) promotions.push({ ply: index + 1, pieceId: piece.id, origin: piece.id.split(':')[1] as Square, square: move.to, color: move.color, to: move.promotion });
        pieces.set(move.to, { ...piece, type: move.promotion ?? piece.type, square: move.to });
        played = { ply: index + 1, uci: history!.moves[index], color: move.color, piece: move.piece, from: move.from, to: move.to, beforeFen, afterFen: board.fen(), captured: captured && move.captured ? { ...captured } : undefined, promotion: move.promotion, castle: move.isKingsideCastle() ? 'king' : move.isQueensideCastle() ? 'queen' : undefined };
    }
    if (board.fen() !== expected) throw new Error('Selected history does not match the board.');
    const inventory = { w: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 } };
    for (const p of pieces.values()) inventory[p.color][p.type]++;
    const fields = expected.split(' ');
    return { schemaVersion: 1, key: JSON.stringify([1, history?.sessionId, initial, history?.moves.slice(0, history.ply) ?? null, expected]), sessionId: history?.sessionId, ply: history?.ply, fen: expected,
        historyCompleteness: history ? initial === DEFAULT_POSITION ? 'standard-start' : 'custom-start' : 'position-only',
        turn: board.turn(), fullmove: Number(fields[5]), castling: fields[2], enPassant: fields[3], terminal: board.isCheckmate() ? 'Checkmate' : board.isStalemate() ? 'Stalemate' : board.isDraw() ? 'Draw' : undefined,
        pieces: [...pieces.values()], inventory, captures, promotions, played };
}
