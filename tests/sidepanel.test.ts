// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/types';
import { DEFAULT_POSITION } from 'chess.js';
import { evaluation } from '../src/chess';
vi.mock('../src/chrome-ai', () => ({ chromeAvailability: vi.fn(async () => 'unavailable'), downloadChromeAI: vi.fn() }));
const storageSet = vi.fn(async () => {});
let configured = { gemini: true, openai: false, groq: false };
const sendMessage = vi.fn(async (message: {type: string; settings?: unknown; credentials?: Record<string, string | null>}) => {
    if (message.type === 'GET_SETTINGS') return { settings: structuredClone(DEFAULT_SETTINGS), configured: { ...configured } };
    if (message.type === 'SAVE_SETTINGS') {
        for (const [provider, value] of Object.entries(message.credentials ?? {})) configured[provider as keyof typeof configured] = value !== null;
        return { settings: message.settings, configured: { ...configured } };
    }
    return {};
});
const listeners: ((message: unknown) => void)[] = [];
let activate: () => void;
let updateTab: (id: number, info: { status?: string; url?: string }) => void;
beforeEach(async () => {
    vi.resetModules(); storageSet.mockClear(); sendMessage.mockClear(); configured = { gemini: true, openai: false, groq: false }; listeners.length = 0;
    document.documentElement.innerHTML = readFileSync('sidepanel.html', 'utf8').replace(/<script[^>]*>[\s\S]*?<\/script>/g, '');
    const event = { addListener: vi.fn() };
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
    vi.stubGlobal('chrome', {runtime: {id:'kibitz-test', sendMessage, connect:() => ({onMessage:{addListener:(fn: (m:unknown)=>void) => listeners.push(fn)}, onDisconnect:event}), onMessage:event},
        storage:{sync:{get:async () => ({settings:structuredClone(DEFAULT_SETTINGS)}),set:storageSet}},
        permissions:{request:vi.fn(async () => true)}, tabs:{query:async () => [{id:12,url:'https://lichess.org/analysis'}],onActivated:{addListener:(fn:typeof activate)=>{activate=fn;}},onUpdated:{addListener:(fn:typeof updateTab)=>{updateTab=fn;}}}});
    await import('../src/sidepanel');
    await new Promise(resolve => setTimeout(resolve, 0));
});
afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });
it('keeps verified manual-position commentary when the AI explanation fails', () => {
    (document.getElementById('fen') as HTMLTextAreaElement).value = DEFAULT_POSITION;
    document.getElementById('manual')!.dispatchEvent(new Event('submit', {bubbles:true,cancelable:true}));
    const request = sendMessage.mock.calls.find(([message]) => message.type === 'ANALYSIS_REQUEST')![0] as unknown as {requestId:string};
    const base = {requestId:request.requestId,tabId:12,manual:true};
    listeners[0]({...base,type:'ENGINE_RESULT',result:evaluation([{uci:'e2e4',san:'e4',pv:'e4',score:0.2}])});
    const paragraph = document.querySelector('#manual-result p')!;
    const verified = paragraph.textContent;
    expect(verified).toContain('White places a pawn in the center on E4');
    listeners[0]({...base,type:'EXPLANATION_STATE',fen:DEFAULT_POSITION,state:'failed'});
    expect(paragraph.textContent).toBe(verified);
    expect(document.getElementById('status')!.textContent).toContain('Verified feedback is still available');
});
it('starts local-first with optional cloud collapsed and saves suggestion source', async () => {
    const provider = document.getElementById('provider') as HTMLSelectElement;
    expect(provider.value).toBe('auto');
    expect((document.getElementById('cloud-settings') as HTMLDetailsElement).open).toBe(false);
    expect(document.getElementById('chrome-status')!.textContent).toContain('Unavailable');
    const source = document.getElementById('analysis-source') as HTMLSelectElement;
    source.value = 'local';
    document.getElementById('settings')!.dispatchEvent(new Event('submit', {bubbles:true,cancelable:true}));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(sendMessage).toHaveBeenCalledWith({ type: 'SAVE_SETTINGS', settings: expect.objectContaining({provider:'auto',analysisSource:'local'}), credentials: {} });
    expect(storageSet).not.toHaveBeenCalled();
});
it('opens the chosen provider setup and shares the active website theme', () => {
    const provider = document.getElementById('provider') as HTMLSelectElement;
    provider.value = 'ollama'; provider.dispatchEvent(new Event('change'));
    expect((document.getElementById('ollama-settings') as HTMLDetailsElement).open).toBe(true);
    expect(document.getElementById('cloud-settings')!.hidden).toBe(true);
    expect(document.getElementById('ollama-command')!.textContent).toContain('chrome-extension://kibitz-test');
    listeners[0]({type:'SITE_THEME',theme:{site:'lichess',background:'rgb(20, 20, 20)',foreground:'#eeeeee',accent:'#a0c66a',radius:'4px',fontFamily:'sans-serif',dark:true}});
    expect(document.documentElement.style.getPropertyValue('--k-bg')).toBe('rgb(20, 20, 20)');
    expect(document.getElementById('theme-label')!.textContent).toContain('Lichess · dark');
});

