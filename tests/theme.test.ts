// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { readSiteTheme, applySiteTheme, isSiteTheme } from '../src/theme';
afterEach(() => document.body.replaceChildren());
it('shares a website palette with the settings surface and follows dark/light changes', () => {
    document.body.innerHTML = '<section style="background:rgb(24,24,24);color:rgb(230,230,230)"><button style="color:rgb(230,230,230)">Next</button><div id="board"></div></section>';
    const board = document.getElementById('board')!, context = board.parentElement!;
    const dark = readSiteTheme(board, true);
    expect(isSiteTheme(dark)).toBe(true); expect(dark.dark).toBe(true);
    const target = document.createElement('div'); applySiteTheme(target, dark);
    expect(target.dataset.site).toBe('lichess');
    expect(target.style.getPropertyValue('--k-bg')).toBe('rgb(24, 24, 24)');
    expect(target.style.colorScheme).toBe('dark');
    expect(target.style.getPropertyValue('--k-gold')).toBe('#d5b45d');
    expect(target.style.getPropertyValue('--k-radius')).toBe('4px');
    context.style.background = 'rgb(250,250,250)';
    const light = readSiteTheme(board, true);
    expect(light.dark).toBe(false); expect(light.foreground).toBe('#242424');
    applySiteTheme(target, light); expect(target.style.colorScheme).toBe('light');
    expect(target.style.getPropertyValue('--k-gold')).toBe('#98701e');
});
it('rejects malformed messages rather than applying arbitrary CSS', () => {
    expect(isSiteTheme(null)).toBe(false);
    expect(isSiteTheme({site:'other'})).toBe(false);
    const board = document.createElement('div'); document.body.append(board);
    const valid = readSiteTheme(board, false);
    expect(isSiteTheme({...valid, background:'url(https://example.org)'})).toBe(false);
    expect(isSiteTheme({...valid, accent:'red;position:fixed'})).toBe(false);
    expect(isSiteTheme({...valid, dark:'false'})).toBe(false);
});
