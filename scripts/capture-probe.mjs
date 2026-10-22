// Optional live-site diagnostic. Uses a new profile and never signs into an account.
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const profile = await mkdtemp(join(tmpdir(), 'kibitz-capture-'));
const port = 19444;
const browser = spawn(process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-features=DisableLoadExtensionCommandLineSwitch', `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, `--load-extension=${resolve('dist')}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const clients = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function targets() { return (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); }
async function until(fn, label) {
    const end = Date.now() + 25000;
    while (Date.now() < end) { const value = await fn().catch(() => undefined); if (value) return value; await wait(250); }
    throw new Error(`Timed out: ${label}`);
}
async function connect(url) {
    const socket = new WebSocket(url), pending = new Map(); let id = 0;
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    socket.onmessage = ({ data }) => { const event = JSON.parse(data), task = pending.get(event.id); if (task) { pending.delete(event.id); event.error ? task.reject(new Error(event.error.message)) : task.resolve(event.result); } };
    const client = {
        send(method, params = {}) { return new Promise((resolve, reject) => { const key = ++id; pending.set(key, { resolve, reject }); socket.send(JSON.stringify({ id: key, method, params })); }); },
        async evaluate(expression) { const value = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception?.description ?? 'Evaluation failed'); return value.result.value; },
        close() { socket.close(); },
    };
    clients.push(client); return client;
}
try {
    const worker = await until(async () => (await targets()).find(target => target.type === 'service_worker' && target.url.endsWith('/background.js')), 'extension');
    const info = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(), controller = await connect(info.webSocketDebuggerUrl);
    const panel = await connect((await targets()).find(target => target.type === 'page').webSocketDebuggerUrl);
    const origin = `chrome-extension://${new URL(worker.url).host}`;
    await panel.send('Page.navigate', { url: `${origin}/sidepanel.html` });
    await until(() => panel.evaluate('!!document.querySelector("#diagnostics")'), 'panel');
    for (const url of process.argv.slice(2).length ? process.argv.slice(2) : ['https://lichess.org/q7ZvsdUF', 'https://www.chess.com/game/live/164362397774']) {
        const created = await controller.send('Target.createTarget', { url });
        const target = await until(async () => (await targets()).find(target => target.id === created.targetId), 'game tab');
        const page = await connect(target.webSocketDebuggerUrl); await page.send('Page.bringToFront');
        await until(() => page.evaluate('document.readyState === "complete"'), 'game page'); await wait(6000);
        const result = await panel.evaluate('chrome.runtime.sendMessage({type:"CAPTURE_GAME"})');
        console.log(JSON.stringify({ url, capture: result.session ? { title: result.session.title, moves: result.session.moves.length, result: result.session.result } : result }));
        const dom = await page.evaluate('document.documentElement.outerHTML');
        const htmlPath = join(profile, `${new URL(url).hostname}.html`); await writeFile(htmlPath, dom);
        console.log(`DOM saved: ${htmlPath}`);
        console.log(`GAME API: ${JSON.stringify(await page.evaluate(`(() => {const g=document.querySelector('wc-chess-board,chess-board')?.game;try{return {pgn:g?.getPGN?.()?.slice(0,2500),headers:g?.getHeaders?.(),result:g?.getResult?.(),isOver:g?.isGameOver?.(),fen:g?.getFEN?.()}}catch(error){return {error:String(error)}}})()`))}`);
        console.log(`ENGINE SNAPSHOT: ${JSON.stringify(await page.evaluate(`(() => {
            const a=window.site?.analysis??window.lichess?.analysis;
            const g=document.querySelector('wc-chess-board,chess-board')?.game;
            const names=new Set();
            for(let p=g,depth=0;p&&depth<3;p=Object.getPrototypeOf(p),depth++)
                for(const key of Object.getOwnPropertyNames(p)) if(/eval|engine|best|analysis/i.test(key)) names.add(key);
            const nodes=a?.mainline??a?.nodeList??[];
            return {lichess:{fen:a?.node?.fen,ceval:a?.node?.ceval,serverEval:a?.node?.eval,threat:a?.node?.threat,
                evaluatedNodes:nodes.filter(n=>n?.eval||n?.ceval).slice(0,3).map(n=>({ply:n.ply,fen:n.fen,eval:n.eval,ceval:n.ceval}))},
                chesscom:{candidatePropertyNames:[...names],
                    visibleLines:[...document.querySelectorAll('[class*="evaluation"],[class*="engine-line"],[class*="engine-variation"]')].slice(0,12).map(e=>({cls:e.className,text:e.textContent?.slice(0,180)}))}};
        })()`))}`);
        console.log(`NATIVE API: ${JSON.stringify(await page.evaluate(`(() => {
            const g=document.querySelector('wc-chess-board,chess-board')?.game, out={};
            for(const name of ['getSelectedNode','getPositionInfo','getPositionDetails','getFinalPositionInfo','getCurrentFullLine','getHistoryFENs','getHistorySANs','getNodeIds']) {try{const value=g?.[name]?.();out[name]=JSON.stringify(value)?.slice(0,5000)}catch(error){out[name]=String(error)}}
            const a=(window.site??window.lichess)?.analysis;
            out.lichess={siteKeys:Object.keys(window.site??{}).slice(0,40),lichessKeys:Object.keys(window.lichess??{}).slice(0,40),node:a?.node,path:a?.path};
            out.inputs=[...document.querySelectorAll('input,textarea')].filter(el=>/fen|copyable/.test(el.name+' '+el.className)).map(el=>({cls:el.className,value:el.value.slice(0,180)}));
            out.selected=[...document.querySelectorAll('[data-ply],.tview2 move.active,.analyse__moves .active,.node.selected')].slice(0,20).map(el=>({tag:el.tagName,cls:el.className,attrs:[...el.attributes].map(a=>[a.name,a.value]),text:el.textContent.slice(0,80)}));return out;
        })()`))}`);
        console.log(JSON.stringify(await page.evaluate(`(() => ({title:document.title, body:document.body.innerText.slice(-3500), links:[...document.querySelectorAll('a[href]')].filter(el=>/pgn|export|download|analysis|archive/.test(el.getAttribute('href'))).slice(0,20).map(el=>({text:el.textContent.slice(0,70),href:el.getAttribute('href')})), scripts:[...document.scripts].filter(el=>!el.src).map(el=>({type:el.type,len:el.textContent.length,start:el.textContent.slice(0,180)})), boards:[...document.querySelectorAll('wc-chess-board,chess-board,.board,cg-board')].map(el=>({tag:el.tagName,cls:el.className,gameKeys:el.game?Object.keys(el.game):[]}))}))()`)));
        await controller.send('Target.closeTarget', { targetId: created.targetId });
    }
} finally { for (const client of clients) client.close(); browser.kill(); }
