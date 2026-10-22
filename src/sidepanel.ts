import { readableMove } from './readable-move';
import { sendBackground, isPanelMessage, isBackgroundSender } from './messages';
import './sidepanel.css';
import { normalizedFen } from './chess';
import { DEFAULT_SETTINGS, ORIGINS, type AnalysisEvent, type CloudProvider, type Settings } from './types';
import { renderMarkdown } from './markdown';
import { chromeAvailability, downloadChromeAI } from './chrome-ai';
import { applySiteTheme, themePageUrl } from './theme';
import { KIBITZ_MARK } from './wordmark';
import { explanationStatus } from './explanation-state';
import { buildExplanationFacts } from './explanation-facts';
import { renderExplanation } from './coach-prompt';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
document.querySelector('header .brand')!.innerHTML = `${KIBITZ_MARK}<span>Kibitz</span>`;
const provider = element<HTMLSelectElement>('provider');
const model = element<HTMLInputElement>('model');
const key = element<HTMLInputElement>('key');
const cloudProvider = element<HTMLSelectElement>('cloud-provider');
const ollamaModel = element<HTMLInputElement>('ollama-model');
const saved = element('saved'), status = element('status');
let settings: Settings = structuredClone(DEFAULT_SETTINGS);
let selected: CloudProvider = 'gemini';
let configured: Record<CloudProvider, boolean> = { gemini: false, openai: false, groq: false };
let replacements: Partial<Record<CloudProvider, string | null>> = {};
let manualId = '', manualText = '', manualFen = '';
const manualResult = element('manual-result');
const send = sendBackground;
let port: chrome.runtime.Port;
function connect() {
    port = chrome.runtime.connect({ name: 'panel' });
    port.onMessage.addListener((event: AnalysisEvent & { manual: boolean }) => {
        if (!isPanelMessage(event)) return;
        if (receiveTheme(event)) return;
        if (event.type.startsWith('REVIEW_')) return;
        if (!event.manual) {
            if (event.type === 'EXPLANATION_STATE') status.textContent = explanationStatus(event);
            if (event.type === 'STATUS' || event.type === 'ERROR') status.textContent = event.text;
            if (event.type === 'ENGINE_RESULT') status.textContent = event.result.terminal ?? 'Analysis appears beside the board.';
            return;
        }
        if (event.requestId !== manualId) return;
        if (event.type === 'EXPLANATION_STATE' && event.fen === manualFen) status.textContent = explanationStatus(event);
        if (event.type === 'ENGINE_RESULT') {
            manualResult.replaceChildren();
            const heading = document.createElement('h2');
            heading.textContent = event.result.terminal ?? `${event.result.candidates[0] ? readableMove(manualFen, event.result.candidates[0].uci) : 'No move'} · ${event.result.evaluation}`;
            const paragraph = document.createElement('p');
            paragraph.textContent = renderExplanation(buildExplanationFacts(manualFen, event.result));
            manualResult.append(heading, paragraph);
        }
        if (event.type === 'STREAM_CHUNK') { manualText += event.textDelta; const p = manualResult.querySelector('p'); if (p) renderMarkdown(p, manualText); }
        if (event.type === 'STATUS' || event.type === 'ERROR') { status.textContent = event.text; }
    });
    port.onDisconnect.addListener(() => { status.textContent = 'Reconnecting…'; setTimeout(connect, 1000); });
}
function display() {
    provider.value = settings.provider;
    element<HTMLSelectElement>('analysis-source').value = settings.analysisSource ?? 'auto';
    selected = settings.provider !== 'auto' && settings.provider !== 'chrome' && settings.provider !== 'ollama' ? settings.provider : settings.cloudProvider;
    cloudProvider.value = selected;
    model.value = settings.models[selected]; key.value = replacements[selected] ?? '';
    const state = document.getElementById('key-state');
    if (state) state.textContent = replacements[selected] === null ? 'Saved key will be removed.' : configured[selected] ? 'A key is saved on this device. Enter a key to replace it.' : 'No key saved on this device.';
    const remove = document.getElementById('remove-key') as HTMLButtonElement | null;
    if (remove) remove.disabled = !configured[selected] && !replacements[selected];
    ollamaModel.value = settings.models.ollama;
    element('ollama-settings').hidden = settings.provider !== 'auto' && settings.provider !== 'ollama';
    if (settings.provider === 'ollama') element<HTMLDetailsElement>('ollama-settings').open = true;
    element('cloud-settings').hidden = settings.provider === 'chrome' || settings.provider === 'ollama';
    cloudProvider.disabled = settings.provider !== 'auto';
    if (!['auto', 'chrome', 'ollama'].includes(settings.provider)) element<HTMLDetailsElement>('cloud-settings').open = true;
    updateOllamaCommands();
}
function capture() {
    settings.analysisSource = element<HTMLSelectElement>('analysis-source').value as Settings['analysisSource'];
    settings.models[selected] = model.value.trim();
    if (key.value.trim()) replacements[selected] = key.value.trim();
    settings.models.ollama = ollamaModel.value.trim();
}
provider.addEventListener('change', () => {
    capture(); settings.provider = provider.value as Settings['provider']; display();
});
cloudProvider.addEventListener('change', () => {
    capture(); settings.cloudProvider = cloudProvider.value as CloudProvider; display();
});
element<HTMLFormElement>('settings').addEventListener('submit', async event => {
    event.preventDefault(); saved.textContent = '';
    try {
        const usesCloud = settings.provider === 'auto' || !['chrome', 'ollama'].includes(settings.provider);
        if (usesCloud && settings.provider !== 'auto' && !key.value.trim() && (!configured[selected] || replacements[selected] === null)) throw new Error('Enter an API key.');
        if ((settings.provider === 'auto' || settings.provider === 'ollama') && !ollamaModel.value.trim()) throw new Error('Enter an Ollama model.');
        if (usesCloud && (key.value.trim() || configured[selected] && replacements[selected] !== null)) {
            if (!model.value.trim()) throw new Error('Enter a cloud model.');
            const permitted = await chrome.permissions.request({ origins: [ORIGINS[selected]] });
            if (!permitted) throw new Error('Provider access was not granted.');
        }
        capture(); settings.cloudProvider = selected;
        const response = await send({ type: 'SAVE_SETTINGS', settings, credentials: replacements });
        if (response?.error) throw new Error(response.error);
        settings = response.settings; configured = response.configured; replacements = {}; display();
        saved.textContent = 'Settings saved. New explanations use this setup.'; await send({ type: 'SETTINGS_CHANGED' });
    } catch (error) { saved.textContent = error instanceof Error ? error.message : 'Could not save settings.'; }
});
const setup = element<HTMLButtonElement>('chrome-setup');
const chromeStatus = element('chrome-status');
async function checkChrome() {
    const availability = await chromeAvailability();
    setup.disabled = availability === 'available';
    setup.textContent = availability === 'unavailable' ? 'Check availability again' : availability === 'available' ? 'Chrome AI ready' : availability === 'downloading' ? 'Show download progress' : 'Enable Chrome AI';
    chromeStatus.textContent = availability === 'available' ? 'Ready for local explanations. No API key needed.' : availability === 'unavailable' ? 'Unavailable on this browser or device. Automatic will try Ollama next.' : availability === 'downloading' ? 'Model download is in progress.' : 'Download the local model once to enable free, offline explanations.';
}
setup.addEventListener('click', async () => {
    if (await chromeAvailability() === 'unavailable') { await checkChrome(); return; }
    setup.disabled = true; chromeStatus.textContent = 'Preparing Chrome AI…';
    try {
        await downloadChromeAI(percent => { chromeStatus.textContent = `Downloading Chrome AI: ${percent}%`; });
        await checkChrome(); await send({ type: 'SETTINGS_CHANGED' });
    } catch (error) {
        chromeStatus.textContent = error instanceof Error ? error.message : 'Could not prepare Chrome AI. Try again.';
        setup.disabled = false;
    }
});
void checkChrome();
element('reopen').addEventListener('click', () => { void send({ type: 'REOPEN' }).then(response => { if (response?.error) status.textContent = 'Open or refresh a supported chess page first.'; }); });
element<HTMLFormElement>('manual').addEventListener('submit', async event => {
    event.preventDefault();
    try {
        const fen = normalizedFen(element<HTMLTextAreaElement>('fen').value);
        manualId = crypto.randomUUID(); manualText = ''; manualFen = fen; manualResult.textContent = 'Finding a move…';
        const response = await send({ type: 'ANALYSIS_REQUEST', requestId: manualId, fen, orientation: 'white', manual: true });
        if (response?.error) throw new Error(response.error);
    } catch (error) { manualResult.textContent = error instanceof Error ? error.message : 'Invalid position.'; }
});
document.getElementById('remove-key')?.addEventListener('click', () => { replacements[selected] = null; key.value = ''; display(); });
void send({ type: 'GET_SETTINGS' }).then(response => {
    if (response?.error) { saved.textContent = response.error; return; }
    settings = response.settings; configured = response.configured; display();
}).catch(() => { saved.textContent = 'Could not load settings.'; });
element('diagnostics').textContent = `Extension origin: chrome-extension://${chrome.runtime.id} · Stockfish 17.1 · single-threaded WASM`;
connect();
void send({ type: 'REOPEN' }).catch(() => {});

