# Kibitz Feature Guide

Audience: team members, QA, trainers, and users sharing Kibitz 1.2.3

This guide describes the behavior implemented in the repository. It is based on the production source and existing README, test, and design documentation. It does not describe paid-site reports or Chromium features that the package does not yet verify.

## 1. What Kibitz does

Kibitz is a Chrome Manifest V3 extension for **Chess.com** and **Lichess**. It keeps the site's native board authoritative and adds a study card beside or below it.

Current features include:

- Local Stockfish 17.1 analysis and move recommendations
- Completed-game review, accuracy estimates, key moments, and takeaways
- Selected-move critique on the native board
- Beginner, Intermediate, and Advanced coaching language
- Better-move and board-cue practice
- Optional Chrome AI, Ollama, Gemini, OpenAI, or Groq explanations
- Optional reuse of usable Lichess native analysis
- Manual FEN and PGN review/import
- Saved review history and practice outcomes
- Responsive, keyboard-accessible side-panel and board-card controls

Core move analysis and verified explanations work without an AI provider. Live human games do not receive move advice.

## 2. Installation and reload

### Packaged release

Requirements:

- Desktop Chrome 116 or newer
- No Node.js is required for the packaged ZIP

1. Extract `releases/kibitz-1.2.3.zip`.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked**.
5. Select the extracted folder.

### Build from source

Requirements:

- Node.js 22 or newer
- npm

```sh
npm ci
npm run build
```

Load the project's `dist` folder through **Load unpacked** at `chrome://extensions`.

After source or extension changes:

1. Run `npm run build`.
2. Click **Reload** on Kibitz's extension card.
3. Refresh every open Chess.com or Lichess tab.

An old content script and its page card should not be assumed to reconnect until the tab is refreshed.

## 3. Open the workspace

Click the Kibitz extension icon. If the icon is hidden, open it from Chrome's puzzle-piece Extensions menu.

The side panel has three sections:

- **Review**: select or capture a completed game and inspect its overview
- **Lessons**: open saved games, recurring themes, and learning history
- **Settings**: configure AI, move analysis, automatic review, and manual positions

On a supported board, Kibitz also renders an in-page card near the native board. The heading can collapse or expand the card.

## 4. Chess.com review workflow

1. Open a completed game from Chess.com history or leave a live game open until it reaches a confirmed result.
2. With **Automatically review finished games** enabled, Kibitz should capture the completed history and begin the review.
3. If it does not start, open the Kibitz side panel and choose **Review selected game**.
4. Use the native move list or Kibitz's **Next key moment** control.
5. Keep the native board visible; Kibitz does not replace it with a second replay board.

Chess.com capture uses the page/game identity and complete PGN or available history. It verifies the result and legal move history before starting. An unfinished export, mismatched identity, or incomplete history is not accepted as a review.

Chess.com native-engine reuse is not enabled. Kibitz uses its local engine consistently for completed-game grading and consequences.

## 5. Lichess review workflow

1. Open a finished Lichess game on its original result board.
2. Kibitz captures the history automatically if automatic review is enabled.
3. Otherwise open Kibitz and choose **Review selected game**.
4. Use native move controls, the review graph, or the position selector.

Both legacy game links and `/game/…` links are in scope. Kibitz can follow mainline positions, but should be returned to the mainline if native variations do not provide a verified position.

On an analysis board, Kibitz may reuse an already-present and position-correlated Lichess evaluation. The runtime adapter never starts or toggles the Lichess engine. It falls back to local Stockfish if native results are absent, stale, incomplete, or unusable.

## 6. Analysis-board use

Open a study, analysis, review, or computer-practice board.

The card shows:

- Recommended move and engine evaluation
- Positive values for a White advantage and negative values for a Black advantage
- Candidate moves and continuation notation
- Optional AI or verified deterministic explanations
- A **Details** section with alternatives and analysis evidence

Analysis-board switches:

- **Candidate heatmap**: independent saved visual preference
- **Candidate arrows**: independent saved visual preference
- Up to three arrows show alternatives for the same position, not a chain of consecutive moves
- Blank heatmap squares have not been rated

Changing positions, hiding the tab, or losing a reliable board match cancels stale analysis. Going backward restores the position and history prefix. Imported FEN can provide only evidence after the supplied starting position.

### Move analysis source

In Settings, **Move suggestions** has two choices:

- **Automatic**: use usable Lichess page analysis after fresh-position and legal-line validation; otherwise use Kibitz local Stockfish
- **Local engine**: always use bundled Stockfish

This source is separate from the optional AI explanation provider.

## 7. Manual FEN and PGN

