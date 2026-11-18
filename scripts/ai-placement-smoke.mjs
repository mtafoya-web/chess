import {browserExecutable} from './browser-runtime.mjs';
// Focused placement and real Test AI check. No full browser smoke suite.
// Prepare extension pages with: node node_modules/vite/bin/vite.js build --emptyOutDir false
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import assert from 'node:assert/strict';

const profile = await mkdtemp(join(tmpdir(), 'kibitz-ai-placement-'));
const port = 19445;
const browser = spawn(browserExecutable(), [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-features=DisableLoadExtensionCommandLineSwitch', `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`, `--load-extension=${resolve('dist')}`, 'about:blank',
], { windowsHide: true, stdio: 'ignore' });
let browserError;
browser.on('error', error => { browserError = error; });
const sockets = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(work, label) {
    const end = Date.now() + 65000;
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
    const workerTarget=await until(async()=>(await targets()).find(t=>t.type==='service_worker'&&t.url.endsWith('/background.js')),'extension worker');
    const worker=await connect(workerTarget.webSocketDebuggerUrl);
    await until(()=>worker.evaluate("typeof chrome?.tabs?.query==='function' && chrome.runtime.getManifest().name.startsWith('Kibitz')"),'ready extension');
    const page=await connect((await targets()).find(t=>t.type==='page').webSocketDebuggerUrl);
    await page.send('Page.navigate',{url:`chrome-extension://${new URL(workerTarget.url).host}/sidepanel.html`});
    await until(()=>page.evaluate('document.querySelector("#diagnostics")?.textContent.includes("Extension origin")'),'ready settings controller');
    await page.evaluate('document.querySelector("#test-ai").click();true');
    const ai=await until(()=>page.evaluate('!document.querySelector("#test-ai").disabled && document.querySelector("#ai-test-status").textContent'),'real provider test');
    assert.ok(!ai.includes('Test unavailable.'),ai);
    console.log('REAL PROVIDER RESULT (no mock): '+ai);
    await writeFile(join(profile,'real-ai-result.txt'),ai);
    const compiled=await build({stdin:{contents:`
        import {Card} from './src/card'; import {CardPlacement,placementCollisions} from './src/card-placement';
        globalThis.makeFixture=(variant)=>{
            globalThis.fixture?.placement.destroy();
            document.head.innerHTML='<style>body{margin:20px;background:#262421;color:#eee;font:14px Arial}main{display:grid;width:840px;max-width:100%;grid-template-columns:500px 320px;grid-template-rows:500px 60px;gap:12px 20px;grid-template-areas:"board tools" "controls tools";align-items:start}.board-wrap{grid-area:board;width:500px;height:500px;background:#a5b987}.native-pane{grid-area:tools;height:500px;max-height:500px;overflow:auto;width:320px;background:#333}.board-controls{grid-area:controls;height:60px}button{min-height:44px}main.no-space .native-pane{width:240px}main.standalone{width:600px;grid-template-columns:500px;grid-template-areas:"board" "controls"}@media(max-width:880px){main{display:block;width:min(500px,100%)}.board-wrap{width:100%;height:auto;aspect-ratio:1}.native-pane{width:100%}}</style>';
            const cls=variant==='lichess'?'analyse__tools':'analysis-sidebar';
            document.body.innerHTML='<main class="analyse"><div id="board" class="board-wrap"></div><section class="native-pane '+cls+'"><button>Native notation control</button><p>Native move list</p></section><div class="board-controls"><button>Previous / next move</button></div></main><footer><button>Footer control</button></footer>';
            const card=new Card(()=>{});card.explanation.textContent='A verified review explanation with a longer searched continuation. '.repeat(22);card.alternatives.textContent='Details remain readable as this card grows. '.repeat(20);card.details.open=true;
            const board=document.querySelector('#board'),placement=new CardPlacement(card.host);placement.attach(board,variant==='lichess');
            globalThis.fixture={placement,card,board};
            globalThis.readPlacement=()=>{const c=card.host.getBoundingClientRect(),b=board.getBoundingClientRect();return {card:c.toJSON(),board:b.toJSON(),overflow:document.documentElement.scrollWidth>innerWidth,collisions:placementCollisions(card.host).map(e=>e.className||e.tagName),beside:c.left>=b.right-1&&c.top<b.bottom,topDifference:c.top-b.top};};
        };`,resolveDir:process.cwd(),loader:'ts'},bundle:true,format:'iife',write:false});
    await page.send('Page.navigate',{url:'about:blank'});
    await page.evaluate(compiled.outputFiles[0].text);
    for(const variant of ['lichess','chesscom']){
        await page.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
        await page.evaluate(`makeFixture(${JSON.stringify(variant)});true`);await wait(400);
        let state=await page.evaluate('readPlacement()');assert.ok(state.beside,JSON.stringify(state));assert.ok(Math.abs(state.topDifference)<=16,JSON.stringify(state));assert.deepEqual(state.collisions,[]);assert.ok(!state.overflow);assert.equal(state.board.width,500);assert.equal(state.board.height,500);
        await page.evaluate('fixture.card.explanation.textContent+=" Extra explanation.".repeat(100);true');await wait(400);
        state=await page.evaluate('readPlacement()');assert.ok(state.beside,JSON.stringify(state));assert.deepEqual(state.collisions,[]);
        await page.send('Emulation.setDeviceMetricsOverride',{width:800,height:900,deviceScaleFactor:1,mobile:false});await wait(400);
        state=await page.evaluate('readPlacement()');assert.ok(state.card.top>=state.board.bottom,JSON.stringify(state));assert.deepEqual(state.collisions,[]);assert.ok(!state.overflow);
        await page.send('Emulation.setDeviceMetricsOverride',{width:940,height:900,deviceScaleFactor:1,mobile:false});
        await page.evaluate(`makeFixture(${JSON.stringify(variant)});document.querySelector('main').classList.add('no-space');true`);await wait(400);
        state=await page.evaluate('readPlacement()');assert.ok(!state.beside,JSON.stringify(state));
        await page.evaluate('document.querySelector("main").classList.remove("no-space");true');await wait(500);
        state=await page.evaluate('readPlacement()');assert.ok(state.beside,JSON.stringify(state));assert.deepEqual(state.collisions,[]);
        const shot=await page.send('Page.captureScreenshot',{format:'png'});await writeFile(join(profile,`${variant}-tall-card.png`),Buffer.from(shot.data,'base64'));
        console.log(`PASS: ${variant} top-aligned tall card, content growth, narrow fallback and recovery without a window resize`);
    }
    await page.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
    await page.evaluate('makeFixture("lichess");fixture.placement.destroy();document.querySelector(".native-pane").remove();document.querySelector("main").classList.add("standalone");fixture.placement=new (fixture.placement.constructor)(fixture.card.host);fixture.placement.attach(fixture.board,true);true');await wait(400);
    const separate=await page.evaluate('readPlacement()');assert.ok(separate.beside,JSON.stringify(separate));assert.deepEqual(separate.collisions,[]);assert.ok(!separate.overflow);
    await page.evaluate('fixture.placement.destroy();true');assert.equal(await page.evaluate('document.querySelectorAll("[data-kibitz-layout],[data-kibitz-column]").length'),0);
    console.log('PASS: independent column without a native sidebar; clean restoration on exit');
    console.log(`Focused browser artifacts: ${profile}`);
} finally {
    await Promise.all(sockets.map(socket => new Promise(resolve => {
        if (socket.readyState === WebSocket.CLOSED) { resolve(); return; }
        socket.onclose = resolve; socket.close();
    })));
    browser.kill();
}
