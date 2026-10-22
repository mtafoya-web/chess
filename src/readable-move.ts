import { Chess } from 'chess.js';
import { playUci } from './chess';
import { pieceNames } from './piece-names';

/** Human label derived from a legal move in its actual predecessor position. */
export function readableMove(fen: string, uciOrSan: string): string {
    const board = new Chess(fen), legal = board.moves({ verbose: true });
    const move = /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uciOrSan) ? playUci(board, uciOrSan) : board.move(uciOrSan);
    if (move.isKingsideCastle()) return 'Castle kingside';
    if (move.isQueensideCastle()) return 'Castle queenside';
    const piece = pieceNames[move.piece], title = piece[0].toUpperCase() + piece.slice(1);
    const ambiguous = legal.some(m => m.piece === move.piece && m.to === move.to && m.from !== move.from);
    let label = `${title}${ambiguous ? ` from ${move.from.toUpperCase()}` : ''} ${move.captured ? 'takes on' : 'to'} ${move.to.toUpperCase()}`;
    if (move.promotion) { const name = pieceNames[move.promotion]; label += `, promote to ${name[0].toUpperCase()}${name.slice(1)}`; }
    return label;
}
export const readableMoveName = readableMove;
