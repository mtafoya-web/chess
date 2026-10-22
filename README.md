# Kibitz

Kibitz is a Chrome extension that helps you understand chess moves on **Chess.com** and **Lichess**.

It adds a small card beside or below the board with:

- Analysis boards: recommended moves from usable Lichess analysis or Kibitz's local Stockfish engine.
- Game review: critique of the played move, with visual cues for inaccuracies, mistakes, blunders, and missed mates.
- A score showing which side has the advantage. Positive scores favor White; negative scores favor Black.
- A short explanation naming the colored piece, its squares, verified effects, and a possible reply.
- A **Details** section with other moves and possible continuations.

Use Kibitz for study, analysis, completed-game review, and practice against a computer. It does not provide suggestions during live games against people.

## Contents

- [Install](#1-install-the-extension) and [set up explanations](#2-set-up-ai-explanations)
- [Use the native board, review games, or import PGN](#3-use-kibitz)
- [Troubleshooting](#troubleshooting)
- [Development and browser verification](#for-developers)
- [How results and coaching work](#how-results-and-coaching-work)
- [Privacy, storage, and migration](#privacy-storage-and-migration)
- [Runtime architecture](#runtime-architecture)
- [Bundle optimization and measurements](#bundle-optimization-and-measurements)
- [Data and licenses](#data-and-licenses)

## 1. Install the extension

You need **desktop Chrome 116 or newer** and **Node.js 22 or newer**, which includes npm. Built-in Chrome AI has additional browser and hardware requirements; Kibitz checks availability at runtime. See [Chrome's current Prompt API documentation](https://developer.chrome.com/docs/ai/prompt-api).

Open a terminal in this project folder and run:

```sh
npm ci
npm run build
```

Then load Kibitz in Chrome:

1. Open `chrome://extensions`.
2. Turn on **Developer mode** in the top-right corner.
3. Click **Load unpacked**.
4. Select this project's **dist** folder.
5. Open or refresh a Chess.com or Lichess analysis page.

After changing the code, run `npm run build` again, click **Reload** on Kibitz's extension card in `chrome://extensions`, and refresh the chess page.

## 2. Set up AI explanations

Click the **Kibitz extension icon** to open settings. If the icon is hidden, find Kibitz in Chrome's Extensions menu (the puzzle-piece icon).

The default mode is **Automatic**, which tries these sources in order:

| Order | AI source | What you need |
| --- | --- | --- |
| 1 | Chrome AI (Gemini Nano) | A one-time model download on a supported computer |
| 2 | Ollama | Ollama running locally with a downloaded model |
| 3 | Your chosen cloud service | An API key and permission to access the service |

If a source is unavailable, fails, or takes too long, Kibitz tries the next one. The card shows which source supplied the explanation. You can also choose a mode that uses only one source. If a model returns unsupported facts or no model is available, Kibitz displays its own verified wording instead.

**Stockfish can still recommend moves when no AI explanation source is available.**

### Chrome AI: start here

Chrome AI is free, runs on your computer, and does not need an API key.

1. Open Kibitz settings.
2. Click **Enable Chrome AI**.
3. Wait for the model download to finish. Progress appears in the panel.

You need internet access for the initial download. After that, local explanations can work offline. If Chrome AI is unsupported on your computer, Automatic tries Ollama next.

See [Chrome's hardware requirements](https://developer.chrome.com/docs/ai/get-started) if the button is unavailable.

### Ollama: optional local backup

Ollama also runs AI on your computer without a cloud API key.

1. Install [Ollama](https://ollama.com) and open it.
2. Download the default model from a terminal:

   ```sh
   ollama pull qwen3:4b
   ```

3. In Kibitz settings, expand **Ollama** to find the model download and allowed-origin server commands. **Check connection** tells you whether the server and chosen model are ready. The extension origin also appears under advanced diagnostics.
4. Add an environment variable named `OLLAMA_ORIGINS` to Ollama's environment, using that extension origin as its value. This allows Kibitz to connect to Ollama.
5. Restart Ollama. On Windows, quit it from the system tray first, then reopen it so it reads the new setting.
6. Keep Ollama running while using Kibitz.

Kibitz connects to Ollama at `http://localhost:11434`. If you use a different downloaded model, enter its name in **Ollama model** and click **Save settings**.

### Cloud services: optional backup

Kibitz supports Gemini, OpenAI, and Groq.

1. In settings, choose a service under **Cloud fallback**.
2. Enter a model available to your account and your API key.
3. Click **Save settings** and allow Chrome's access request.

In Automatic mode, cloud is used only after both local sources fail. **To keep explanations local, leave the selected cloud service's API key empty.** Choosing a cloud-only mode uses that service directly.

Cloud services receive the board position and Stockfish's analysis. Requests may cost money, including requests that fail. API keys stay in local extension storage on this Chrome profile. Preferences such as models and provider choice still sync; keys do not. Local storage is not an encrypted credential vault. Kibitz never returns saved keys to the settings form, chess pages, or logs. Enter a replacement key or choose **Remove saved key**, then save.

Existing keys migrate automatically: Kibitz saves them locally before removing their synchronized copies, preserves existing local keys, and retries interrupted cleanup. Deleted keys stay deleted. Other profiles may need their keys entered again, particularly if they were offline when synced copies were removed.

## 3. Use Kibitz

### Review a game from your history

1. On Chess.com or Lichess, open your game history and select a finished game.
2. Click **Review with Kibitz** on the board card. You can also open settings and click **Review selected game**. You do not need the site's game-review report.
3. Use **the website's existing move list and previous/next controls**. Kibitz follows the position on that board; it does not create another board.
4. Read what the played move allowed, missed, or cost. Review does not display candidate arrows, a candidate heatmap, or a ranked next-move list.
5. Look for **?!** (inaccuracy), **?** (mistake), **??** (blunder), or **M?** (missed mate) beside the played destination. Problem moves also have subtle origin/destination highlights. A dashed gold outline marks a piece or king affected in a legally replayed searched continuation when that evidence is available.
6. Open **Moves to revisit** for the analyzed inaccuracies and worse moves. Click an entry to select its native move when the website exposes a unique supported move node. Otherwise, use the website's move list; Kibitz does not guess an unsupported navigation method.

The selected move is analyzed first. Choose **Analyze whole game** on the card for a full pass, or pause it whenever you want. This does not move the website's board. Ratings are provisional Kibitz estimates from consistent local engine searches, not the site's own accuracy scores. Positive evaluations favor White, regardless of which player made the move.

The gold-framed card uses readable labels such as **Knight to F3**. Review keeps its grade separate and acknowledges accurate moves briefly. Explanations of problem moves prioritize verified consequences. A **Better alternative from the previous position** appears only in Details for a problem move, with a short conditional line when legal. It never replaces the played move's heading or becomes a recommendation overlay.

Stockfish feedback works without an AI service. Click **Explain with AI** for optional wording using your configured Chrome AI, Ollama, or cloud fallback. Full-game analysis does not make an AI request for every move.

Review works with the settings panel closed. It uses consistent local Stockfish comparisons rather than website candidate suggestions. Alternatives remain notation in Details; Kibitz does not draw future positions or recommendation arrows over the review board. A completed-game page waits for **Review with Kibitz** instead of starting ordinary suggestions. To explore recommended moves, open an analysis or study board.

If the selected page does not expose a complete game, expand **Have a PGN instead?** in settings and use **Apply PGN on page**. Paste the game or choose a `.pgn` file while the website displays a matching mainline position on a completed-game or study board. The import supplies history without creating a board. Lichess can also supply the selected finished game's PGN through its public game-export service. Kibitz does not scan your account's game history.

### Follow a study board

- Open a supported study, analysis, review, or computer-practice board. The card updates as the position changes.
- Open **Details** to see other moves and engine lines.
- On analysis boards, **Candidate heatmap** and **Candidate arrows** are independent saved switches. Up to three numbered arrows represent alternative next moves, not consecutive variation moves. Each destination gets one label even with both layers enabled. Blank heatmap squares are not safety ratings.
- Review temporarily hides those analysis switches without changing their values. Returning to an analysis board restores them. Review symbols and consequence highlights are independent of the saved analysis preferences.
- Click the **Kibitz heading** to collapse or expand the card.
- Click **Close** to pause analysis for that tab. In settings, click **Show board card** to bring it back.
- The card prefers a reserved space beside the board. When that space is too narrow or cannot grow safely, it gets its own row below the board/control layout. Expanded explanations do not cover native controls.
- The card and settings panel match the website's colors once when you arrive, then keep that palette through moves, resizing, and theme changes. Another page or a reload allows a fresh match. Move-selection hashes do not reset colors. Unsupported tabs use a neutral system palette captured on arrival.

Changing positions or hiding the tab cancels the old analysis. Kibitz rebuilds piece and capture facts from the selected legal history; going backward restores the earlier position. For an imported starting position or FEN, captures before that starting point remain unknown. Models choose among verified facts, and Kibitz renders the chess statements rather than displaying unchecked model prose. Threat explanations distinguish an attack from a proven material win, and possible replies are hypothetical.

### Choose the move-analysis source

The **Move analysis** setting is separate from the AI provider. Automatic reuses already available Lichess suggestions after checking their position, score format, and legal continuation. If those results are absent or unusable, local Stockfish takes over. Kibitz does not turn on the website's engine or wait for its review report. Select **Kibitz local only** to always use the bundled engine.

Chess.com native-engine reuse is not enabled; Kibitz uses its local engine there. The website/local source setting affects analysis-board suggestions. Completed-game review uses local Stockfish for both grading and consequences; it does not read native candidate advice. Engine attribution appears in Details. No extra cloud-evaluation API calls are made.

### Analyze a position manually

If Kibitz cannot read a board, open **Advanced · analyze a FEN** in settings. A FEN is a text description of a chess position that you can copy from a chess site's analysis tools.

Paste the complete FEN and click **Analyze position**. The result appears in the panel. Manual analysis does not draw arrows on the website's board.

Kibitz checks the position before analyzing it. If turn information, castling rights, or other required details are missing, it asks for a complete position rather than guessing.

## Troubleshooting

| Problem | What to try |
| --- | --- |
| No card appears | Refresh the chess page, open an analysis or study board, and click **Show board card** in settings. Live human games are disabled. |
| Chrome AI is unavailable | Update Chrome and check the linked hardware requirements, or use Ollama or a cloud service. |
| A move appears without an explanation | Stockfish is working. Check the AI setup steps above. |
| Ollama cannot connect | Make sure Ollama is running, the model is downloaded, and `OLLAMA_ORIGINS` matches the origin in Diagnostics. Restart Ollama after changing it. |
| Ollama takes too long | Try a smaller model and update its name in settings. Ollama gets 25 seconds per attempt. |
| Cloud explanations fail | Check the API key, model name, account quota, and Chrome's permission for that service. |
| The board cannot be read | Try **Analyze a FEN**. Some website layouts do not provide enough information for automatic analysis. |
| Review cannot load the selected game | Open the finished game itself from history, then try **Review with Kibitz**. If its complete history is unavailable, use **Apply PGN on page** in settings. |
| Review waits for a matching position | Use the site's mainline move controls. Kibitz needs the selected history and displayed board to agree before drawing guidance. |
| Opening name missing | FEN-only or custom-start history may not establish one. Failed opening-file loading also omits the name; engine feedback remains available. |
| Colors do not follow a site-theme change | The palette stays fixed for this page. Reload or navigate to allow a fresh match. |
| New icon is not visible | Rebuild and reload the extension in `chrome://extensions`. |

Kibitz is a desktop extension. It fits small browser windows, but it does not run on mobile Chrome.

## For developers

Run the tests and build:

```sh
npm test
npm run typecheck
npm run build
```

Tests cover chess positions, game capture/import, native selected-move matching, move ratings, mate and repetition handling, overlay geometry, card allocation, provider fallback, cancellation, outdated results, board detection, and safe text rendering. The build also checks extension files, Stockfish assets, and license files.

For browser checks, set `CHROME_PATH` to a Chrome-for-Testing or compatible Chromium executable, then run:

```sh
node scripts/browser-smoke.mjs
node scripts/browser-smoke.mjs --fail-openings
```

This uses a separate temporary browser profile. It checks the real Stockfish engine, in-page review with settings closed, native move selection, grounded explanations with mock providers, saved overlay toggles, website theme relay, whole-game analysis, adjacent placement and card/control collisions at 240 to 2560 pixels, 200% zoom, using intercepted Chess.com and Lichess fixtures. It also verifies local credential migration, manifest-loaded content scripts, detected FENs, and authenticated background/offscreen message flow. The default run needs no site accounts, cloud connection, or downloaded AI model. Add `--live-sites` to optionally probe public analysis pages. Regular Chrome may block loading extensions this way. The test does not download or verify a real Gemini Nano model. `node scripts/capture-probe.mjs` optionally inspects public game capture and native state; access and page layouts can change. `node scripts/native-engine-probe.mjs` checks populated Lichess analysis in an isolated profile; that diagnostic explicitly toggles the site's engine, while the extension's adapter only reads existing results.

Before a release, also check both sites in light and dark themes, with narrow and wide windows and browser zoom. Try rotating and resizing boards, changing positions and tabs, closing and reopening the card, provider failures, finished positions, and restarting the extension's background worker. Website layouts can change, so automated checks do not cover every case.

Technical notes:

- The gold knight extension icon is bundled at 16, 32, 48, and 128 pixels. Its editable source is `public/icons/kibitz.svg`; run `node scripts/generate-icons.mjs` with `CHROME_PATH` set to regenerate the PNG files.
- Kibitz uses Chrome's Manifest V3 extension format and has no hosted backend.
- Only one analysis runs at a time; old results are ignored.
- The extension reads the site's board position without changing the site's game state.
- Each explanation attempt has a time limit: 12 seconds for Chrome AI, 25 for Ollama, and 20 for cloud. The overall explanation limit is 65 seconds. Engine analysis and the initial Chrome AI download have separate lifecycles.
- Failed partial explanations are discarded before trying another source.
- Runtime payloads and sender contexts are validated before work starts. Expected integration failures use fixed diagnostic codes without raw errors, prompts, keys, or game exports.
- Opening names use a pinned CC0 Lichess dataset; attribution and reproducible source data are in `src/data/OPENINGS-LICENSE.md`. Coaching text is written for Kibitz.

## How results and coaching work

### Engine results and move grades

Engine choice and explanation-model choice are independent. A cloud explanation provider does not select the move. Local Stockfish requests three candidates and approximately 1.5 seconds of search after UCI readiness; initialization takes additional time. Usable website analysis may contain fewer candidates. Whole-game grading retains consistent local before/after searches even when selected-position advice comes from Lichess.

The played move stays in the review heading, with its grade separate from any suggested alternative. Ordinary centipawn losses are measured from the moving side's perspective:

| Condition | Grade |
| --- | --- |
| Played move matches the preferred candidate | Best |
| Loss up to 20 centipawns | Excellent |
| Loss above 20 and up to 50 | Good |
| Loss above 50 and up to 100 | Inaccuracy |
| Loss above 100 and up to 200 | Mistake |
| Loss above 200 | Blunder |

Mate and terminal outcomes use separate rules, including Checkmate and Missed mate. Scores and grades are provisional search estimates, not the website's accuracy score. Positive scores always favor White. Candidate arrows 1–3 are alternatives for the same player, not consecutive moves in a variation. Blank heatmap squares have not been rated for safety.

The internal Best and Excellent grades are both displayed as **Accurate** during review. Review uses symbols, outlines and concise consequences; the numbered candidate arrows described above belong to analysis boards. A geometric attack alone never earns a consequence cue: the target must be supported by a legal searched line. Later-line effects are explicitly hypothetical, and the highlighted piece is mapped back to its square on the board currently displayed, including en-passant victims and moved pieces.

### Grounded explanations

The application legally replays history, constructs the current piece inventory, and detects supported effects: captures, checks, development, central influence, cleared bishop/queen lines, and castling preparation. An attacked piece is not automatically lost. A positional benefit is not proof that a move is uniquely best, and hypothetical replies are not predictions.

Providers return a small JSON plan naming approved facts and a controlled tone variant. Kibitz validates those references and renders the chess statements itself. Unsupported plans fall directly back to application wording; they do not trigger more paid requests. Failed partial output is never displayed. The validated paragraph replaces the main explanation rather than appending a duplicate.

History is scoped to the selected move. Going backward restores pieces and removes later captures. A FEN alone cannot establish past captures or the game's opening. Custom-start games retain only the history following that starting position.

### Opening recognition

The pinned local dataset contains 3,865 opening sequences. Recognition requires legal standard-start history and uses the longest recognized prefix or a verified transposition. A known specific variation is not replaced arbitrarily by another name for a similar position. Details distinguishes **Opening so far** from an opening a suggested move **would enter**. Leaving a known sequence is not automatically a mistake.

The opening file loads only when history makes lookup possible. Engine feedback appears immediately; the name can arrive afterward. A missing, delayed, or invalid opening file omits optional metadata while coaching remains usable. The last recognized opening is historical context, not a claim that every subsequent move remains in book. Teaching notes are original Kibitz text.

## Privacy, storage, and migration

Local Stockfish and application-rendered coaching do not require cloud access. Chrome AI runs on-device after its model is available; Ollama requests go to localhost. If a cloud provider is enabled and selected, its prompt receives the position, piece inventory, scoped verified facts, and relevant recent capture/promotion context. Player names, page comments, and account credentials are not intentionally included. Provider data handling and billing are governed by that service.

Lichess game capture may contact its export endpoint for the selected completed game. Opening recognition reads a packaged local file and does not call an opening service.

| Storage | Contents |
| --- | --- |
| Chrome sync | Provider choices, model names, engine-source preference |
| Chrome local | API keys, migration marker/deletion records, overlay preferences |
| Chrome session | Active-request metadata, selected-game sessions, website palette relay |
| In-memory caches | Engine evaluations and the opening lookup while their owning context lives |

Local and sync access is restricted to trusted extension contexts. The settings form gets configured flags, never saved keys. Untouched fields preserve keys; replacements update them; **Remove saved key** takes effect when you save. Local storage is not an encrypted vault. Clearing extension data or removing Kibitz can remove local keys.

Migration preserves existing local credentials, writes imported keys and a migration marker locally before removing synced copies, and serializes initialization/saves. Cleanup retries after interrupted writes. Explicit deletion records prevent older synced settings from restoring a removed key. Failed local migration retains legacy data and continues without cloud credentials for that load. Cross-area writes are not atomic; an offline Chrome profile that missed a synchronized key may need re-entry.

Runtime contracts check payload structure and sender context. Settings operations require the extension panel URL; offscreen events require the offscreen document; content requests require supported top-frame origins and applicable active-tab restrictions. Request/session identity and generation guards prevent superseded results from being applied. Fixed diagnostic codes exclude raw exceptions, authorization headers, keys, prompts, positions, and game exports.

No new permissions are required for lazy opening data or the gold knight icon. The opening file is not exposed as a web-accessible resource. Cloud host permissions remain optional. All executable extension code and the engine are packaged locally.

## Runtime architecture

| Context | Responsibility | Main modules |
| --- | --- | --- |
| Content script | Board detection and verification, card, overlays, native selected-move review, immediate factual display | `content.ts`, `adapters.ts`, `card.ts`, `in-page-review.ts`, `overlay.ts` |
| Background worker | Authorization, settings and credentials, native-page reads, routing and cancellation ownership | `background.ts`, `messages.ts`, `settings.ts` |
| Offscreen document | Engine jobs, before/after comparisons, opening lookup, provider attempts | `offscreen.ts`, `review-analysis.ts`, `opening-loader.ts`, `providers.ts` |
| Stockfish worker | Locally packaged UCI engine and WASM search | `engine.ts`, `dist/engine/` |
| Side panel | Setup, credential changes, capture/import controls, manual FEN results | `sidepanel.ts`, `sidepanel.html` |

A page position travels through background to offscreen analysis, then returns to its source tab. Content displays verified factual guidance immediately; optional validated AI wording replaces it afterward. Manual FEN results return to the panel instead. Only one engine/analysis job is active at a time.

Review legally replays game history and keeps the native board authoritative. Opening metadata can accompany a cached result or arrive later as `REVIEW_OPENING`; it is checked against the matching session, request, ply, and verified current board. Late metadata from a canceled request is discarded, and matching cached results retain their metadata.

Opening-file loading shares one promise and one initialized lookup per offscreen lifetime. Canceling one waiter does not abort another waiter's shared load. Fetch has a two-second deadline; a failure backs off for 30 seconds before another eligible request can retry. No index is loaded for FEN-only or custom-start analysis. Local engine/factual results do not wait for the file.

## Bundle optimization and measurements

The avoidable startup cost was a 660,425-byte opening index embedded in both content and offscreen JavaScript. It is now copied once to `dist/data/openings.json` and loaded only by the offscreen context when needed. No chess tab builds a duplicate opening lookup.

The content bundle remains a standalone IIFE. Extension pages share ESM chunks. Both builds target Chrome 116, unnecessary module-preload compatibility code is disabled, and lightweight piece labels are separated from history replay. Stockfish's engine files, search strength, and candidate count remain unchanged.

Representative raw sizes, rounded to decimal KB/MB:

| Asset | Before | After |
| --- | ---: | ---: |
| Content JavaScript | 766 KB | 105 KB |
| Offscreen JavaScript | 688 KB | 31 KB |
| Opening index | Embedded twice | One 660 KB lazy data asset |
| Entire extension | 8.91 MB | 8.24 MB |
| Stockfish WASM | 7.28 MB | 7.28 MB |

The exact baseline is in `docs/bundle-baseline.json`. Current sizes vary with edits; use the report for exact figures. Gzip sizes describe compression potential, not parsing cost, runtime memory, or guaranteed Chrome Web Store package size. Some chess-rule code remains in both isolated contexts because content still needs legal verification.

### Repeatable reports and size budgets

```sh
npm run bundle:report
npm run bundle:check
node scripts/benchmark-openings.mjs
```

Run these after a build. `npm run build` already runs budget checks. Rollup module attribution and reports are written under ignored `.bundle/`, outside the packaged extension. The report lists raw/gzip sizes, differences from baseline, and modules present in both build contexts. Per-module rendered sizes precede final minification; final file sizes are measured directly.

`scripts/bundle-budgets.json` caps content at 200,000 bytes, offscreen at 100,000, all non-engine JavaScript at 300,000, the opening asset at 665,000, and the package at 8,500,000. Checks reject missing budgeted files, re-embedded opening data, and multiple opening assets. Changes to budgets should explain a measured tradeoff.

A lossless shared-prefix experiment reduced raw opening data by only about 8%, increased gzip size from roughly 89 KB to 104 KB, and decoded more slowly in the recorded run. The shipped format remains simple JSON. The benchmark verifies exact round-trip preservation of every sequence/FEN and reports fresh measurements; Node decoding timings are not browser startup timings.

### Runtime measurements and browser failure coverage

Browser smoke writes `performance.json` into its printed temporary profile directory. It separates first manual engine-result latency, content initialization, engine initialization, and opening-file loading:

- `kibitz:content-init` measures synchronous initialization after the bundle starts executing. It excludes JavaScript parsing and later board discovery.
- `kibitz:engine-init` measures worker creation through UCI readiness, excluding the subsequent search. The latest sample is retained.
- `kibitz:opening-load` includes packaged-file fetch, JSON parsing, and lookup construction.

These measurements depend on hardware and scheduling; they are not universal latency promises. First-result latency also includes extension routing and real engine search. No historical startup timings were captured, so byte reductions do not imply a measured percentage speedup.

The normal smoke test adds 750ms of synthetic delay to its first opening fetch. Its opening-load measurement includes that delay; use browser measurements without the test wrapper when assessing real packaged-file latency.

The normal smoke path deliberately delays opening loading, verifies that names eventually appear, and checks that preceding FEN-only requests did not fetch the file. `--fail-openings` simulates a missing file while checking that factual guidance and review still work. Run browser invocations sequentially because the runner uses a fixed debugging port. It mocks AI providers and never verifies a real Gemini Nano download or inference.

On PowerShell, select a compatible test browser before running:

```powershell
$env:CHROME_PATH = 'C:\path\to\chrome.exe'
node scripts/browser-smoke.mjs
node scripts/browser-smoke.mjs --fail-openings
```

To regenerate local assets, use `node scripts/index-openings.mjs` for the pinned checked-in TSVs and `node scripts/generate-icons.mjs` with `CHROME_PATH` for the editable SVG. Rebuild afterward. Keep source attribution when updating the opening dataset.

Further performance work could reuse a warmed Stockfish worker, but would need separate stop/reset and stale-output tests. Dataset packing, search-time changes, and build-tool upgrades should be evaluated independently rather than hiding a chunk warning or weakening legal checks.

## Data and licenses

Kibitz includes unmodified Stockfish.js 17.1.0 engine files. Stockfish is licensed under GPL-3.0.

The build puts its license in `dist/engine/COPYING.txt` and source information in `dist/ENGINE-SOURCE.txt`. Keep these files and follow the GPL distribution requirements when sharing the engine files. Kibitz does not load executable code from a remote server.

Opening names/sequences use the CC0 Lichess dataset pinned to commit `a6189a30dc273ccb21fc2536a9a2fefd5592a67a`. Source TSVs, attribution, and revision live in `src/data/`; the build includes `OPENINGS-LICENSE.md`, `openings-revision.txt`, and exactly one generated 3,865-row index. Coaching notes are original application text.
