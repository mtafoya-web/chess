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

You need **desktop Chrome 116 or newer**. For a packaged release, unzip `releases/kibitz-1.2.3.zip`, open `chrome://extensions`, enable Developer mode, choose Load unpacked, and select the extracted folder. End users do not need Node.js.

To build from source, use **Node.js 22 or newer**, which includes npm. Built-in Chrome AI has additional browser and hardware requirements; Kibitz checks availability at runtime. See [Chrome's current Prompt API documentation](https://developer.chrome.com/docs/ai/prompt-api).

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

Click the **Kibitz extension icon** to open the review workspace, then choose **Settings** for optional AI configuration. Core review and verified explanations work without configuring AI. If the icon is hidden, find Kibitz in Chrome's Extensions menu (the puzzle-piece icon).

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
3. Wait for the model download to finish. Progress appears in the panel. **Model available** means download readiness. Save **Chrome AI only** and choose **Test AI** to verify actual inference; the result identifies availability, creation, generation, or validation failures.

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

1. Finish a game or open a finished game on Chess.com or Lichess. Kibitz captures the completed history and starts reviewing automatically. Settings ? **Automatically review finished games** controls this behavior. **Review with Kibitz** on the card and **Review selected game** in the panel also start or explicitly restart a review.
2. A pausable whole-game pass grades every played move without moving the website board. Selecting a move takes priority; the whole-game pass resumes afterward. Preliminary feedback appears before deeper confirmation finishes. A temporarily unreadable board clears selected-move guidance while the captured game continues to be analyzed.
3. Use **Review** in the panel for the evaluation graph, player accuracy, key moments, and takeaways. The position selector is a keyboard-accessible alternative to clicking the graph.
4. Choose **Next key moment**, or use the website's existing move controls. White / Black / Both filters affect lesson selection; orientation does not determine player identity.
5. Select a learning level: Beginner adds everyday explanations and a practical lesson; Intermediate focuses on the verified consequence; Advanced includes concise notation and the searched line. The underlying assessment is the same.
6. Choose **Show why** to reveal consequence highlights. **Show better move** returns to the earlier position and reveals a single alternative arrow when native navigation can verify it. Otherwise, use the text in Details and the website controls.
7. Choose **Try a better move** for an exercise. Kibitz hides its evaluation, explanation, and solution overlays. Enter SAN such as `Nf3`, or select From / To / Promotion without needing notation. Hints, reveal, skip, and Return to game remain available.
8. Visit **Lessons** for saved reviews, recurring themes, exercise outcomes, and deletion controls. Refresh restores compatible results and the requested running/paused state. Hidden tabs pause calculation and resume when shown, unless manually paused. Exit review or Close suppresses automatic restart for that game in the current tab, including after refresh. Deleted reviews require an explicit restart.

Native Chess.com PGN may omit `Link` and `GameId` headers. On an individual game page, Kibitz uses the page game ID, validates the complete PGN, and confirms the result and legal move history before starting. Explicitly conflicting identities and unfinished exports remain blocked.

Review keeps the website's board and does not require the site's review report. Core analysis runs locally. Optional AI wording uses the existing local-first provider chain; failed providers leave deterministic feedback available. A background sweep does not request AI wording for every position.

**Kibitz accuracy** is a versioned engine estimate, not a player rating or the site's own score. Assessments use mover-relative winning-chance loss: up to 2 percentage points is Excellent (Best also requires matching the engine choice), then Good through 5, Inaccuracy through 10, Mistake through 20, and Blunder above 20. Mate outcomes are handled separately. Centipawn changes remain in Details and do not mean that pieces were captured. Game accuracy combines volatility weighting and a harmonic mean. The actual imported initial-position evaluation is used for custom starts.

Standard searches use 1,500 ms and confirmation uses 5,000 ms per position. Serious errors, mate transitions, boundary cases, and conflicting searches receive confirmation. Disagreement remains provisional and is excluded from lesson selection. Ordinary checks, equal exchanges, and incomplete recaptures do not establish material losses. The captured `4. g3` central-tension regression still explains the verified recapture difference without inventing a material loss.

Practice checks a separate legal branch and leaves the recorded game intact. An alternative within two winning-chance percentage points of the preferred continuation can be accepted when it avoids a worse mate outcome. Uncertain answers do not affect solution statistics. Native-board variation input is not enabled; SAN and square entry are the supported practice methods. The website's own engine UI may remain visible: Kibitz can hide its own answers, not another product's controls.

History is stored only on this Chrome profile, limited to 50 games, 500 attempt records, and 5 MiB. Provider prompts and AI prose are not retained. Clear learning history and per-game deletion include protection against delayed writes recreating deleted records. Explicitly starting that game again permits a new saved review. Engine/scoring changes invalidate incompatible results. Optional level suggestions require five complete reviews and ten first-attempt outcomes; they never change the level automatically.

If capture fails, expand **Have a PGN instead?** and import one standard-chess game while the website displays a matching position. Unsupported navigation asks you to use the site's controls rather than guessing.

### Follow a study board

- Open a supported study, analysis, review, or computer-practice board. The card updates as the position changes.
- Open **Details** to see other moves and engine lines.
- On analysis boards, **Candidate heatmap** and **Candidate arrows** are independent saved switches. Up to three numbered arrows represent alternative next moves, not consecutive variation moves. Each destination gets one label even with both layers enabled. Blank heatmap squares are not safety ratings.
- Review temporarily hides those analysis switches without changing their values. Returning to an analysis board restores them. Review symbols and consequence highlights are independent of the saved analysis preferences.
- Click the **Kibitz heading** to collapse or expand the card.
- Click **Close** to pause analysis for that tab. In settings, click **Show board card** to bring it back.
- The card prefers a reserved space beside the board. When that space is too narrow or cannot grow safely, it gets its own row below the board/control layout. Expanded explanations do not cover native controls.
- The card and settings panel match the website's colors once when you arrive, then keep that palette through moves, resizing, and theme changes. Another page or a reload allows a fresh match. Move-selection hashes do not reset colors. Unsupported tabs use a neutral system palette captured on arrival.

Changing positions or hiding the tab cancels the old analysis. Kibitz rebuilds piece and capture facts from the selected legal history; going backward restores the earlier position. For an imported starting position or FEN, captures before that starting point remain unknown. **Explain further** requests AI coaching using the move, evaluation, verified positional evidence, and short legal continuations. AI coaching can contain mistakes; its evidence references and response structure are checked, but those checks cannot prove every sentence correct. Verified feedback remains available if AI fails.

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
| Extension context invalidated after a reload | Refresh each open chess tab after reloading/updating Kibitz. Version 1.2.1 stops old content scripts and removes stale overlays. Home/account pages without a board are normal and remain quiet. |
| No card appears | Refresh the chess page, open an analysis or study board, and click **Show board card** in settings. Live human games are disabled. |
| Chrome AI is unavailable | Update Chrome and check the linked hardware requirements, or use Ollama or a cloud service. |
| Chrome AI says available but explanations fail | Model availability is separate from inference. Save **Chrome AI only**, then click **Test AI** and report the displayed stage and reason. A verified result must come from the explanation worker, not a cached answer. |
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

For the 1.2 changes, the extension is compiled and packaged locally; browser behavior and real AI inference are verified with you using the [manual walkthrough](docs/manual-testing.md). Automated suites and probes are not run on your behalf.

The existing developer checks remain available when you choose to run them:

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

This uses a separate temporary browser profile. It checks the real Stockfish engine, in-page review with settings closed, native move selection, grounded explanations with mock providers, saved overlay toggles, website theme relay, whole-game analysis, docking below native notation, scroll/resize revalidation, and card/control collisions at 240 to 2560 pixels, 200% zoom, using intercepted Chess.com and Lichess fixtures. It also verifies local credential migration, manifest-loaded content scripts, detected FENs, and authenticated background/offscreen message flow. The default run needs no site accounts, cloud connection, or downloaded AI model. Add `--live-sites` to optionally probe public analysis pages. Regular Chrome may block loading extensions this way. The test does not download or verify a real Gemini Nano model. `node scripts/capture-probe.mjs` optionally inspects public game capture and native state; access and page layouts can change. `node scripts/native-engine-probe.mjs` checks populated Lichess analysis in an isolated profile; that diagnostic explicitly toggles the site's engine, while the extension's adapter only reads existing results.

Before a release, also check both sites in light and dark themes, with narrow and wide windows and browser zoom. Try rotating and resizing boards, changing positions and tabs, closing and reopening the card, provider failures, finished positions, and restarting the extension's background worker. Website layouts can change, so automated checks do not cover every case.

Technical notes:

- The gold knight extension icon is bundled at 16, 32, 48, and 128 pixels. Its editable source is `public/icons/kibitz.svg`; run `node scripts/generate-icons.mjs` with `CHROME_PATH` set to regenerate the PNG files.
- Kibitz uses Chrome's Manifest V3 extension format and has no hosted backend.
- Only one analysis runs at a time; old results are ignored.
- The extension reads the site's board position without changing the site's game state.
- Each explanation attempt has a time limit: 30 seconds for Chrome AI, 25 for Ollama, and 20 for cloud. The overall explanation limit is 80 seconds. Engine analysis and the initial Chrome AI download have separate lifecycles.
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

Providers receive a bounded coaching context: positions, played and preferred moves, evaluations, learning level, verified positional facts and causes, and up to three legal branches of eight plies each. This compact comparison helps explain a move and the opponent's replies without sending the full search tree. Providers return structured prose with an explanation, a practical takeaway, and evidence references. Beginner, Intermediate, and Advanced share the same engine assessment and differ in explanation style.

Kibitz checks the response shape, length, referenced facts and continuation steps, plus known unsupported claim patterns. These checks do not guarantee that arbitrary AI prose is correct. Failed partial output is never displayed. Automatic mode tries the next eligible provider when a response fails validation; a selected-only provider falls back to deterministic verified wording. Chrome generation retries once without response constraints when Chrome rejects those generation options. Generation errors are reported separately from unavailable hardware. Explanation attribution and diagnostic details are kept in Details.

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
| Content script | Verified selected-move presentation, card, overlays and native controls | `content.ts`, `adapters.ts`, `card.ts`, `in-page-review.ts`, `overlay.ts` |
| Site snapshot | One serializable MAIN-world reader for page location, game identity, completion and native selection | `site-snapshot.ts` |
| Review coordinator | Whole-game queue, selected-move priority, pause/resume, completion and cancellation | `review-coordinator.ts` |
| Background worker | Authorization, settings/credentials, shared snapshot reads, capture and event routing | `background.ts`, `messages.ts`, `settings.ts` |
| Offscreen document | Engine jobs, before/after comparisons, opening lookup, provider attempts | `offscreen.ts`, `review-analysis.ts`, `opening-loader.ts`, `providers.ts` |
| Stockfish worker | Locally packaged UCI engine and WASM search | `engine.ts`, `dist/engine/` |
| Side panel | Setup, credential changes, capture/import controls, manual FEN results | `sidepanel.ts`, `sidepanel.html` |

A page position travels through background to offscreen analysis, then returns to its source tab. Content displays verified factual guidance immediately; automatically requested, validated AI wording replaces it afterward. Analysis and review share the explanation pipeline, using typed pending, ready, fallback and failed events correlated with the request and position. Manual FEN results return to the panel instead. Only one engine/analysis job is active at a time.

Review legally replays game history and keeps the native board authoritative. Opening metadata can accompany a cached result or arrive later as `REVIEW_OPENING`; it is checked against the matching session, request, ply, and verified current board. Late metadata from a canceled request is discarded, and matching cached results retain their metadata.

Opening-file loading shares one promise and one initialized lookup per offscreen lifetime. Canceling one waiter does not abort another waiter's shared load. Fetch has a two-second deadline; a failure backs off for 30 seconds before another eligible request can retry. No index is loaded for FEN-only or custom-start analysis. Local engine/factual results do not wait for the file.

## Bundle optimization and measurements

The avoidable startup cost was a 660,425-byte opening index embedded in both content and offscreen JavaScript. It is now copied once to `dist/data/openings.json` and loaded only by the offscreen context when needed. No chess tab builds a duplicate opening lookup.

The content bundle remains a standalone IIFE. Extension pages share ESM chunks. Both builds target Chrome 116, unnecessary module-preload compatibility code is disabled, and lightweight piece labels are separated from history replay. Stockfish's engine files, search strength, and candidate count remain unchanged.

Representative raw sizes, rounded to decimal KB/MB:

| Asset | Before | Current |
| --- | ---: | ---: |
| Content JavaScript | 766 KB | 124 KB |
| Offscreen JavaScript | 688 KB | 44 KB |
| Opening index | Embedded twice | One 660 KB lazy data asset |
| Entire extension | 8.91 MB | 8.28 MB |
| Stockfish WASM | 7.28 MB | 7.28 MB |

The exact baseline is in `docs/bundle-baseline.json`. Current sizes vary with edits; use the report for exact figures. Gzip sizes describe compression potential, not parsing cost, runtime memory, or guaranteed Chrome Web Store package size. Some chess-rule code remains in both isolated contexts because content still needs legal verification.

### Repeatable reports and size budgets

```sh
npm run bundle:report
npm run bundle:check
node scripts/benchmark-openings.mjs
```

Run these after a build. `npm run build` already runs budget checks. Rollup module attribution and reports are written under ignored `.bundle/`, outside the packaged extension. The report lists raw/gzip sizes, differences from baseline, and modules present in both build contexts. Per-module rendered sizes precede final minification; final file sizes are measured directly.

`scripts/bundle-budgets.json` caps content at 200,000 bytes, offscreen at 100,000, all non-engine JavaScript at 350,000, the opening asset at 665,000, and the package at 8,500,000. Checks reject missing budgeted files, re-embedded opening data, and multiple opening assets. Changes to budgets should explain a measured tradeoff.

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

Stockfish already reuses completed workers; cancellation terminates an in-flight worker to isolate stale UCI output. The 1.2 cleanup also shares short-lived site reads, removes panel review polling and duplicate game replay, and bounds model prompts. Dataset packing, search-time changes, and build-tool upgrades should be evaluated independently rather than hiding a chunk warning or weakening legal checks.

## Data and licenses

Kibitz includes unmodified Stockfish.js 17.1.0 engine files. Stockfish is licensed under GPL-3.0.

The build puts its license in `dist/engine/COPYING.txt` and source information in `dist/ENGINE-SOURCE.txt`. Keep these files and follow the GPL distribution requirements when sharing the engine files. Kibitz does not load executable code from a remote server.

Opening names/sequences use the CC0 Lichess dataset pinned to commit `a6189a30dc273ccb21fc2536a9a2fefd5592a67a`. Source TSVs, attribution, and revision live in `src/data/`; the build includes `OPENINGS-LICENSE.md`, `openings-revision.txt`, and exactly one generated 3,865-row index. Coaching notes are original application text.

### Existing automated development checks

```sh
npm test
npm run build
npm run benchmark:coaching
npm run package
```

`npm run package` also requires Python 3 for the standard-library ZIP packager. It creates a versioned extension ZIP and SHA-256 checksum in `releases/`. No hosting or store publication occurs.

The browser scripts prefer installed testing Chromium, or accept `CHROME_PATH`. Ordinary Chrome builds may refuse command-line extension loading. `node scripts/browser-smoke.mjs` covers the extension pipeline, native fixtures, overview, reveal, practice, resume, deletion, and responsive placement. AI inference in that suite is mocked. `node scripts/ai-placement-smoke.mjs` tests real provider availability separately; an unavailable provider is not a successful inference.

The coaching benchmark uses the same analyzer and pinned engine through a Node worker adapter. Its examples, evidence, timings, and blank expert-comparison rubric are written to `.bundle/coaching-benchmark/`. This is a local correctness and performance aid, not evidence that Kibitz matches or exceeds Chess.com coaching.

The JavaScript budget is 350,000 bytes for the new review model, practice UI, overview, and storage validation. The total package limit remains 8.5 MB and the content-script limit remains 200 KB. See [RELEASE_READINESS.md](RELEASE_READINESS.md) for verification boundaries and human release gates.
