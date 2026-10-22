// Focused theme check only: no engine, provider, game review or full browser smoke suite.
// Prepare extension pages with: node node_modules/vite/bin/vite.js build --emptyOutDir false
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import assert from 'node:assert/strict';

const profile = await mkdtemp(join(tmpdir(), 'kibitz-theme-'));
const port = 19444;
const browser = spawn(process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-features=DisableLoadExtensionCommandLineSwitch', `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`, `--load-extension=${resolve('dist')}`, 'about:blank',
], { windowsHide: true, stdio: 'ignore' });
let browserError;
browser.on('error', error => { browserError = error; });
const sockets = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(work, label) {
    const end = Date.now() + 20000;
    while (Date.now() < end) {
        if (browserError) throw browserError;
        const value = await work().catch(() => undefined);
        if (value) return value;
        await wait(100);
    }
    throw new Error(`Timed out: ${label}`);
}
const targets = async () => (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
async function connect(url) {
    const socket = new WebSocket(url), pending = new Map(), events = new Map(); let next = 0;
    sockets.push(socket);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    socket.onmessage = ({data}) => {
        const result = JSON.parse(data), task = pending.get(result.id);
        if (!task) { events.get(result.method)?.(result.params); return; }
        pending.delete(result.id);
        if (result.error) task.reject(new Error(result.error.message)); else task.resolve(result.result);
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
        const id = ++next; pending.set(id, {resolve,reject}); socket.send(JSON.stringify({id,method,params}));
    });
    return {send, on:(name, handler) => events.set(name, handler), async evaluate(expression) {
        const result = await send('Runtime.evaluate', {expression,awaitPromise:true,returnByValue:true});
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
        return result.result.value;
    }};
}
try {
    const workerTarget = await until(async () => (await targets()).find(t => t.type === 'service_worker' && t.url.endsWith('/background.js')), 'extension worker');
    const worker = await connect(workerTarget.webSocketDebuggerUrl);
    await until(() => worker.evaluate(`typeof chrome?.tabs?.query==='function' && chrome.runtime.getManifest().name.startsWith('Kibitz')`), 'ready extension worker');
    const panelUrl = `chrome-extension://${new URL(workerTarget.url).host}/sidepanel.html`;
    const site = await connect((await targets()).find(t => t.type === 'page').webSocketDebuggerUrl);
    const siteUrl = 'https://lichess.org/analysis';
    site.on('Fetch.requestPaused', event => {
        void site.send('Fetch.fulfillRequest', {requestId:event.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/html'}],body:Buffer.from('<!doctype html><title>Local theme fixture</title><p>Theme preview only.</p>').toString('base64')});
    });
    await site.send('Fetch.enable', {patterns:[{urlPattern:'*'}]});
    await site.send('Page.navigate', {url:siteUrl});
    // An intercepted supported page supplies tab identity without loading a live website or a board.
    await until(() => worker.evaluate(`chrome.tabs.query({active:true,lastFocusedWindow:true}).then(t=>t[0]?.url===${JSON.stringify(siteUrl)})`), 'active fixture tab');
    const previewTab = await worker.evaluate('chrome.tabs.query({active:true,lastFocusedWindow:true}).then(t=>t[0].id)');
    const panelTarget = await site.send('Target.createTarget', {url:'about:blank',background:true});
    const page = await connect((await targets()).find(t => t.id === panelTarget.targetId).webSocketDebuggerUrl);
    const reference = await build({stdin:{contents:`import {Card} from './src/card';import {applySiteTheme} from './src/theme';globalThis.themeReference=(theme)=>{const card=new Card(()=>{});card.host.style.position='absolute';card.host.style.left='-2000px';card.host.style.width=document.querySelector('main').getBoundingClientRect().width+'px';applySiteTheme(card.host,theme);document.body.append(card.host);return card;};`,resolveDir:process.cwd(),loader:'ts'},bundle:true,format:'iife',write:false});
    for (const dark of [true, false]) {
        const theme = {site:'lichess',background:dark?'#262421':'#f7f6f2',foreground:dark?'#eeeeee':'#292825',accent:dark?'#8fbb5b':'#45721a',radius:'4px',fontFamily:'Arial, sans-serif',dark};
        await worker.evaluate(`chrome.storage.session.set({['siteTheme:'+${previewTab}]:{url:${JSON.stringify(siteUrl)},theme:${JSON.stringify(theme)}}})`);
        await page.send('Page.navigate', {url:panelUrl});
        await until(() => page.evaluate(`document.documentElement.dataset.site==='lichess' && document.documentElement.style.colorScheme===${JSON.stringify(dark?'dark':'light')}`), 'matched panel palette');
        await page.evaluate(reference.outputFiles[0].text);
        for (const width of [240, 400]) {
            await page.send('Emulation.setDeviceMetricsOverride', {width,height:900,deviceScaleFactor:1,mobile:false});
            const result = await page.evaluate(`(()=>{const card=themeReference(${JSON.stringify(theme)});const properties=['backgroundColor','color','borderTopColor','borderTopWidth','borderRadius','fontFamily','fontSize','lineHeight'];const sample=el=>Object.fromEntries(properties.map(p=>[p,getComputedStyle(el)[p]]));const result={panel:sample(document.querySelector('main')),card:sample(card.root.querySelector('article')),mark:document.querySelector('.brand svg').outerHTML===card.root.querySelector('.brand svg').outerHTML};card.host.remove();return result})()`);
            assert.deepEqual(result.panel, result.card, 'Panel must match the actual card styling');
            assert.equal(result.mark, true, 'Panel and card must share their knight mark');
            const layout = await page.evaluate(`(()=>{const rect=document.querySelector('main').getBoundingClientRect();return {left:rect.left,right:rect.right,overflow:document.documentElement.scrollWidth>innerWidth};})()`);
            assert.ok(layout.left>=0 && layout.right<=width && !layout.overflow, `Panel overflow at ${width}px`);
            const screenshot = await page.send('Page.captureScreenshot', {format:'png'});
            await writeFile(join(profile, `${dark?'dark':'light'}-${width}.png`), Buffer.from(screenshot.data, 'base64'));
        }
        console.log(`PASS: ${dark?'dark':'light'} side panel matches card palette, gold frame, typography and mark at 240px and 400px`);
    }
    console.log(`Theme screenshots: ${profile}`);
} finally {
    await Promise.all(sockets.map(socket => new Promise(resolve => {
        if (socket.readyState === WebSocket.CLOSED) { resolve(); return; }
        socket.onclose = resolve; socket.close();
    })));
    browser.kill();
}