it('keeps the matched palette until arrival at another page', async () => {
    listeners[0]({type:'SITE_THEME',theme:{site:'chesscom',background:'#262421',foreground:'#eeeeee',accent:'#a0c66a',radius:'8px',fontFamily:'sans-serif',dark:true}});
    expect(document.documentElement.style.getPropertyValue('--k-bg')).toBe('#262421');
    listeners[0]({type:'SITE_THEME'});
    listeners[0]({type:'SITE_THEME',theme:{site:'chesscom',background:'#ffffff',foreground:'#222222',accent:'#496f24',radius:'8px',fontFamily:'serif',dark:false}});
    expect(document.documentElement.style.getPropertyValue('--k-bg')).toBe('#262421');
    updateTab(99, {status:'complete'}); await new Promise(resolve => setTimeout(resolve, 0));
    expect(document.documentElement.style.getPropertyValue('--k-bg')).toBe('#262421');
    activate(); await new Promise(resolve => setTimeout(resolve, 0));
    expect(document.documentElement.style.getPropertyValue('--k-bg')).toBe('');
    expect(document.documentElement.style.getPropertyValue('--k-gold')).toBe('');
    expect(document.documentElement.style.fontFamily).toBe('');
    expect(document.documentElement.style.colorScheme).toBe('light');
    expect(document.documentElement.dataset.site).toBeUndefined();
    expect(document.getElementById('theme-label')!.textContent).toContain('system theme');
});
it('allows the first late website palette and rematches on active-page reload', async () => {
    const theme = {site:'lichess',background:'#181818',foreground:'#eeeeee',accent:'#a0c66a',radius:'4px',fontFamily:'sans-serif',dark:true};
    listeners[0]({type:'SITE_THEME',theme});
    expect(document.documentElement.style.colorScheme).toBe('dark');
    updateTab(12, {status:'complete'}); await new Promise(resolve => setTimeout(resolve, 0));
    listeners[0]({type:'SITE_THEME',theme:{...theme,background:'#fafafa',dark:false}});
    expect(document.documentElement.style.getPropertyValue('--k-bg')).toBe('#fafafa');
});
it('ignores move hashes but unlocks on navigation within the website', async () => {
    const theme = {site:'lichess',background:'#181818',foreground:'#eeeeee',accent:'#a0c66a',radius:'4px',fontFamily:'sans-serif',dark:true};
    listeners[0]({type:'SITE_THEME',theme});
    updateTab(12, {url:'https://lichess.org/analysis#12'}); await new Promise(resolve => setTimeout(resolve, 0));
    listeners[0]({type:'SITE_THEME',theme:{...theme,background:'#fafafa',dark:false}});
    expect(document.documentElement.style.getPropertyValue('--k-bg')).toBe('#181818');
    updateTab(12, {url:'https://lichess.org/another-game'}); await new Promise(resolve => setTimeout(resolve, 0));
    listeners[0]({type:'SITE_THEME',theme:{...theme,background:'#fafafa',dark:false}});
    expect(document.documentElement.style.getPropertyValue('--k-bg')).toBe('#fafafa');
});
it('loads flags without filling saved keys and preserves, replaces, and removes credentials explicitly', async () => {
    const key = document.getElementById('key') as HTMLInputElement;
    const form = document.getElementById('settings')!;
    const submit = async () => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await new Promise(resolve => setTimeout(resolve, 0));
    };
    expect(key.value).toBe('');
    expect(document.getElementById('key-state')!.textContent).toContain('A key is saved');
    await submit();
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'SAVE_SETTINGS', credentials: {} }));
    key.value = 'replacement-secret'; await submit();
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'SAVE_SETTINGS', credentials: { gemini: 'replacement-secret' } }));
    expect(key.value).toBe('');
    (document.getElementById('remove-key') as HTMLButtonElement).click();
    await submit();
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'SAVE_SETTINGS', credentials: { gemini: null } }));
    expect(document.getElementById('key-state')!.textContent).toContain('No key saved');
    expect(chrome.permissions.request).toHaveBeenCalled();
});
