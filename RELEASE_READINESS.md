# Kibitz 1.1 release readiness

This is a local release candidate. Store publication and claims of competitive coaching quality require the remaining human checks below.

## Implemented

- Context-aware grading with provisional feedback, deeper confirmation, and separate mate handling.
- Warm Stockfish worker reuse, coherent MultiPV iterations, cancellation isolation, and one bounded worker restart.
- Overview, sparse evaluation graph with position-selector alternative, player scores, key moments, and evidence-backed takeaways.
- Guided moments, explicit learning levels, on-demand consequence cues and a before-move alternative.
- Practice with SAN or legal source/destination selectors, promotion, hints, reveal, acceptable alternatives, and separate game/practice branches.
- Bounded trusted local history, resume, theme recurrence counts, deletion protection, and optional learning-level suggestions.
- Review/Lessons/Settings navigation, optional provider setup, Chrome 116 palette fallbacks, reduced motion, forced-color support, and safe support diagnostics.
- Versioned ZIP packaging with integrity check and SHA-256 checksum.

## Automated verification

Run `npm test`, `npm run build`, and `node scripts/browser-smoke.mjs` using testing Chromium. Browser checks use synthetic finished-game fixtures for both supported sites and the actual packaged Stockfish WASM. Provider wording in that suite is mocked and still validated through the evidence pipeline.

`npm run benchmark:coaching` exercises opening, tactical, positional, defensive, and endgame positions with the actual engine. It writes level-specific explanations, legal evidence, total time, first-feedback time, and an unfilled human review rubric. Its output explicitly marks comparative review incomplete. Search output and timing vary by device and engine budget.

`node scripts/ai-placement-smoke.mjs` tests real configured-provider availability separately and never counts unavailability as successful inference.

The non-engine JavaScript budget increased from 300 KB to 350 KB to accommodate the review experience. Per-entry and total-package limits remain enforced; the opening database and engine remain separate packaged assets.

### Recorded local verification

On November 17, 2026, all 352 tests in 34 files passed. The production build, packaged-asset verification, bundle limits, and ZIP integrity checks passed. Complete browser workflows passed on synthetic Chess.com and Lichess finished-game fixtures using packaged Stockfish, including practice acceptance, refresh/resume, persistent deletion, and placement at 240–2560 px and 200% zoom. Provider responses in that integration run were mocked.

The six-position real-engine benchmark recorded first feedback between 236 and 3703 ms on an Intel i7-9750H Windows machine. Its expert and comparative coaching review remains incomplete. The separate real-provider probe found Chrome AI downloading, Ollama unreachable, and no saved Gemini key; no real-provider inference success is claimed.

The release archive is `releases/kibitz-1.1.0.zip` (22 files, 5,877,483 bytes), with SHA-256 `dc6294182a2f75e42fc5796a490db1704d6836b4e4584ce2345eb91827b14385`. Every archive entry was checked against the built `dist/` output. Installation and reload instructions are in the README; screenshots and design findings are in [DESIGN_REVIEW.md](DESIGN_REVIEW.md).

## Required before public release

- Check actual authenticated Chess.com and Lichess finished-game pages, including game changes, host layout updates, unsupported navigation, and page reloads.
- Run manual keyboard-only, NVDA/Chrome, and VoiceOver/Chrome workflows. Automated semantics and responsive fixtures do not establish WCAG conformance.
- Check both themes, forced colors, reduced motion, 320 CSS px reflow, text scaling, 400% browser zoom, and translated-text expansion. English is the shipped language; translations are not included.
- Have a strong player review benchmark explanations for factual correctness, specificity, useful lessons, and honest uncertainty. Compare against Chess.com using the same positions and documented analysis settings.
- Test learning transfer with six players across the three levels, including keyboard and screen-reader users. Resolve blocking findings; at least five should complete start/review/practice/resume tasks without moderator intervention.
- Verify first feedback within eight seconds and cached feedback within 300 ms on a documented reference device. Deeper confirmation is separately labeled; do not advertise a universal hardware guarantee.
- Exercise extension-update and storage-failure recovery in a non-personal test profile. Verify installation from the generated ZIP and preserve the license/source notices.

## Boundaries

Standard chess on supported desktop Chrome is the release target. Narrow responsive layouts support small windows and magnification; mobile extensions and other browsers are not certified. No assistance is provided during live games against people.

Native variation input is not enabled: exercises use SAN or legal square selectors. Host-site navigation is capability-dependent, with a manual fallback. Kibitz hides its own answers during practice; it does not control the website's separate engine or review UI.

Spaced repetition, phase summaries, clock-based lessons, voice coaching, tablebases, a full opening repertoire, and cloud synchronization remain future work.