### Analyze a FEN

1. Open Settings.
2. Expand **Advanced · analyze a FEN**.
3. Paste a complete FEN.
4. Choose **Analyze position**.

Complete turn, castling, en-passant, and position data are required. Manual results appear in the panel rather than on a separate board.

### Import PGN

1. Display a matching position on the Chess.com or Lichess board.
2. Open the panel's **More options**.
3. Expand **Have a PGN instead?**.
4. Paste the PGN or choose a `.pgn` or `.txt` file.
5. Choose **Apply PGN on page**.

The import accepts one standard-chess game:

- Maximum PGN size: 256 KiB
- Maximum reviewed length: 1,500 plies
- Chess960 and other variants are rejected
- Multiple-game PGNs are ambiguous and rejected

The imported position must correspond to the currently displayed website position.

## 8. Whole-game review

When a review starts, Kibitz replays and grades the captured game without moving the website board.

The review can show:

- Rising reviewed-position count
- White and Black Kibitz accuracy estimates
- Evaluation graph
- Keyboard-accessible position selector
- Move-assessment totals
- Key moments
- Takeaways
- Provider attribution and AI explanation status

Whole-game review uses a 1,500 ms standard search and a 5,000 ms confirmation search. Deeper confirmation can take several minutes. The work is pausable and hidden tabs pause it; returning to the tab can resume requested work.

The review card's actions include:

- **Analyze whole game** / **Pause analysis**
- **Next key moment**
- **Try a better move**
- **Show why**
- **Show better move**
- **Analyze deeper**
- **Explain with AI**
- **Retry selected move**
- **Exit review**

**Close** in the card pauses analysis. **Show board card** in Settings or the panel's More options brings it back. Use **Exit review** or Close to suppress automatic restart for that game in that tab until a new explicit review.

## 9. Learning levels

The side panel and board card both provide:

- **Beginner**: everyday language and a practical lesson
- **Intermediate**: the verified consequence and short comparison
- **Advanced**: concise SAN, search qualification, and a searched line

The engine grade is shared by all levels; only wording and notation change.

The panel may suggest a level after enough completed reviews and first-attempt practice outcomes. It never changes the level automatically.

The review-move filter has **Both players**, **White**, and **Black**. The filter changes lesson selection, not the identity of a move or the board orientation.

## 10. Move grades and accuracy

Grades use mover-relative winning-chance loss:

| Mover-relative loss | Grade |
| --- | --- |
| Matches preferred candidate; or a very small loss | Accurate / Best or Excellent |
| About 2–5 percentage points | Good |
| About 5–10 percentage points | Inaccuracy |
| About 10–20 percentage points | Mistake |
| Above about 20 percentage points | Blunder |

Mate and terminal outcomes use separate Checkmate and Missed mate rules. Internal Best/Excellent results are displayed as **Accurate** in review.

Important qualifications:

- Kibitz accuracy is an engine estimate, not a Chess.com/Lichess player rating or prediction
- Provisional results can change after confirmation
- Centipawn changes are not evidence that pieces were captured
- An attack or check alone does not prove material loss
- Searched lines are possibilities unless the evidence establishes a forced outcome
- AI can make mistakes even though Kibitz validates evidence references and response structure

## 11. Practice

Practice is available for a confirmed problem move in the board card.

1. Select the problem move.
2. Choose **Try a better move**.
3. Kibitz pauses the whole-game sweep and navigates to the earlier position.
4. Enter SAN such as `Nf3`, or choose **From**, **To**, and **Promote to**.
5. Choose **Check my move**.

Practice controls:

- **Hint** gives a lesson or identifies the relevant piece
- **Reveal answer** shows one engine improvement and line
- **Skip** records a skipped outcome
- **Return to game** leaves practice and restores the game position

Practice uses a separate legal branch and does not alter the recorded game. Kibitz hides its evaluation, explanation, and solution overlays during practice. It cannot hide an unrelated engine UI from the chess site.

An alternative is accepted when it stays within about two winning-chance percentage points and avoids a worse mate outcome. Disagreeing or uncertain searches do not count as a confirmed solution.

## 12. History and resume

Open **Lessons** in the side panel to see:

- Saved completed-game reviews
- Recurring themes
- Practice counts
- Per-review deletion
- Links to the original game when available
- Level suggestions

History is scoped to this Chrome profile and limited to:

- 50 saved games
- 500 practice-attempt records
- 5 MiB of review data

Provider prompts and AI prose are not saved. Deleting a saved review or clearing learning history suppresses delayed recreation. A later explicit review can create a new record.

