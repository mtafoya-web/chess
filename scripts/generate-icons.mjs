// Rasterize the editable SVG using Chromium; no graphics dependencies required.
// CHROME_PATH should point to Chrome or Chromium. Run from the repository root.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const profile = await mkdtemp(join(tmpdir(), 'kibitz-icons-'));
const browser = spawn(process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank',
], { windowsHide: true, stdio: 'ignore' });
let failure, socket, nextId = 0;
browser.on('error', error => { failure = error; });
const pending = new Map();
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function send(method, params = {}) {
    return new Promise((resolve, reject) => {
        const id = ++nextId;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 10000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params }));
    });
}
try {
    let port;
    const deadline = Date.now() + 20000;
    while (!port && Date.now() < deadline) {
        if (failure) throw failure;
        try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); }
        catch { await wait(100); }
    }
    if (!port) throw new Error('Chromium did not expose a debugging port. Check CHROME_PATH.');
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) })).json();
    socket = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    socket.onmessage = ({ data }) => {
        const event = JSON.parse(data), task = pending.get(event.id);
        if (!task) return;
        clearTimeout(task.timer); pending.delete(event.id);
        if (event.error) task.reject(new Error(event.error.message)); else task.resolve(event.result);
    };
    const svg = await readFile('public/icons/kibitz.svg', 'utf8');
    await send('Page.enable');
    await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    const { frameTree } = await send('Page.getFrameTree');
    await send('Page.setDocumentContent', { frameId: frameTree.frame.id, html: `<style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style>${svg}` });
    for (const size of [16, 32, 48, 128]) {
        // Downsample the same vector in the browser at its actual target resolution.
        await send('Emulation.setDeviceMetricsOverride', { width: size, height: size, deviceScaleFactor: 1, mobile: false });
        const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: size, height: size, scale: 1 } });
        await writeFile(`public/icons/kibitz-${size}.png`, Buffer.from(data, 'base64'));
    }
    console.log('Generated Kibitz icons at 16, 32, 48 and 128px.');
} finally {
    for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new Error('Browser closed')); }
    socket?.close(); browser.kill();
    await Promise.race([new Promise(resolve => browser.once('exit', resolve)), wait(2000)]);
}
