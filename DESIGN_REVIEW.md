# Design Review: Kibitz review usability and production readiness

Date: November 17, 2026

The original baseline findings below are retained for traceability. The implementation and verification update at the end records their current disposition; the original 327-test count is historical.

Reviewed against: the agreed game-review redesign in this conversation: retain the native board, support explicit learning levels, reveal teaching visuals on demand, provide practice with move-entry fallback, and keep local learning history.

Design direction: a calm study companion with one clear next action, progressive disclosure, accessible explanations, and visible evidence.

## Method and limits

Inspected the current source and rendered the existing Card class with the captured central-tension fixture. Rendered setup from the current HTML and stylesheet. Captures used an isolated Chrome profile at 1280x800, 768x1024, and 375x812, in light and dark preferences.

These are source-rendered browser fixtures, not authenticated website sessions or a complete running extension. The setup capture omits its extension-dependent controller; its availability messages are placeholders, not evidence of a loading defect. The card capture omits native-site theme relay and the full review controller; its default dark surface and initial legend are not evidence of production theme or legend defects. Native-board placement, focus behavior, assistive technology, provider inference, and live-site compatibility require integration verification.

All 12 captures were inspected. No document-level horizontal overflow was measured. The earlier review baseline passed 327 tests; tests were not rerun for this documentation-only follow-up.

## Screenshots captured

| Screenshot | Viewport | Observation |
| --- | --- | --- |
| [Setup, light, desktop](screenshots/review-panel-light-desktop-1280.png) | 1280x800 | Clear primary start action; long settings-led page, 1554 px content height. |
| [Setup, light, tablet](screenshots/review-panel-light-tablet-768.png) | 768x1024 | Width remains bounded; technical setup still dominates the remaining page. |
| [Setup, light, narrow](screenshots/review-panel-light-mobile-375.png) | 375x812 | No horizontal overflow; content reaches 1715 px and selected analysis-source text is clipped. |
| [Setup, dark, desktop](screenshots/review-panel-dark-desktop-1280.png) | 1280x800 | Consistent surface hierarchy; repeated instructions and technical choices remain prominent. |
| [Setup, dark, tablet](screenshots/review-panel-dark-tablet-768.png) | 768x1024 | Controls retain readable spacing; settings hierarchy matches desktop. |
| [Setup, dark, narrow](screenshots/review-panel-dark-mobile-375.png) | 375x812 | No horizontal overflow; the long selected option is clipped here too. |
| [Review card, light preference, desktop](screenshots/review-card-light-desktop-1280.png) | 1280x800 | Clear move heading and explanation; grade wraps and support content repeats the movement. |
| [Review card, light preference, tablet](screenshots/review-card-light-tablet-768.png) | 768x1024 | Same 420 px card; key controls follow a long explanation and cue section. |
| [Review card, light preference, narrow](screenshots/review-card-light-mobile-375.png) | 375x812 | Card content requires roughly 920 px; small action labels compete with explanatory text. |
| [Review card, dark preference, desktop](screenshots/review-card-dark-desktop-1280.png) | 1280x800 | Default card palette remains legible in this fixture; theme relay was not tested. |
| [Review card, dark preference, tablet](screenshots/review-card-dark-tablet-768.png) | 768x1024 | Similar hierarchy and density; lower-priority details remain collapsed. |
| [Review card, dark preference, narrow](screenshots/review-card-dark-mobile-375.png) | 375x812 | No horizontal overflow; compact controls and repeated cue prose increase reading effort. |

## Must fix before release