To resume, open the original Chess.com or Lichess game and use **Open game to resume**, or explicitly start **Review selected game**. Refreshing a running review preserves compatible results and the requested running/paused state. Manual pause survives refresh.

## 13. AI providers

The default **Automatic** mode tries providers in this order:

1. Chrome AI (Gemini Nano)
2. Ollama
3. Selected cloud provider

If a source is unavailable or fails, Kibitz tries the next eligible source. Verified deterministic wording remains available if every AI source fails.

| Provider | Setup | Notes |
| --- | --- | --- |
| Chrome AI | Settings → Enable Chrome AI | On-device; model download required; no API key |
| Ollama | Install Ollama, pull a model, allow the extension origin | Local server at `localhost:11434` |
| Gemini | Configure model and API key | Optional cloud fallback |
| OpenAI | Configure model and API key | Optional cloud fallback |
| Groq | Configure model and API key | Optional cloud fallback |

### Chrome AI

1. Open Settings.
2. Choose **Enable Chrome AI**.
3. Wait for the download.
4. Save **Chrome AI only**.
5. Choose **Test AI**.

**Model downloaded** means availability, not successful inference. The test reports availability, creation, generation, or validation status and should say that a validated sample explanation succeeded.

Chrome AI hardware and browser support varies.

### Ollama

1. Install Ollama and download a model:

   ```sh
   ollama pull qwen3:4b
   ```

2. Copy Kibitz's extension origin from Settings → Ollama.
3. Start Ollama with that origin allowed:

   ```powershell
   $env:OLLAMA_ORIGINS="chrome-extension://<KIBITZ-EXTENSION-ID>"; ollama serve
   ```

4. Quit and restart an existing Ollama tray process after changing environment variables.
5. Choose **Check connection**, then save settings.

Default model: `qwen3:4b`. Ollama is attempted for 25 seconds per explanation and Chrome AI for 30 seconds.

### Cloud providers

1. Open Settings.
2. Choose a cloud provider under **Cloud fallback**.
3. Enter a model and API key.
4. Save settings and approve Chrome's host permission.
5. Use **Test AI** to validate the saved setup.

Automatic mode uses cloud only after Chrome AI and Ollama fail. A cloud-only mode sends requests directly to the selected service. API calls can cost money, including failed attempts.

API keys are stored in local extension storage, not sync storage. Local storage is not an encrypted credential vault. Enter a replacement key or choose **Remove saved key**, then save settings. Keys are not returned to the form or chess pages.

## 14. Settings reference

| Setting | Behavior |
| --- | --- |
| Automatically review finished games | Starts review after confirmed completion or opening a completed game |
| Move suggestions | Automatic website/local selection or Kibitz local-only |
| Explanation mode | Automatic, Chrome AI only, Ollama only, Gemini only, OpenAI only, or Groq only |
| Cloud fallback | Gemini, OpenAI, or Groq |
| Cloud model | Service/model name sent to the selected cloud API |
| API key | Saved locally and used only for the selected cloud provider |
| Ollama model | Downloaded local model name |
| Learning level | Beginner, Intermediate, or Advanced wording |
| Review moves for | Both, White, or Black lesson selection |
| Teaching cues | Show or hide the review's board outlines |
| Candidate heatmap | Independent analysis-board preference |
| Candidate arrows | Independent analysis-board preference |

## 15. Privacy and storage

- Local Stockfish and deterministic coaching run locally.
- Chrome AI runs on-device after availability.
- Ollama runs on `localhost`.
- Cloud prompts include the board position and bounded verified analysis context.
- Cloud prompts do not intentionally include player names, page comments, or account credentials.
- Lichess game capture may contact Lichess's official export endpoint.
- Opening names come from a packaged local dataset.

Chrome sync stores provider and model preferences. Chrome local storage stores keys and overlay preferences. Session storage holds active request/session metadata. Provider prompts and AI prose are not retained as learning history.

Clearing extension data or removing the extension can remove local API keys. Migration removes synchronized copies only after local credentials are written, but interrupted or cross-profile operations can require re-entry.

## 16. Limitations

- Desktop Chrome only; mobile Chrome is not supported
- Live human-game move advice is disabled
- Native Chess.com engine reuse is disabled
- Lichess native reuse is opportunistic and only on supported, validated data
- Website layouts can change; fixture and automated checks do not guarantee every live layout
- Real Gemini Nano download/inference is not included in browser automation
- AI evidence checks validate structure and supplied facts, not every chess claim
- Repetition and custom-start history have special limits
- Native-board variation playback is not a general interactive feature; Kibitz may require the site's move controls
- The website's own engine, review report, or coaching UI is separate and may remain visible
- Candidate heatmaps and arrows are analysis evidence, not universal square safety ratings
- A 50-game/5 MiB local history limit can evict older reviews

