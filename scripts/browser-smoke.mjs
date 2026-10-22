// Run after npm run build. Uses an isolated, temporary Chrome profile.
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';

const wait = ms => new Promise(r => setTimeout(r, ms));
const profile = await mkdtemp(join(tmpdir(), 'kibitz-browser-'));
const port = 19443;
const browser = spawn(process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-features=DisableLoadExtensionCommandLineSwitch',
  `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`,
  `--load-extension=${resolve('dist')}`, 'about:blank',
], { windowsHide: true, stdio: 'ignore' });
let browserFailure;
browser.on('error', error => { browserFailure = error; });
const clients = [];
const liveSites = process.argv.includes('--live-sites');
const failOpenings = process.argv.includes('--fail-openings');
const timings = [];
let openingRequests = 0;
async function targets() { return await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); }
async function connect(url) {
  const socket = new WebSocket(url), pending = new Map(), listeners = new Map(); let id = 0;
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = ({ data }) => {
    const event = JSON.parse(data); const task = pending.get(event.id);
    if (task) { pending.delete(event.id); event.error ? task.reject(new Error(event.error.message)) : task.resolve(event.result); }
    else if (listeners.has(event.method)) listeners.get(event.method)(event.params);
  };
  const client = {
    on(method, callback) { listeners.set(method, callback); },
    send(method, params = {}) {
      return new Promise((resolve, reject) => { const key = ++id; pending.set(key, { resolve, reject }); socket.send(JSON.stringify({ id: key, method, params })); });
    },
    async evaluate(expression) {
      const response = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.text + ': ' + response.exceptionDetails.exception?.description);
      return response.result.value;
    },
    close() { for (const task of pending.values()) task.reject(new Error('Browser connection closed')); pending.clear(); socket.close(); },
  };
  clients.push(client); return client;
}
async function until(fn, description, milliseconds = 20000) {
  const end = Date.now() + milliseconds;
  while (Date.now() < end) { if (browserFailure) throw browserFailure; const result = await fn().catch(() => undefined); if (result) return result; await wait(200); }
  throw new Error(`Timed out: ${description}`);
}
try {
  const worker = await until(async () => {
    for (const target of (await targets()).filter(t => t.type === 'service_worker' && t.url.endsWith('/background.js'))) {
      const client = await connect(target.webSocketDebuggerUrl);
      const name = await client.evaluate('chrome.runtime.getManifest().name');
      if (name.startsWith('Kibitz')) return target;
    }
  }, 'Kibitz service worker');
  const origin = `chrome-extension://${new URL(worker.url).host}`;
  const workerClient = await connect(worker.webSocketDebuggerUrl);
  // Seed legacy sync data before loading settings. These are test-only sentinel values.
  await workerClient.evaluate(`(async()=>{await chrome.storage.local.clear();await chrome.storage.sync.set({settings:{provider:'auto',cloudProvider:'gemini',models:{ollama:'qwen3:4b',gemini:'test',openai:'test',groq:'test'},keys:{gemini:'migration-sentinel'}}});await chrome.offscreen.createDocument({url:'offscreen.html',reasons:['WORKERS'],justification:'Deterministic extension smoke test'});return true})()`);
  const offscreenTarget = await until(async () => (await targets()).find(t => t.url === `${origin}/offscreen.html`), 'offscreen target');
  const offscreen = await connect(offscreenTarget.webSocketDebuggerUrl);
  await offscreen.send('Runtime.enable');
  await offscreen.evaluate(`globalThis.__senders=[];chrome.runtime.onMessage.addListener((m,s)=>{globalThis.__senders.push({type:m.type,id:s.id,url:s.url,tab:!!s.tab,fen:m.fen,manual:m.manual})});true`);
  await offscreen.evaluate(`globalThis.__reviewEvents=[];const originalSend=chrome.runtime.sendMessage.bind(chrome.runtime);chrome.runtime.sendMessage=(message,...args)=>{if(message.event?.type?.startsWith('REVIEW_')){const {type,requestId,ply,text}=message.event;globalThis.__reviewEvents.push({type,requestId,ply,text});}return originalSend(message,...args)};true`);
  // CDP Fetch interception does not reliably pause chrome-extension:// fetches.
  // Wrap only the packaged data request inside this isolated test context instead.
  await offscreen.evaluate(`globalThis.__openingFetchCount=0;const originalFetch=globalThis.fetch.bind(globalThis);globalThis.fetch=async(input,options)=>{const url=typeof input==='string'?input:input.url;if(url===chrome.runtime.getURL('data/openings.json')){globalThis.__openingFetchCount++;if(${failOpenings})return new Response('',{status:503});await new Promise(resolve=>setTimeout(resolve,750));}return originalFetch(input,options)};true`);
  const blank = await connect((await targets()).find(t => t.type === 'page').webSocketDebuggerUrl);
  await blank.send('Page.navigate', { url: `${origin}/sidepanel.html` });
  await until(() => blank.evaluate('document.querySelector("#diagnostics")?.textContent.includes("Extension origin")'), 'settings panel controller');
  const panelSettings = await blank.evaluate(`chrome.runtime.sendMessage({type:'GET_SETTINGS'})`);
  assert.equal(panelSettings.configured.gemini, true);
  assert.ok(!JSON.stringify(panelSettings).includes('migration-sentinel'));
  assert.equal(await blank.evaluate(`document.querySelector('#key').value`), '');
  const migration = await workerClient.evaluate(`(async()=>({local:await chrome.storage.local.get('apiKeys'),sync:await chrome.storage.sync.get('settings')}))()`);
  assert.equal(migration.local.apiKeys.gemini, 'migration-sentinel');
  assert.ok(!JSON.stringify(migration.sync).includes('migration-sentinel'));
  console.log('PASS: credential migration to local storage; panel settings and sync contain no keys');
  const initial = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  console.log(`Chrome AI context: ${JSON.stringify(await offscreen.evaluate('({hasLanguageModel:typeof LanguageModel!=="undefined"})'))}`);
  // Keep mock-provider checks deterministic, independent of installed Chrome models.
  await offscreen.evaluate('Object.defineProperty(globalThis,"LanguageModel",{value:undefined,configurable:true}); true');
  const planForPrompt = prompt => {
    const facts = JSON.parse(prompt.split('\nApproved facts: ')[1]);
    const lead = facts.find(f => f.role === 'lead');
    return JSON.stringify({ leadFactId: lead.id, supportFactId: facts.find(f => f.role === 'support' && f.branch === lead.branch)?.id,
      replyFactId: facts.find(f => f.role === 'reply' && f.branch === lead.branch)?.id, toneVariant: 'encouraging' });
  };
  offscreen.on('Fetch.requestPaused', event => {
    if (event.request.url.startsWith(origin + '/')) { void offscreen.send('Fetch.continueRequest', { requestId: event.requestId }); return; }
    if (event.request.url !== 'http://localhost:11434/api/generate') { void offscreen.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' }); return; }
    void offscreen.send('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: 200,
      responseHeaders: [{ name: 'Content-Type', value: 'application/x-ndjson' }],
      body: Buffer.from(JSON.stringify({ response: planForPrompt(JSON.parse(event.request.postData).prompt), done: false }) + '\n' + JSON.stringify({ response: '', done: true }) + '\n').toString('base64'),
    }).catch(() => {});
  });
  await offscreen.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  const engineStarted = Date.now();
  await blank.evaluate(`document.querySelector('#fen').value=${JSON.stringify(initial)}; document.querySelector('#manual').requestSubmit(); true`);
  const heading = await until(() => blank.evaluate('document.querySelector("#manual-result h2")?.textContent'), 'Stockfish WASM result', 30000);
  assert.match(heading, /Pawn|Knight/); console.log(`PASS: panel → service worker → offscreen → WASM → panel (${heading})`);
  timings.push({phase:'first-manual-engine-result',milliseconds:Date.now()-engineStarted});
  assert.equal(await offscreen.evaluate('globalThis.__openingFetchCount'), 0, 'FEN-only analysis must not load opening data');
  const senders = await offscreen.evaluate('globalThis.__senders');
  assert.ok(senders.some(s=>s.type==='ENGINE_START' && s.id===new URL(origin).host && !s.tab && (s.url===origin+'/background.js'||s.url===origin+'/')),'Service-worker sender metadata must match the authenticated contract');
  await until(async () => !!(await blank.evaluate('document.querySelector("#manual-result p")?.textContent')), 'grounded mock-provider explanation');
  await until(() => blank.evaluate('document.querySelector("#status").textContent.includes("Explanation by Ollama")'), 'Ollama attribution');
  console.log('PASS: streamed explanation through offscreen and panel (mock provider)');
  await offscreen.evaluate(`Object.defineProperty(globalThis,'LanguageModel',{configurable:true,value:{availability:async()=> 'available',create:async()=>({destroy(){},promptStreaming(prompt){return new ReadableStream({start(c){c.enqueue((${planForPrompt.toString()})(prompt));c.close();}})}})}}); true`);
  await blank.evaluate('document.querySelector("#manual").requestSubmit(); true');
  await until(async () => !!(await blank.evaluate('document.querySelector("#manual-result p")?.textContent')), 'Chrome AI grounded explanation');
  await until(() => blank.evaluate('document.querySelector("#status").textContent.includes("Explanation by Chrome")'), 'Chrome provider attribution');
  await offscreen.evaluate('Object.defineProperty(globalThis,"LanguageModel",{value:undefined,configurable:true}); true');
  console.log('PASS: Chrome AI priority, extension messaging and provider attribution (mock model)');
  const terminal = '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1';
  await blank.evaluate(`document.querySelector('#fen').value=${JSON.stringify(terminal)}; document.querySelector('#manual').requestSubmit(); true`);
  await until(async () => (await blank.evaluate('document.querySelector("#manual-result h2")?.textContent')) === 'Stalemate', 'terminal result');
  console.log('PASS: terminal position');
  assert.equal(await blank.evaluate('document.querySelectorAll("#review-board,.replay-board").length'), 0, 'Settings must not render another chessboard');
  const browserInfo = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const controller = await connect(browserInfo.webSocketDebuggerUrl);
  const widths = [240, 320, 375, 540, 768, 1440, 2560];
  const cardValue = expression => `(() => {const root=document.querySelector('#kibitz-card')?.shadowRoot;return ${expression};})()`;
  function fixture(lichess, gameId) {
    const pgn = `[White "History White"]\n[Black "History Black"]\n[Result "1-0"]\n[Link "https://${lichess?'lichess.org/'+gameId:'www.chess.com/game/live/'+gameId}"]\n\n1. f3 e5 2. g4 Qh4# 0-1`;
    const chess = new Chess(), positions = [chess.fen()], moves = [];
    for (const san of ['f3','e5','g4','Qh4#']) { const m=chess.move(san); moves.push({san:m.san,uci:m.from+m.to+(m.promotion??'')}); positions.push(chess.fen()); }
    const allPieces = positions.map(fen => new Chess(fen).board().flat().filter(Boolean));
    const boardTag=lichess?'cg-board':'wc-chess-board';
    return `<!doctype html><html><head><title>Kibitz native board fixture</title><style>
      *{box-sizing:border-box}body{margin:0;padding:12px;font:16px system-ui;background:#f3f3ed;color:#242722}main{display:grid;grid-template-columns:minmax(0,640px) minmax(260px,1fr);gap:12px;max-width:1200px;margin:auto}.board-wrapper,.analyse__board{min-width:0}.board{display:block;position:relative;width:100%;aspect-ratio:1;background:conic-gradient(#769453 25%,#eeeccf 0 50%,#769453 0 75%,#eeeccf 0);background-size:25% 25%}.piece,piece{position:absolute;width:12.5%;height:12.5%;display:flex;align-items:center;justify-content:center;font-size:clamp(16px,5vw,46px);line-height:1;pointer-events:none}.site-controls{display:flex;align-items:center;gap:8px;min-height:48px;flex-wrap:wrap}.site-controls button,.move-list button{min-height:44px}aside{min-width:0;grid-column:2;grid-row:1 / span 2}.site-controls{grid-column:1;grid-row:2}.native-chat{padding:12px;background:#e3e7db;min-height:100px}button{font:inherit}.move-list{display:flex;gap:6px;flex-wrap:wrap}.node.active,move.active{outline:2px solid #456922}footer{max-width:1200px;margin:12px auto;padding:12px;background:#e0e6d9}body.dark{background:#242722;color:#eee}body.dark .native-chat,body.dark footer{background:#343c2d}@media(max-width:999px){main{grid-template-columns:minmax(0,1fr);grid-template-rows:auto 48px auto}.site-controls{height:48px}aside{grid-column:1;grid-row:auto}.native-chat{min-height:100px}}
      input{max-width:100%;min-width:0}
    </style></head><body><header class="game__meta"><span class="result" data-result="1-0">1-0</span></header>
    <main class="${lichess?'round__app':'board-layout-main'}"><div class="${lichess?'analyse__board':'board-wrapper'}"><${boardTag} class="board"></${boardTag}></div><div class="site-controls board-controls" data-native-control><button id="native-prev">Previous</button><button id="native-next">Next</button><button id="native-flip">Flip</button><span class="clock">Finished</span></div><aside class="${lichess?'analyse__tools':'sidebar-component'}"><div class="move-list ${lichess?'analyse__moves':''}" data-native-control></div><div class="native-chat" data-native-control>Game notes and chat <input placeholder="Study notes"></div></aside></main>
    <footer data-native-control><button>Site navigation</button></footer><script type="application/x-chess-pgn">${pgn}</script>
    <script>
      const positions=${JSON.stringify(positions)},moves=${JSON.stringify(moves)},pieces=${JSON.stringify(allPieces)},pgn=${JSON.stringify(pgn)},lichess=${lichess};
      let selected=1,black=false;const board=document.querySelector('.board'),wrapper=board.parentElement,list=document.querySelector('.move-list');
      const names={p:'pawn',n:'knight',b:'bishop',r:'rook',q:'queen',k:'king'},glyphs={wk:'♔',wq:'♕',wr:'♖',wb:'♗',wn:'♘',wp:'♙',bk:'♚',bq:'♛',br:'♜',bb:'♝',bn:'♞',bp:'♟'};
      moves.forEach((move,index)=>{const el=document.createElement(lichess?'move':'button');el.className='node';el.dataset.ply=index+1;el.textContent=move.san;el.addEventListener('click',()=>select(index+1));list.append(el)});
      function select(ply){selected=Math.min(moves.length,Math.max(0,ply));board.dataset.fen=positions[selected];board.classList.toggle('flipped',black);wrapper.classList.toggle('orientation-black',black);board.replaceChildren();for(const p of pieces[selected]){const el=document.createElement(lichess?'piece':'div'),file=p.square.charCodeAt(0)-97,rank=Number(p.square[1]);el.className=lichess?(p.color==='w'?'white':'black')+' '+names[p.type]:'piece '+p.color+p.type+' square-'+(file+1)+rank;el.style.left=((black?7-file:file)*12.5)+'%';el.style.top=((black?rank-1:8-rank)*12.5)+'%';el.textContent=glyphs[p.color+p.type];board.append(el)}for(const el of list.children){el.classList.toggle('active',Number(el.dataset.ply)===selected);el.setAttribute('aria-current',String(Number(el.dataset.ply)===selected))}if(lichess){site.analysis.node={fen:positions[selected],ply:selected};site.analysis.path=String(selected);site.analysis.nodeList=positions.slice(0,selected+1).map((fen,ply)=>({fen,ply,san:ply?moves[ply-1].san:undefined}))}}
      window.site={analysis:{tree:{root:{fen:positions[0],ply:0}},node:{},path:''}};
      if(!lichess)board.game={getFEN:()=>positions[selected],getSelectedNode:()=>({ply:selected}),getHistorySANs:()=>moves.slice(0,selected).map(m=>m.san),getPGN:()=>pgn,getHeaders:()=>({Result:'1-0',Link:location.href})};
      document.querySelector('#native-prev').onclick=()=>select(selected-1);document.querySelector('#native-next').onclick=()=>select(selected+1);document.querySelector('#native-flip').onclick=()=>{black=!black;select(selected)};window.selectFixture=select;select(1);
    </script></body></html>`;
  }
  for (const lichess of [false, true]) {
    const url = lichess ? 'https://lichess.org/abcd1234' : 'https://www.chess.com/game/live/123456789';
    const {targetId}=await controller.send('Target.createTarget',{url:'about:blank'});
    const target=await until(async()=>(await targets()).find(t=>t.id===targetId),'fixture target');const page=await connect(target.webSocketDebuggerUrl);
    const fixtureErrors = [], contexts = [];
    page.on('Runtime.executionContextCreated', ({ context }) => contexts.push(context));
    await page.send('Runtime.enable');
    page.on('Fetch.requestPaused',event=>{
      const method = [url, new URL('/analysis',url).href].includes(event.request.url) ? 'Fetch.fulfillRequest' : 'Fetch.failRequest';
      const params = method === 'Fetch.fulfillRequest' ? {requestId:event.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/html'}],body:Buffer.from(fixture(lichess,lichess?'abcd1234':'123456789')).toString('base64')} : {requestId:event.requestId,errorReason:'BlockedByClient'};
      void page.send(method,params).catch(error=>fixtureErrors.push(error.message));
    });
    await page.send('Fetch.enable',{patterns:[{urlPattern:'*'}]});await page.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await page.send('Page.navigate',{url});
    await until(()=>page.evaluate(cardValue('root?.querySelector("article")')),'native card');
    const contentContext = await until(async()=>contexts.find(c=>c.origin===origin), 'manifest content-script execution context');
    const contentSettings = await page.send('Runtime.evaluate', {contextId:contentContext.id,expression:`chrome.runtime.sendMessage({type:'GET_SETTINGS'})`,awaitPromise:true,returnByValue:true});
    assert.equal(contentSettings.result.value?.error, 'Unauthorized request.');
    assert.ok(!JSON.stringify(contentSettings).includes('migration-sentinel'));
    await until(()=>page.evaluate(cardValue('root?.querySelector("article > button")?.hidden === false')),'review launch button');
    await page.evaluate(cardValue('root.querySelector("article > button").click()'));
    await until(()=>page.evaluate(cardValue('root?.querySelector("h2").textContent.includes("·")')),'in-page Stockfish feedback',30000);
    if (!failOpenings) await until(()=>page.evaluate(cardValue('root?.querySelector("details").textContent.includes("Opening so far:")')),'lazy opening metadata after immediate feedback');
    else {
      assert.ok(await page.evaluate(cardValue('!!root.querySelector(".explanation").textContent')), 'Missing opening data must not hide coaching');
      assert.equal(await page.evaluate(cardValue('root.querySelector("details").textContent.includes("Opening so far:")')), false, 'Unavailable data must omit opening names');
    }
    assert.equal(await page.evaluate(cardValue('getComputedStyle(root.querySelector("article")).borderTopWidth')), '2px');
    assert.equal(await page.evaluate('document.querySelectorAll("#kibitz-overlay [data-candidate-ranks],#kibitz-overlay path").length'), 0, 'Review must not draw candidate recommendations');
    assert.equal(await page.evaluate(cardValue('root.querySelector("[data-arrows]").closest("section").hidden')), true, 'Analysis overlay preferences stay hidden during review');
    await until(()=>blank.evaluate(`document.querySelector('#theme-label').textContent.includes('${lichess?'Lichess':'Chess.com'}')`),'settings matches active website theme');
    const sharedTheme=await blank.evaluate('chrome.runtime.sendMessage({type:"GET_SITE_THEME"})');
    assert.equal(await page.evaluate('document.querySelector("#kibitz-card").style.getPropertyValue("--k-bg")'),sharedTheme.theme.background,'Card and panel share the website palette');
    await page.evaluate('document.body.classList.add("dark");true');
    await wait(450);
    assert.equal(await page.evaluate('document.querySelector("#kibitz-card").style.getPropertyValue("--k-bg")'), sharedTheme.theme.background, 'Card retains its arrival color after site changes');
    assert.equal(await blank.evaluate('document.documentElement.style.getPropertyValue("--k-bg")'), sharedTheme.theme.background, 'Panel retains its arrival color after site changes');
    assert.equal(await page.evaluate('document.querySelectorAll("#kibitz-overlay g[data-square] text").length'), 0, 'Heatmap tiles must not duplicate the shared destination labels');
    await page.evaluate('document.body.classList.remove("dark");true');
    const contentTiming=await page.send('Runtime.evaluate',{contextId:contentContext.id,expression:`performance.getEntriesByName('kibitz:content-init').map(e=>({phase:e.name,milliseconds:e.duration}))`,returnByValue:true});
    timings.push(...contentTiming.result.value.map(entry=>({...entry,site:lichess?'lichess':'chesscom'})));
    assert.equal(await page.evaluate('document.querySelectorAll("cg-board,wc-chess-board,chess-board").length'),1,'Only the website board may exist');
    assert.equal(await blank.evaluate('document.querySelectorAll("#review-board,.replay-board").length'),0);
    await blank.send('Page.navigate',{url:'about:blank'}); // Close settings context; review must remain on the page.
    await page.evaluate('document.querySelector("#native-next").click();true');
    await until(()=>page.evaluate(cardValue('root?.querySelector("h2").textContent.startsWith("Pawn to E5")')),'native next move follows with settings closed',30000);
    assert.equal(await page.evaluate('document.querySelectorAll("#kibitz-overlay path").length'),0,'Review has no candidate arrows');
    await page.evaluate(cardValue('root.querySelector("details").open=true'));
    await page.evaluate(`document.querySelector('#kibitz-card').shadowRoot.querySelector('[data-ai]').click();true`);
    await until(()=>page.evaluate(cardValue(`root?.querySelector('.review-ai-text').textContent.includes('Explanation by') && !!root?.querySelector('.explanation').textContent`)),'optional in-page grounded AI wording',30000);
    await page.evaluate(`document.querySelector('#kibitz-card').shadowRoot.querySelector('[data-sweep]').click();true`);
    try {
      await until(()=>page.evaluate(cardValue('root?.querySelector(".review-progress").textContent.startsWith("4 of 4")')),'whole-game review does not navigate the native board',30000);
    } catch (error) {
      console.error('Fixture review state:',await page.evaluate(cardValue('({progress:root.querySelector(".review-progress").textContent,status:root.querySelector(".status").textContent})')));
      console.error('Fixture review event sequence:',await offscreen.evaluate('globalThis.__reviewEvents'));
      throw error;
    }
    assert.ok(await page.evaluate('document.querySelector(".node.active").dataset.ply === "2"'));
    await page.evaluate(cardValue('root.querySelector(".review-issues").open=true;root.querySelector("[data-issue-ply="+CSS.escape("3")+"]").click()'));
    await until(()=>page.evaluate(cardValue('root.querySelector("h2").textContent.startsWith("Pawn to G4")')),'problem list selects the native played move',30000);
    assert.equal(await page.evaluate('document.querySelector(".node.active").dataset.ply'),'3');
    assert.equal(await page.evaluate('document.querySelector("#kibitz-overlay [data-marker] text").textContent'),'??');
    assert.equal(await page.evaluate('document.querySelectorAll("#kibitz-overlay [data-review-cue=origin],#kibitz-overlay [data-review-cue=destination]").length'),2);
    assert.equal(await page.evaluate('document.querySelectorAll("#kibitz-overlay [data-review-cue=consequence]").length'),1);
    assert.ok(await page.evaluate(cardValue('root.querySelector(".lines").textContent.includes("Better alternative")')));

    const checkPlacement=async(label)=>{
      await wait(450);
      const state=await page.evaluate(`(() => {const host=document.querySelector('#kibitz-card'),card=host.getBoundingClientRect(),board=document.querySelector('.board').getBoundingClientRect();const overlap=(a,b)=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1;return {card:card.toJSON(),board:board.toJSON(),width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,collisions:[...document.querySelectorAll('button,input,textarea,select,[data-native-control]')].filter(el=>!host.contains(el)&&!el.contains(host)&&overlap(card,el.getBoundingClientRect())).map(el=>({tag:el.tagName,cls:el.className,id:el.id})),overlay:document.querySelector('#kibitz-overlay').getBoundingClientRect().toJSON(),slot:host.parentElement.hasAttribute('data-kibitz-slot')};})()`);
      assert.ok(state.slot,`${label}: card must own an allocated slot`);assert.ok(state.card.left>=0&&state.card.right<=state.width,`${label}: card horizontal overflow ${JSON.stringify(state)}`);assert.deepEqual(state.collisions,[],`${label}: card overlaps site controls`);assert.ok(state.card.top>=state.board.bottom-1||state.card.left>=state.board.right-1||state.card.right<=state.board.left+1,`${label}: card covers board`);
      if(state.width>=1440)assert.ok((state.card.left>=state.board.right-1||state.card.right<=state.board.left+1)&&state.card.top<state.board.bottom&&state.card.bottom>state.board.top,`${label}: card must prefer beside the board when the fixture has room ${JSON.stringify(state)}`);
    };
    for(const width of widths){await page.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});await checkPlacement(`${lichess?'Lichess':'Chess.com'} ${width}px`)}
    await page.send('Emulation.setDeviceMetricsOverride',{width:375,height:800,deviceScaleFactor:1,mobile:false});
    await page.evaluate(`const root=document.querySelector('#kibitz-card').shadowRoot;root.querySelector('details').open=true;root.querySelector('.explanation').textContent='Long review explanation. '.repeat(30);true`);await checkPlacement('expanded narrow card');
    await page.evaluate(`document.querySelector('#native-flip').click();true`);await checkPlacement('rotated native board');
    await page.evaluate(`document.body.classList.add('dark');document.querySelector('#kibitz-card').scrollIntoView({block:'center'});true`);await checkPlacement('dark narrow card');
    const shot=await page.send('Page.captureScreenshot',{format:'png'});await writeFile(join(profile,lichess?'lichess-native-review.png':'chesscom-native-review.png'),Buffer.from(shot.data,'base64'));
    const activeTab=await (await connect(worker.webSocketDebuggerUrl)).evaluate('chrome.tabs.query({active:true,lastFocusedWindow:true}).then(t=>t[0].id)');
    const workerClient=await connect(worker.webSocketDebuggerUrl);await workerClient.evaluate(`chrome.tabs.setZoom(${activeTab},2)`);await checkPlacement('native board at 200% zoom');await workerClient.evaluate(`chrome.tabs.setZoom(${activeTab},1)`);
    await page.evaluate(`document.querySelector('#kibitz-card').shadowRoot.querySelector('[data-stop]').click();true`);
    await until(()=>page.evaluate("document.querySelector('#kibitz-card').shadowRoot.querySelector('[data-stop]').closest('section').hidden"),'exit in-page review');
    assert.equal(await page.evaluate('document.querySelectorAll("#kibitz-overlay path").length'),0,'Leaving review on a game page must not turn on suggestions');
    await page.send('Page.navigate',{url:new URL('/analysis',url).href});
    await until(()=>page.evaluate(cardValue('!root.querySelector("[data-heatmap]").disabled')),'ordinary study overlay controls');
    assert.equal(await page.evaluate('document.querySelectorAll("#kibitz-overlay [data-candidate-ranks]").length'),3,'Analysis boards retain three candidate arrows');
    assert.ok(await page.evaluate('document.querySelectorAll("#kibitz-overlay g[data-square]").length>0'),'Analysis retains the candidate heatmap');

    await page.evaluate(cardValue('root.querySelector("[data-heatmap]").click()'));
    await until(()=>workerClient.evaluate('chrome.storage.local.get("overlayPreferences").then(v=>v.overlayPreferences?.heatmap===false&&v.overlayPreferences?.arrows===true)'),'saved independent layer preferences');
    await page.send('Page.reload');await wait(650);
    await until(()=>page.evaluate(cardValue('root && !root.querySelector("[data-heatmap]").disabled && !root.querySelector("[data-heatmap]").checked && root.querySelector("[data-arrows]").checked')),'overlay preferences survive page reload',30000);
    assert.equal(await page.evaluate('document.querySelectorAll("#kibitz-overlay g[data-square]").length'),0,'Restored disabled heatmap stays clear');
    await page.evaluate(cardValue('root.querySelector("[data-heatmap]").click()'));
    await until(()=>workerClient.evaluate('chrome.storage.local.get("overlayPreferences").then(v=>v.overlayPreferences?.heatmap===true)'),'restore heatmap preference');
    await controller.send('Target.closeTarget',{targetId});
    assert.deepEqual(fixtureErrors, [], 'Fixture interception failures');
    await blank.send('Page.navigate',{url:`${origin}/sidepanel.html`});await until(()=>blank.evaluate('!!document.querySelector("#diagnostics")'),'settings reload');
    console.log(`PASS: ${lichess?'Lichess':'Chess.com'} native board review with panel closed, move sync, heatmaps, AI, full-game analysis, no collisions 240–2560px and 200% zoom`);
  }
  // Check real site layouts too; access failures are separate from deterministic integration checks.
  for (const url of liveSites ? ['https://lichess.org/analysis','https://www.chess.com/analysis'] : []) {
    const {targetId}=await controller.send('Target.createTarget',{url});const target=await until(async()=>(await targets()).find(t=>t.id===targetId),'public site');const page=await connect(target.webSocketDebuggerUrl);
    try {
      await until(()=>page.evaluate('!!document.querySelector("#kibitz-card")'),'public board card',25000);
      for(const width of [1440,768,540,375,320]){
        await page.send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});await wait(700);
        const state=await page.evaluate(`(() => {const host=document.querySelector('#kibitz-card'),card=host.getBoundingClientRect(),board=document.querySelector('wc-chess-board,chess-board,cg-board').getBoundingClientRect();const overlap=(a,b)=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1;return {card:card.toJSON(),board:board.toJSON(),collisions:[...document.querySelectorAll('button,input,select,textarea')].filter(el=>!el.contains(host)&&overlap(card,el.getBoundingClientRect())).map(el=>({tag:el.tagName,cls:el.className})),overflow:card.left<0||card.right>innerWidth};})()`);
        assert.deepEqual(state.collisions,[],`${url} ${width}px collisions`);assert.ok(!state.overflow,`${url} ${width}px card outside viewport`);if(width<1000)assert.ok(state.card.top>=state.board.bottom-1,`${url} narrow card must be below board`);
      }
      await page.evaluate('document.querySelector("#kibitz-card").shadowRoot.querySelector("details").open=true;document.querySelector("#kibitz-card").scrollIntoView({block:"center"});true');await wait(600);
      const shot=await page.send('Page.captureScreenshot',{format:'png'});await writeFile(join(profile,new URL(url).hostname+'.png'),Buffer.from(shot.data,'base64'));console.log(`PASS: actual ${url} card/control collision checks at 320–1440px`);
    }catch(error){console.log(`PUBLIC SITE CHECK INCOMPLETE: ${url}: ${error.message}`)}
    await controller.send('Target.closeTarget',{targetId});
  }
  console.log(`Isolated browser artifacts: ${profile}`);
  const measured=await offscreen.evaluate(`performance.getEntriesByType('measure').filter(e=>e.name.startsWith('kibitz:')).map(e=>({phase:e.name,milliseconds:e.duration}))`);
  timings.push(...measured);
  openingRequests=await offscreen.evaluate('globalThis.__openingFetchCount');
  if (!failOpenings) assert.equal(openingRequests, 1, 'All review requests share one lazy opening-data fetch');
  else assert.ok(openingRequests >= 1, 'Missing-file simulation must actually execute');
  console.table(timings);
  await writeFile(join(profile,'performance.json'),JSON.stringify({openingRequests,failOpenings,timings},null,2));
} finally {
  for(const client of clients)client.close();
  browser.kill();
  await Promise.race([new Promise(resolve=>browser.once('exit',resolve)),wait(3000)]);
}
