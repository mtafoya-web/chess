import { Chess } from 'chess.js';
import { evaluation, normalizedFen, playUci } from './chess';
import type { Candidate, Evaluation } from './types';
import type { NativeEngineSnapshot } from './site-engine';

export interface NormalizedAnalysis {
    evaluation: Evaluation;
    provenance: { source: NativeEngineSnapshot['source']; fen: string; url: string; path: string; ply: number; capturedAt: number; depth: number; fingerprint: string };
    capabilities: { advice: boolean; heatmap: boolean; continuation: boolean; pairedGrading: false };
}
export interface ExpectedNativePosition { fen: string; url: string; path?: string; ply?: number; now?: number }

/** Fail closed on stale/uncorrelated page data, including plausible but illegal PVs. */
export function normalizeNativeEngine(raw: unknown, expected: ExpectedNativePosition): NormalizedAnalysis | undefined {
    try {
        if (!raw || typeof raw !== 'object') return;
        const snapshot = raw as NativeEngineSnapshot;
        const url = new URL(snapshot.url), current = new URL(expected.url);
        if (url.protocol !== 'https:' || url.hostname !== 'lichess.org' || url.origin !== current.origin || url.pathname !== current.pathname || url.search !== current.search
            || !['lichess-client', 'lichess-server'].includes(snapshot.source) || snapshot.variant !== 'standard' || snapshot.perspective !== 'white'
            || typeof snapshot.path !== 'string' || snapshot.path.length > 3000 || !Number.isSafeInteger(snapshot.ply) || snapshot.ply < 0 || snapshot.ply > 3000
            || expected.path !== undefined && snapshot.path !== expected.path || expected.ply !== undefined && snapshot.ply !== expected.ply
            || !Number.isSafeInteger(snapshot.depth) || snapshot.depth < 1 || snapshot.depth > 256
            || !Number.isFinite(snapshot.capturedAt) || Math.abs((expected.now ?? Date.now()) - snapshot.capturedAt) > 1500
            || !Array.isArray(snapshot.candidates) || !snapshot.candidates.length || snapshot.candidates.length > 5) return;
        const fen = normalizedFen(expected.fen);
        if (normalizedFen(snapshot.fen) !== fen || normalizedFen(snapshot.evaluationFen) !== fen) return;
        const candidates: Candidate[] = [];
        for (const pv of snapshot.candidates) {
            if (!pv || !Array.isArray(pv.moves) || !pv.moves.length || pv.moves.length > 24 || pv.moves.some(move => typeof move !== 'string')) return;
            const cp = typeof pv.cp === 'number' && Number.isFinite(pv.cp) && Math.abs(pv.cp) <= 100000 ? pv.cp : undefined;
            const mate = typeof pv.mate === 'number' && Number.isSafeInteger(pv.mate) && Math.abs(pv.mate) <= 1000 ? pv.mate : undefined;
            if ((cp === undefined) === (mate === undefined) || mate === 0) return;
            const board = new Chess(fen), uciPv: string[] = [], sanPv: string[] = [];
            for (const input of pv.moves) {
                // Standard Lichess uses king-to-rook-square UCI for castling.
                let uci = input;
                const castle: Record<string, string> = { e1h1: 'e1g1', e1a1: 'e1c1', e8h8: 'e8g8', e8a8: 'e8c8' };
                if (board.get(input.slice(0, 2) as 'e1')?.type === 'k' && castle[input]) uci = castle[input];
                const move = playUci(board, uci); uciPv.push(uci); sanPv.push(move.san);
            }
            if (candidates.some(candidate => candidate.uci === uciPv[0])) return;
            const winner = mate! > 0 ? 'w' : mate! < 0 ? 'b' : new Chess(fen).turn() === 'w' ? 'b' : 'w';
            candidates.push({ uci: uciPv[0], san: sanPv[0], pv: sanPv.join(' '), uciPv, sanPv, depth: snapshot.depth,
                score: cp !== undefined ? cp / 100 : winner === 'w' ? 100 : -100,
                ...(mate !== undefined ? { mate } : {}),
                engineScore: cp !== undefined ? { kind: 'cp', value: cp } : { kind: 'mate', winner, moves: Math.abs(mate!) } });
        }
        const result = evaluation(candidates);
        result.source = { kind: snapshot.source, label: `Lichess analysis · depth ${snapshot.depth}`, depth: snapshot.depth };
        const fingerprint = JSON.stringify([snapshot.source, fen, snapshot.path, snapshot.ply, snapshot.depth, candidates.map(c => [c.uciPv, c.engineScore])]);
        return { evaluation: result, provenance: { source: snapshot.source, fen, url: snapshot.url, path: snapshot.path, ply: snapshot.ply, capturedAt: snapshot.capturedAt, depth: snapshot.depth, fingerprint },
            capabilities: { advice: true, heatmap: candidates.length > 1, continuation: candidates[0].uciPv!.length > 1, pairedGrading: false } };
    } catch { return; }
}
