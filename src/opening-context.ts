import { Chess, DEFAULT_POSITION } from 'chess.js';
import { playUci } from './chess';
import type { BoardHistory } from './board-context';

export interface OpeningMatch { eco: string; name: string; ply: number; match: 'sequence' | 'transposition'; purpose?: string }
export interface AnalysisOpeningMatch {eco: string; name: string; fen: string; source: 'local-position-match'}
export interface AnalysisOpeningContext {currentPosition?: AnalysisOpeningMatch; recommendedPosition?: AnalysisOpeningMatch; pvPosition?: AnalysisOpeningMatch & {step: number}}
export interface OpeningContext { current?: OpeningMatch; entered?: OpeningMatch }
export type OpeningRow = [string, string, string, string];
type Row = OpeningRow;
export function createOpeningLookup(rows: OpeningRow[]) {
    const paths = new Map<string, Row>(), positions = new Map<string, Row[]>();
    for (const row of rows) {
        paths.set(row[2], row);
        positions.set(row[3], [...(positions.get(row[3]) ?? []), row]);
    }
    const notes: [RegExp, string][] = [
        [/Italian Game/, 'The bishop develops toward F7 while the center pawns leave room for the minor pieces.'],
        [/Ruy Lopez/, 'The bishop puts pressure on the knight that helps defend the central E5 pawn.'],
        [/Sicilian Defense/, 'Black challenges the D4 square from the side with the C-pawn.'],
        [/French Defense/, 'Black prepares a central challenge with the D-pawn behind the E6 pawn.'],
        [/Caro-Kann/, 'Black prepares to challenge the center with the D-pawn while keeping the C8 bishop unblocked by E6.'],
        [/Queen's Gambit/, 'White uses the C-pawn to challenge Black’s central D5 pawn.'],
        [/King's Knight|Open Game|King's Pawn/, 'Central pawn play and minor-piece development shape the opening.'],
    ];
    function match(row: Row, ply: number, kind: OpeningMatch['match']): OpeningMatch {
        return { eco: row[0], name: row[1], ply, match: kind, purpose: notes.find(([pattern]) => pattern.test(row[1]))?.[1] };
    }
    /** Names require a replayable standard-start history; FEN alone never establishes an opening. */
    function openingContext(fen: string, history?: BoardHistory, suggested?: string): OpeningContext {
        if (!history || new Chess(history.initialFen).fen() !== DEFAULT_POSITION || !Number.isInteger(history.ply) || history.ply < 0 || history.ply > history.moves.length) return {};
        const board = new Chess(), prefix: string[] = [];
        let current: OpeningMatch | undefined;
        const recognize = (ply: number) => {
            const exact = paths.get(prefix.join(' '));
            if (exact) { current = match(exact, ply, 'sequence'); return; }
            const candidates = positions.get(board.fen().split(' ').slice(0, 4).join(' ')) ?? [];
            // Keep a known path's family; unrelated names on the same position must not replace it.
            // A broad first-move label can resolve into a new family through a verified
            // transposition. Once a specific variation is known, keep its family.
            const family = current?.name.includes(':') ? current.name.split(':')[0] : undefined;
            const compatible = candidates.filter(row => !family || row[1].split(':')[0] === family || !row[1].includes(':'));
            if (compatible.length && new Set(compatible.map(r => r[1])).size === 1) current = match(compatible[0], ply, 'transposition');
        };
        try {
            for (const uci of history.moves.slice(0, history.ply)) { playUci(board, uci); prefix.push(uci); recognize(prefix.length); }
            if (board.fen() !== new Chess(fen).fen()) return {};
            const recognized = current;
            if (suggested) { playUci(board, suggested); prefix.push(suggested); recognize(prefix.length); }
            return { current: recognized, entered: current && current.ply === prefix.length && suggested ? current : undefined };
        } catch { return {}; }
    }
    function positionContext(fen: string, suggested?: string, pv?: string[]): AnalysisOpeningContext {
        const unique = (board: Chess): AnalysisOpeningMatch | undefined => {
            const key = board.fen().split(' ').slice(0, 4).join(' ');
            const matches = new Map((positions.get(key) ?? []).map(row => [`${row[0]}:${row[1]}`, row]));
            if (matches.size !== 1) return;
            const row = [...matches.values()][0];
            return {eco: row[0], name: row[1], fen: board.fen(), source: 'local-position-match'};
        };
        try {
            const board = new Chess(fen), currentPosition = unique(board);
            if (!suggested) return {currentPosition};
            playUci(board, suggested);
            const recommendedPosition = unique(board);
            let pvPosition: AnalysisOpeningContext['pvPosition'];
            if (pv?.[0] === suggested) {
                for (const [index, uci] of pv.slice(1, 10).entries()) {
                    try { playUci(board, uci); } catch { break; }
                    const found = unique(board);
                    if (found) {pvPosition = {...found, step: index + 1}; break;}
                }
            }
            return {currentPosition, recommendedPosition, pvPosition};
        } catch { return {}; }
    }
    return Object.assign(openingContext, {positionContext});
}
