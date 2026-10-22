import { Chess } from 'chess.js';
import { normalizedFen } from './chess';
import type { ReviewSession, ReviewSource } from './review-types';

export const MAX_REVIEW_PLIES = 1500;
export const MAX_PGN_LENGTH = 256 * 1024;
const results = ['1-0', '0-1', '1/2-1/2', '*'];

export function sessionFromMoves(sans: string[], initialFen?: string, source?: ReviewSource, result = '*'): ReviewSession {
    if (!Array.isArray(sans) || !sans.length || sans.length > MAX_REVIEW_PLIES) throw new Error('Provide a complete game with 1 to 1500 moves.');
    if (!results.includes(result)) throw new Error('Invalid game result.');
    const chess = new Chess(initialFen ? normalizedFen(initialFen) : undefined);
    const initial = chess.fen();
    const moves = Array.from(sans).map((san, index) => {
        if (typeof san !== 'string' || san.length > 32) throw new Error('Invalid game move.');
        const beforeFen = chess.fen();
        const move = chess.move(san);
        return { ply: index + 1, san: move.san, uci: `${move.from}${move.to}${move.promotion ?? ''}`, color: move.color, beforeFen, afterFen: chess.fen() };
    });
    return { id: crypto.randomUUID(), title: 'Game review', initialFen: initial, result, moves, selectedPly: 0, ...(source ? { source } : {}) };
}

export function sessionFromPgn(pgn: string, source?: ReviewSource): ReviewSession {
    if (typeof pgn !== 'string' || !pgn.trim() || pgn.length > MAX_PGN_LENGTH) throw new Error('Paste one PGN game smaller than 256 KiB.');
    // Multiple games are ambiguous; a second header section after movetext is not a single review.
    if (/\d\.[\s\S]*\n\s*\[Event\s/.test(pgn)) throw new Error('Import one game at a time.');
    const chess = new Chess();
    chess.loadPgn(pgn, { strict: true });
    const headers = chess.getHeaders();
    if (headers.Variant && !/^(standard|chess|normal)$/i.test(headers.Variant)) throw new Error('Only standard chess is supported.');
    const session = sessionFromMoves(chess.history(), headers.FEN, source, headers.Result ?? '*');
    const white = headers.White?.slice(0, 80), black = headers.Black?.slice(0, 80);
    if (white && black) session.title = `${white} vs ${black}`;
    return session;
}

export function fenAt(session: ReviewSession, ply: number): string {
    if (!Number.isInteger(ply) || ply < 0 || ply > session.moves.length) throw new Error('Move number is outside this game.');
    return ply === 0 ? session.initialFen : session.moves[ply - 1].afterFen;
}