## 17. Troubleshooting

| Symptom | Recommended action |
| --- | --- |
| Card or result is stale after reload | Reload Kibitz, then refresh each Chess.com/Lichess tab |
| No card appears | Open a study, analysis, or completed game and choose **Show board card** |
| Live human game shows no advice | This is intentional; no advice is provided until a completed-game context is available |
| Review does not capture a game | Open the finished game itself, choose **Review selected game**, or import PGN |
| Review cannot match the board | Use the site's mainline move controls until Kibitz reports a reliable matching position |
| Chrome AI unavailable | Update Chrome/check hardware requirements or use Ollama/cloud |
| Chrome AI says downloaded but test fails | Save Chrome AI only and run Test AI; report provider, stage, and reason |
| Ollama cannot connect | Start Ollama, verify the model, and set `OLLAMA_ORIGINS` to the extension origin; restart Ollama |
| Ollama is slow | Try a smaller model and allow 25 seconds per attempt |
| Cloud request fails | Check key, model, account quota, network, and Chrome permission |
| Board cannot be read | Use **Advanced · analyze a FEN** |
| PGN is rejected | Confirm one standard-chess game smaller than 256 KiB and a matching board position |
| Opening name is missing | A FEN/custom start may not establish it; the opening file or its loading may have failed |
| Card/board layout overlaps | Resize or rotate the board and reload; report width, zoom, site theme, and native layout |
| Theme does not update | Kibitz keeps a page palette until reload/navigation; reload or navigate to refresh |
| Extension reports unavailable | Refresh the tab and verify only one copy of Kibitz is loaded |

For support, open Settings → **Advanced: diagnostics & help** and choose **Copy support diagnostics**. Copied diagnostics contain version, browser, network status, and scoring version; they do not include keys, moves, or player names.

## 18. Team verification and development checks

The repository's normal checks are:

```sh
npm test
npm run typecheck
npm run build
```

Browser smoke testing:

```powershell
$env:CHROME_PATH = 'C:\path\to\chrome.exe'
node scripts/browser-smoke.mjs
```

Optional diagnostics:

```sh
node scripts/browser-smoke.mjs --fail-openings
node scripts/capture-probe.mjs
node scripts/native-engine-probe.mjs
```

The browser suite uses isolated profiles and intercepted fixtures. AI calls are mocked. Real provider inference and real live-site layouts require a manual pass.

For release testing, verify both sites in light/dark themes, narrow and wide windows, and zoomed layouts. Exercise pause/resume, refresh, Close/Exit, provider failures, finished positions, practice, history deletion, and switching games.

## 19. Source references

Primary repository sources:

- `README.md`: installation, provider setup, workflows, privacy, architecture, and limitations
- `TESTING.md`: current hands-on 1.2.3 release checklist
- `docs/manual-testing.md`: detailed manual browser checkpoints
- `docs/combined-implementation.md`: integrated coaching architecture and implementation boundaries
- `docs/game-review-plan.md`: native-board review design and acceptance behavior
- `docs/review-critique-mode.md`: review critique, cues, and key-moment behavior
- `docs/site-analysis-sources-plan.md`: Lichess reuse and Chess.com limitations
- `docs/review-evidence-plan.md`: review evidence and grounded explanation constraints
- `docs/helpful-move-reasoning-plan.md`: explainable move reasoning
- `docs/ai-coach-memory-plan.md`: provider memory and coaching scope

Implementation sources:

- `public/manifest.json`: extension permissions, supported hosts, version, and entrypoints
- `src/sidepanel.html` and `src/sidepanel.ts`: workspace, settings, FEN/PGN, providers, and diagnostics
- `src/in-page-review.ts`: selected-move review and practice
- `src/review-coordinator.ts`: whole-game queue, pause, resume, and completion
- `src/review-library.ts`: saved history and deletion safeguards
- `src/review-scoring.ts`: levels, grades, winning chance, and accuracy
- `src/review-panel.ts`: overview, graph, key moments, lessons, and resume controls
- `src/review-tools.ts`: card practice and learning controls
- `src/providers.ts` and `src/chrome-ai.ts`: provider chain and Chrome AI test behavior
- `src/settings.ts` and `src/types.ts`: validated settings and credential storage
- `src/adapters.ts`, `src/site-review.ts`, `src/site-snapshot.ts`, and `src/game-capture.ts`: board capture and site integration
- `src/card.ts`, `src/card-placement.ts`, and `src/overlay.ts`: board card, responsive placement, and visual cues