async function startPageReview(pgn?: string) {
    const reviewStatus = element('review-status');
    reviewStatus.textContent = pgn ? 'Checking PGN against the website board…' : 'Loading the selected completed game…';
    try {
        const response = await send(pgn === undefined ? { type: 'START_PAGE_REVIEW' } : { type: 'IMPORT_PAGE_REVIEW', pgn });
        if (response?.error) throw new Error(response.error);
        reviewStatus.textContent = `Review started on the website: ${response.title ?? 'selected game'}. Use the site's move controls. You can close this panel.`;
    } catch (error) { reviewStatus.textContent = error instanceof Error ? error.message : 'Could not start review on this page.'; }
}
element('capture-game').addEventListener('click', () => { void startPageReview(); });
element<HTMLFormElement>('pgn-form').addEventListener('submit', event => { event.preventDefault(); void startPageReview(element<HTMLTextAreaElement>('review-pgn').value); });
element<HTMLInputElement>('pgn-file').addEventListener('change', async event => {
    const input = event.target as HTMLInputElement, file = input.files?.[0];
    if (!file) return;
    try {
        if (file.size > 262144) throw new Error('Choose a PGN smaller than 256 KiB.');
        const pgn = await file.text(); element<HTMLTextAreaElement>('review-pgn').value = pgn; await startPageReview(pgn);
    } catch (error) { element('review-status').textContent = error instanceof Error ? error.message : 'Could not read the PGN.'; }
    input.value = '';
});


