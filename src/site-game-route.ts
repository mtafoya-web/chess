/** Lichess player URLs may include a private four-character suffix. */
export function parseLichessGameUrl(value: string | URL): { gameId: string; canonicalUrl: string; publicUrl: string } | undefined {
    try {
        const url = new URL(value);
        if (url.origin !== 'https://lichess.org' || /^\/(?:analysis|study|practice|training)(?:\/|$)/.test(url.pathname)) return;
        const match = /^\/(?:game\/)?([a-zA-Z0-9]{8})(?:[a-zA-Z0-9]{4})?(?:\/(white|black))?(\/analysis)?\/?$/.exec(url.pathname);
        if (!match) return;
        const publicUrl = new URL(url.href);
        publicUrl.pathname = `/game/${match[1]}${match[2] ? `/${match[2]}` : ''}${match[3] ?? ''}`;
        return { gameId: match[1], canonicalUrl: `https://lichess.org/game/${match[1]}`, publicUrl: publicUrl.href };
    } catch { return; }
}
