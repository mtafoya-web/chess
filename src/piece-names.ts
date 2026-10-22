import type { Color, PieceSymbol } from 'chess.js';

export const pieceNames: Record<PieceSymbol, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
export const colorName = (color: Color) => color === 'w' ? 'White' : 'Black';