let themeRequest = 0;
let themeLocked = false;
let themePage = '';
let themeTabId: number | undefined;
const themePageKey = (tab: { id?: number; url?: string }) => `${tab.id ?? -1}:${themePageUrl(tab.url ?? '')}`;
function clearPanelTheme() {
    const target = document.documentElement;
    for (const key of ['--k-bg', '--k-fg', '--k-accent', '--k-border', '--k-radius', '--k-gold', 'font-family', 'color-scheme']) target.style.removeProperty(key);
    target.style.colorScheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    delete target.dataset.site;
    element('theme-label').textContent = 'Using your system theme';
}
function receiveTheme(message: unknown): boolean {
    if (!isPanelMessage(message) || message.type !== 'SITE_THEME') return false;
    if (themePageKey({id:message.tabId,url:message.url}) !== themePage) return true;
    themeRequest++;
    if (themeLocked) return true;
    const theme = message.theme;
    if (theme) {
        applySiteTheme(document.documentElement, theme);
        themeLocked = true;
        element('theme-label').textContent = `Matched to ${theme.site === 'lichess' ? 'Lichess' : 'Chess.com'} · ${theme.dark ? 'dark' : 'light'}`;
    } else clearPanelTheme();
    return true;
}
async function refreshTheme() {
    const request = ++themeRequest;
    themeLocked = false; themePage = '';
    try {
        const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (request !== themeRequest) return;
        themeTabId = tabs[0]?.id;
        themePage = themePageKey(tabs[0] ?? {});
        const response = await send({ type: 'GET_SITE_THEME' });
        if (request !== themeRequest) return;
        if (response?.tabId === undefined) receiveTheme({ type: 'SITE_THEME', tabId:themeTabId ?? -1, url:tabs[0]?.url ?? '' });
        else receiveTheme({ ...response, type: 'SITE_THEME' });
    } catch {
        if (request === themeRequest) clearPanelTheme();
    }
}
chrome.runtime.onMessage.addListener((message, sender) => { if (isBackgroundSender(sender) && isPanelMessage(message)) receiveTheme(message); });
chrome.tabs.onActivated.addListener(() => { void refreshTheme(); });
chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (tabId !== themeTabId) return;
    if (info.status !== 'complete' && !info.url) return;
    if (info.status !== 'complete' && themePageKey({id:tabId,url:info.url}) === themePage) return;
    void refreshTheme();
});
void refreshTheme();
function updateOllamaCommands() {
    element('ollama-pull').textContent = `ollama pull ${ollamaModel.value.trim() || 'qwen3:4b'}`;
    element('ollama-command').textContent = `$env:OLLAMA_ORIGINS="chrome-extension://${chrome.runtime.id}"; ollama serve`;
}
ollamaModel.addEventListener('input', updateOllamaCommands);
element('copy-ollama').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(element('ollama-command').textContent ?? ''); element('ollama-status').textContent = 'Server command copied. Run it in PowerShell.'; }
    catch { element('ollama-status').textContent = 'Select and copy the server command above.'; }
});
element('check-ollama').addEventListener('click', async () => {
    const button = element<HTMLButtonElement>('check-ollama'), text = element('ollama-status');
    button.disabled = true; text.textContent = 'Checking local Ollama server…';
    try {
        const response = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw new Error(`Ollama returned ${response.status}. Check its allowed extension origin.`);
        const result = await response.json() as {models?: {name?:string;model?:string}[]};
        const chosen = ollamaModel.value.trim();
        const found = result.models?.some(m => [m.name, m.model].some(name => name === chosen || name === `${chosen}:latest`));
        text.textContent = found ? `Connected. ${chosen} is installed. Save settings to use it.` : `Connected, but ${chosen || 'your chosen model'} is not installed. Run the pull command above.`;
    } catch (error) { text.textContent = error instanceof Error && error.message.startsWith('Ollama returned') ? error.message : 'Cannot reach Ollama. Start its server with the allowed-origin command above, then try again.'; }
    finally { button.disabled = false; }
});