1. **Browser compatibility:** the manifest and README promise Chrome 116+, while default setup tokens use `light-dark()` without compatible fallback definitions. Chrome introduced this function in 123. Preserve 116 support with literal token defaults, a dark-preference media query, and feature-gated enhancements. Source: [Chrome 123 release](https://developer.chrome.com/blog/new-in-chrome-123?hl=en).
2. **Corrupted user-facing punctuation:** setup source and screenshots contain literal question marks in possessives, separators, and provider descriptions. Correct these strings deliberately, use UTF-8 consistently, and assert representative rendered strings. Do not globally replace question marks, since some are intentional.
3. **Conflicting move assessments:** preserve the earlier confirmed fixes for Best plus a large evaluation loss and claimable draw positions being treated as terminal. Reliable feedback is a prerequisite for polished presentation.
4. **Accessible complete workflows:** provide keyboard and text equivalents for graph selection, board cues, and exercise entry, including a legal source-square/destination-square fallback for players unfamiliar with SAN. Native-board accessibility depends on the host; describe Kibitz's supported workflow accurately.

## Should fix

1. **Reduce setup burden:** make Review the default surface; move provider/model configuration into Settings. Core review and verified explanations should work without provider configuration.
2. **Shorten the selected-move card:** keep the move, separate grade, one concise lesson, and a primary learning action visible. Put cue definitions, additional evidence, and provider diagnostics behind labeled disclosures. Maintain a nearby accessible textual explanation of active board cues.
3. **Shorten option labels:** use concise names such as Automatic and Local engine, with the complete meaning in adjacent help text. The current narrow screenshot clips the long selected analysis-source option.
4. **Distinguish actions:** use Retry analysis for failed work and Try a better move for exercises. State what Paused, Review ready, and Explanation unavailable mean without implying that core review failed.
5. **Standardize styles:** share semantic spacing, typography, focus, and color tokens between panel, card, and overlays. Target 16 px reading text and 14 px secondary text; keep metadata subordinate without using low contrast.
6. **Control announcements:** retain live feedback but announce settled move changes and meaningful progress milestones, not every background result or provider attempt. Preserve focus while results update.
7. **Prepare localization:** extract visible strings, use locale-aware pluralization, and allow translated labels to wrap. English is the initial shipped language; prepare pseudo-localization and RTL fixtures without claiming completed translations.

## Could improve after the core release

- Verified time-use lessons, phase summaries, spaced repetition, annotated PGN export, and tablebase explanations.
- A learner-controlled focus mode that hides evaluation and solutions until requested.
- A concise method panel explaining scoring provenance and why site scores can differ.

## What works well

- A visible start-review action, bounded content width, and useful progressive disclosure already exist.
- The existing card names pieces and squares and explains cues in text as well as color.
- The captured central-tension example gives a concrete comparison without inventing material loss.
- The existing gold identity, readable move heading, focus styling, and generous control heights are a sound basis for refinement.
- Local analysis and deterministic explanation fallbacks support users who cannot configure an AI provider.

## Release verification

- Test actual extension workflows on both supported sites, including native theme relay, layout restoration, PGN import, game changes, and unsupported navigation.
- Capture loading, empty, error, paused, complete, hint, reveal, and resumed states in both themes and all target widths.
- Verify WCAG 2.2 AA for Kibitz-controlled surfaces, including 320 CSS px reflow, keyboard completion, contrast, visible/unobscured focus, reduced motion, and non-color meanings.
- Use 44x44 CSS px as the product target for primary controls. WCAG AA's target-size minimum is 24x24 with specified exceptions; do not describe 44 px as the AA requirement.
- Test manual screen-reader flows with NVDA and VoiceOver and preserve host-site shortcuts outside focused Kibitz controls.
- Package a versioned installable artifact, document support boundaries, preserve licenses, and verify update/storage migration and rollback behavior.

## Implementation and verification update: 1.1.0

The redesign is implemented as a local release candidate. Review is the default workspace; provider configuration is optional and lives in Settings. A completed game opens directly to its overview instead of repeating onboarding. A single primary action starts guided review; key moments and takeaways use quieter controls. Explicit learning levels adjust evidence-backed explanations. Consequence cues and the alternative branch appear on request.

Practice hides Kibitz's evaluations, explanations, and solution overlays. Players can enter SAN or select legal source and destination squares, with promotion, hints, reveal, skip, and return controls. The native website board remains the only board. Local lessons and history support resume and deletion. The glossary is searchable, progress announcements are throttled, and support diagnostics omit credentials and game data.

The baseline browser-palette and punctuation defects are corrected. Conflicting move assessments receive provisional feedback and deeper confirmation; claimable draws are distinguished from terminal positions. Keyboard alternatives are implemented for graph selection and exercise entry. Manual screen-reader and full accessibility validation remain release gates, as do localization and translated-text testing.

Validation now includes 352 passing tests in 34 files, TypeScript/build and bundle-budget checks, real packaged Stockfish analysis, and complete synthetic Chess.com and Lichess extension workflows. Browser checks cover hidden-answer practice, real-engine acceptance, separate branches, refresh/resume, persistent deletion, native-board placement at 240–2560 px, and 200% zoom. These fixtures do not establish compatibility with authenticated live-site pages.

The current captures below use the running packaged extension on synthetic host pages. Overview captures emulate system light/dark fallback palettes; native host palette relay is checked separately. Representative desktop, narrow, and practice captures were visually inspected. The overview has a text position selector alongside its graph, wraps controls at narrow widths, and keeps game review ahead of setup. The practice card has a visible input focus indicator and does not cover the board or native controls in the fixtures.

| Surface | Light captures | Dark captures |
| --- | --- | --- |
| Chess.com overview | [1280 px](screenshots/review-1.1/chesscom-overview-light-1280.png), [768 px](screenshots/review-1.1/chesscom-overview-light-768.png), [375 px](screenshots/review-1.1/chesscom-overview-light-375.png) | [1280 px](screenshots/review-1.1/chesscom-overview-dark-1280.png), [768 px](screenshots/review-1.1/chesscom-overview-dark-768.png), [375 px](screenshots/review-1.1/chesscom-overview-dark-375.png) |
| Lichess overview | [1280 px](screenshots/review-1.1/lichess-overview-light-1280.png), [768 px](screenshots/review-1.1/lichess-overview-light-768.png), [375 px](screenshots/review-1.1/lichess-overview-light-375.png) | [1280 px](screenshots/review-1.1/lichess-overview-dark-1280.png), [768 px](screenshots/review-1.1/lichess-overview-dark-768.png), [375 px](screenshots/review-1.1/lichess-overview-dark-375.png) |
| Native-board practice | [Chess.com](screenshots/review-1.1/chesscom-practice.png), [Lichess](screenshots/review-1.1/lichess-practice.png) | Covered by theme styles and automated placement; a dedicated dark practice capture is still a manual release check. |

The six-position coaching benchmark used the actual pinned engine. First feedback ranged from 236 to 3703 ms on the recorded Intel i7-9750H Windows machine; deeper confirmation can take longer. This is a device-specific measurement, not a universal latency promise. Strong-player review and comparison against Chess.com remain uncompleted rubric fields.

The separate real-provider probe completed its layout checks, but could not produce a real AI sample: Chrome's local model was downloading, Ollama was unreachable, and no Gemini key was saved. Deterministic engine-grounded coaching and mocked-provider integration were verified; real-provider inference is not claimed.

The versioned ZIP and SHA-256 checksum are in `releases/`. See [RELEASE_READINESS.md](RELEASE_READINESS.md) for explicit public-release gates and feature boundaries.
