// Isolated, optional public-site acceptance check. Enables the site's visible
// engine switch only in this disposable diagnostic; runtime readers stay read-only.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { build } from 'esbuild';
const profile = await mkdtemp(join(tmpdir(), 'kibitz-native-engine-'));
const port = 19555;
const browser = spawn(process.env.CHROME_PATH ?? 'C:/Users/tafoy/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe', ['--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, 'https://lichess.org/analysis'], { windowsHide: true, stdio: 'ignore' });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label, timeout = 45000) { const end = Date.now() + timeout; while (Date.now() < end) { const value = await fn().catch(() => undefined); if (value) return value; await pause(300); } throw new Error(`Timed out: ${label}`); }
let socket;
try {
    const target = await until(async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'), 'browser');
    socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let id = 0; const pending = new Map();
    socket.onmessage = ({ data }) => { const message = JSON.parse(data), task = pending.get(message.id); if (task) { pending.delete(message.id); message.error ? task.reject(new Error(message.error.message)) : task.resolve(message.result); } };
    const send = (method, params) => new Promise((resolve, reject) => { const key = ++id; pending.set(key, { resolve, reject }); socket.send(JSON.stringify({ id: key, method, params })); });
    const evaluate = async expression => { const out = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (out.exceptionDetails) throw new Error(out.exceptionDetails.exception?.description ?? 'Evaluation failed'); return out.result.value; };
    await until(() => evaluate('!!window.site?.analysis?.node'), 'public analysis controller');
    const js = ts.transpileModule(await readFile('src/site-engine.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace(/export /g, '');
    const reader = `(()=>{${js};return readNativeEngine()})()`;
    console.log(`Engine-off result: ${JSON.stringify(await evaluate(reader))}`);
    const controls = await evaluate(`[...document.querySelectorAll('.ceval input,.ceval button,.ceval .switch')].map(e=>({tag:e.tagName,id:e.id,cls:e.className,title:e.title,aria:e.getAttribute('aria-label'),type:e.type}))`);
    console.log(`Visible engine controls: ${JSON.stringify(controls)}`);
    const clicked = await evaluate(`(()=>{const el=document.querySelector('.ceval input[type="checkbox"]');if(!el)return false;if(!el.checked)el.click();return true})()`);
    if (!clicked) throw new Error('No supported visible engine switch found.');
    const snapshot = await until(() => evaluate(reader), 'populated native evaluation', 60000);
    const bundled = await build({ entryPoints: ['src/analysis-sources.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
    const { normalizeNativeEngine } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
    const current = await evaluate('({fen:window.site.analysis.node.fen,path:window.site.analysis.path,ply:window.site.analysis.node.ply,url:location.href})');
    const result = normalizeNativeEngine(snapshot, current);
    if (!result?.evaluation.bestMove) throw new Error('Populated native evaluation failed normalization.');
    await writeFile(join(profile, 'native-result.json'), JSON.stringify({ snapshot, result }, null, 2));
    console.log(`PASS live populated Lichess result: ${result.evaluation.bestMove}, ${result.evaluation.evaluation}, depth ${result.provenance.depth}; ${result.evaluation.candidates.length} candidates`);
    console.log(`Artifacts: ${profile}`);
} finally { socket?.close(); browser.kill(); }
