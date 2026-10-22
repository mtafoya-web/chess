// Chrome serializes this function into the site's MAIN world. Keep it completely
// self-contained: it reads the board's own chess state, and returns only a FEN.
export function readPageFen(): string | undefined {
    type Board = Element & { game?: { getFEN?: () => unknown } };
    try {
        if (location.hostname === 'www.chess.com') {
            const board = document.querySelector<Board>('wc-chess-board, chess-board');
            const value = board?.game?.getFEN?.();
            return typeof value === 'string' && value.length <= 200 ? value : undefined;
        }
        if (location.hostname === 'lichess.org') {
            type AnalysisSite = { analysis?: { node?: { fen?: unknown } } };
            const global = window as Window & { site?: AnalysisSite; lichess?: AnalysisSite };
            const value = global.site?.analysis?.node?.fen ?? global.lichess?.analysis?.node?.fen;
            return typeof value === 'string' && value.length <= 200 ? value : undefined;
        }
        return undefined;
    } catch { return undefined; }
}
