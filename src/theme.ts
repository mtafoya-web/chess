/** A small, serializable palette shared by the website card and extension panel. */
export interface SiteTheme {
    site: 'lichess' | 'chesscom';
    background: string;
    foreground: string;
    accent: string;
    radius: string;
    fontFamily: string;
    dark: boolean;
}
const luminance = (color: string) => {
    const rgb = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
    if (!rgb || rgb.length < 3) return 0;
    return rgb.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
        .reduce((n, v, i) => n + v * [.2126, .7152, .0722][i], 0);
};
export function readSiteTheme(board: HTMLElement, lichess: boolean, context = board.parentElement ?? document.body): SiteTheme {
    const chain: HTMLElement[] = [];
    for (let p: HTMLElement | null = context; p; p = p.parentElement) chain.push(p);
    const surface = chain.find(el => {
        const bg = getComputedStyle(el).backgroundColor;
        return bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
    }) ?? document.body;
    const style = getComputedStyle(surface);
    const sample = context.querySelector<HTMLElement>('h1, h2, h3, button, p') ?? surface;
    const textStyle = getComputedStyle(sample);
    const background = ['rgba(0, 0, 0, 0)', 'transparent', ''].includes(style.backgroundColor) ? '#262421' : style.backgroundColor;
    let foreground = textStyle.color || '#eeeeee';
    const bg = luminance(background), fg = luminance(foreground);
    if ((Math.max(bg, fg) + .05) / (Math.min(bg, fg) + .05) < 4.5) foreground = bg > .179 ? '#242424' : '#eeeeee';
    return { site: lichess ? 'lichess' : 'chesscom', background, foreground,
        accent: lichess ? (bg > .179 ? '#45721a' : '#8fbb5b') : (bg > .179 ? '#496f24' : '#a0c66a'),
        radius: lichess ? '4px' : '8px', fontFamily: textStyle.fontFamily || 'system-ui, sans-serif', dark: bg <= .179 };
}
export function isSiteTheme(value: unknown): value is SiteTheme {
    if (!value || typeof value !== 'object') return false;
    const t = value as SiteTheme;
    return ['lichess', 'chesscom'].includes(t.site) && typeof t.dark === 'boolean' &&
        [t.background, t.foreground, t.accent].every(color => typeof color === 'string' && /^(#[a-f\d]{3,8}|rgba?\([\d.,%\s]+\))$/i.test(color)) &&
        ['4px', '8px'].includes(t.radius) && typeof t.fontFamily === 'string' && t.fontFamily.length < 500;
}
export function applySiteTheme(target: HTMLElement, theme: SiteTheme) {
    target.style.setProperty('--k-bg', theme.background);
    target.style.setProperty('--k-fg', theme.foreground);
    target.style.setProperty('--k-accent', theme.accent);
    target.style.setProperty('--k-border', `color-mix(in srgb, ${theme.foreground} 20%, transparent)`);
    target.style.setProperty('--k-radius', theme.radius);
    target.style.setProperty('--k-gold', theme.dark ? '#d5b45d' : '#98701e');
    target.style.fontFamily = theme.fontFamily;
    target.style.colorScheme = theme.dark ? 'dark' : 'light';
    target.dataset.site = theme.site;
}
