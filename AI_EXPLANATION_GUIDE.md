# Kibitz AI Explanation Guide

## Purpose

Kibitz uses AI to explain chess evidence, not to invent the evidence. Stockfish or a matching
website analysis provides positions, evaluations, and moves. Kibitz converts those results into
bounded facts and a compact move tree, then asks a configured provider to turn those facts into
human-readable coaching.

The result is a three-part explanation:

1. **What happened:** the played move or recommended move and the concrete change it made.
2. **Why it matters:** the tactical or positional consequence.
3. **A practical lesson:** what the user can look for next time.

This design keeps verified chess information separate from generated prose. An AI provider can
produce fluent wording, but it does not determine whether a move is legal or establish that a
searched sequence is forced.

## 1. Position and move evidence

Kibitz starts with a verified position:

- Chess.com or Lichess board data provides the current board and orientation.
- A FEN, PGN, or completed-game history supplies the move sequence where needed.
- Kibitz checks the reconstructed position against the website board before analysis is used.
- Local Stockfish supplies evaluations and principal variations for move grading and review.

For a whole-game review, Kibitz identifies:

- the played move;
- the engine's preferred move;
- the evaluation before and after the move;
- mover-relative loss;
- mate or terminal status;
- search depth and whether the result is provisional;
- relevant tactical and positional changes;
- up to three compact continuations capped at eight plies each.

The compact tree includes the played continuation, preferred continuation, and available
alternatives. It is not the entire engine search tree.

The implementation is centered on
[`src/coaching-context.ts`](src/coaching-context.ts),
[`src/board-context.ts`](src/board-context.ts),
[`src/explanation-facts.ts`](src/explanation-facts.ts), and
[`src/review-evidence.ts`](src/review-evidence.ts).

## 2. Verified fact construction

Before an explanation is sent to a provider, Kibitz derives chess facts from the position and
search result.

Examples include:

- a piece moved from one square to another;
- an attack or defender changed;
- central control changed;
- a king gained or lost castling rights;
- a bishop or rook becomes active;
- a capture or check is legal;
- a stronger continuation is available;
- a mate or exchange appears in a searched line.

The fact pipeline rejects or suppresses claims that conflict with the supplied analysis. For
example, castling cannot be described unless it appears in the corresponding searched evidence,
and known unsupported combinations of claims are filtered.

Opening names come only from the local opening database. They are position matches, not proof that
the chosen move is good.

Relevant implementations:

- [`src/positional-facts.ts`](src/positional-facts.ts) extracts positional ideas.
- [`src/threat-facts.ts`](src/threat-facts.ts) extracts tactical observations.
- [`src/analysis-evidence.ts`](src/analysis-evidence.ts) validates and qualifies engine lines.
- [`src/explanation-facts.ts`](src/explanation-facts.ts) builds the ranked fact catalog.

## 3. Coach prompt

The prompt is generated in [`src/coach-prompt.ts`](src/coach-prompt.ts). It contains:

- the FEN and terminal state;
- learning level;
- review or analysis mode;
- played and preferred moves;
- evaluation before and after;
- mover-relative loss;
- search depth and provisional status;
- bounded played/preferred/alternative branches;
- verified tactical and positional facts;
- material and legal-exchange context.

The prompt explicitly instructs the provider to:

- explain the move in 2-4 concrete sentences;
- add one practical lesson;
- connect move to consequence to importance;
- compare an alternative or strong opponent reply when supported;
- name relevant pieces and squares;
- never invent moves, captures, forced outcomes, or causes;
- treat a searched line as possible, not forced;
- qualify incomplete or provisional evidence.

The prompt is capped at 12,000 characters. Facts and branches are removed selectively if the
serialized evidence would exceed that budget.

## 4. Structured provider response

AI providers receive a request for JSON with this shape:

```json
{
  "explanation": "Concrete prose.",
  "lesson": "One practical takeaway.",
  "evidenceIds": ["recommended.move"],
  "lineRefs": [
    {
      "branch": "preferred",
      "step": 2
    }
  ]
}
```

The formal limits are defined in [`src/explanation-schema.ts`](src/explanation-schema.ts).

- `explanation`: 20-4,200 characters.
- `lesson`: 10-800 characters.
- `evidenceIds`: 1-6 exact IDs from the supplied fact catalog.
- `lineRefs`: optional, up to eight references to supplied branch steps.

Kibitz validates the JSON and all references before displaying it. Unknown fact IDs, fabricated
branch references, unsupported fields, malformed prose, and known contradictory chess claims are
rejected.

If a provider returns invalid text, Kibitz retries that provider once with a repair prompt. The
repair is still bounded by the original provider timeout and overall coaching budget.

## 5. Provider selection

Provider behavior is implemented in [`src/providers.ts`](src/providers.ts) and
[`src/chrome-ai.ts`](src/chrome-ai.ts).

Supported explanations:

| Provider | Behavior |
| --- | --- |
| Chrome AI | Runs locally in Chrome through the Prompt API. |
| Ollama | Calls a local Ollama server using the selected model. |
| Gemini | Calls Gemini using a saved API key. |
| OpenAI | Calls OpenAI using a saved API key. |
| Groq | Calls Groq using a saved API key. |

The default automatic chain is:

1. Chrome AI
2. Ollama
3. the selected cloud provider

When a provider is fixed in Settings, Kibitz tries only that provider. Cloud providers require
permission for their origin and a saved key.

The total explanation budget is 80 seconds. Individual provider timeouts are shorter. Chrome AI
availability is checked separately from generation, and a generation-stage compatibility failure
can trigger one retry without the response constraint.

## 6. Caching

Successful explanations are cached in offscreen memory for five minutes. Cache entries are keyed by
the coach profile, provider, and complete evidence catalog.

Changing provider preferences, models, or credentials invalidates cached plans. Failed attempts are
not cached. Cached wording is checked against the current catalog before reuse.

This cache reduces repeated work during a selected move or repeated review. It does not replace
the engine search or make cached AI wording authoritative.

## 7. Deterministic fallback

If all available providers fail or inference is disabled, Kibitz renders a deterministic
evidence-based explanation from the same verified catalog.

The fallback:

- is not a model-generated claim;
- uses the ranked supplied facts;
- can include the primary consequence and practical meaning;
- retains verified mate, capture, castling, and positional context;
- does not guess an unsupported reason.

The fallback is labeled through local engine/facts behavior rather than presented as new AI
certainty.

## 8. Learning levels

The learning level changes how much chess terminology and engine detail Kibitz gives. It does not
change the underlying engine judgment or make an incorrect engine result correct.

The level is included in the coaching context and provider prompt. The UI and review summary also
have level-specific presentation.

### Beginner

**Goal:** explain the board relationship clearly enough for a developing player to act on it.

Typical behavior:

- everyday language instead of dense terminology;
- names pieces and squares;
- defines terms such as control, attack, or defense;
- explains one concrete consequence before a larger plan;
- keeps comparisons simple;
- includes a short practical takeaway;
- avoids unexplained notation-heavy detail.

Example:

> The knight moves to F3, helping develop it and adding support to the center. When your pieces
> become active and work toward the same plan, it is harder for the opponent to choose the first
> move.

This level does not mean that every tactical claim is simplified into certainty. If a line is
searched rather than forced, the explanation should say that.

### Intermediate

**Goal:** connect a move to a short chess plan and teach comparison.

Typical behavior:

- emphasizes plans and short comparisons;
- uses normal chess terms with moderate explanation;
- connects a move to a candidate reply;
- distinguishes developing a piece from merely moving it;
- compares the played move with the preferred move;
- can include a short variation when the evidence supports it.

Example:

> F3 develops the knight while contesting the D4 and E5 squares. Compared with D3, it gives the
> knight a more active role and keeps useful development options.

The preferred move may still be an engine suggestion rather than a universal truth. Kibitz should
present it as a candidate backed by the supplied search.

### Advanced

**Goal:** provide concise analysis for a player who can read notation and evaluate qualified engine
evidence.

Typical behavior:

- uses SAN or UCI-like line references where useful;
- names the depth or search qualification;
- includes a searched continuation when supported;
- distinguishes a centipawn/evaluation change from a forced conversion;
- limits the explanation to a short plan, line, or contest;
- does not hide uncertainty or provisional search disagreement.

Example:

> 2.Nf3 develops the knight and contests D4/E5; the searched 8-ply branch keeps that pressure while
> limiting central pawn moves. A mate or exchange claim requires a supplied forced continuation.

Advanced mode is also used for review summaries that may include:

- depth;
- mover-relative loss;
- mate transitions;
- the actual searched line;
- evaluation qualifications.

See [`src/review-model.ts`](src/review-model.ts) and
[`src/review-scoring.ts`](src/review-scoring.ts) for level-sensitive review text.

## 9. What the output can prove

The pipeline can prove or verify only the claims grounded in supplied evidence:

- move legality;
- reconstructed position;
- engine comparison and search result;
- bounded supplied line;
- supplied positional and tactical facts;
- response structure and evidence references.

It does not prove:

- that every sentence in free-form AI prose is correct;
- that an engine-preferred move is always the only good move;
- that a principal variation is forced;
- that evaluation loss means material was captured;
- that an opening name proves the merit of a move;
- that a player will improve at a particular level.

The UI presents engine facts, AI explanation, and uncertainty separately rather than converting
all output into a universal coaching claim.

## 10. Quality checks

Implementation tests cover:

- three legal branches capped at eight plies;
- Beginner, Intermediate, and Advanced prompt levels;
- invalid or fabricated evidence IDs;
- invalid branch references;
- black and white mover-relative loss;
- mate and terminal score qualification;
- cache reuse;
- invalid provider response repair;
- deterministic fallback;
- Chrome AI generation-stage retry;
- provider cancellation and timeout behavior.

Representative tests:

- [`tests/coaching-response.test.ts`](tests/coaching-response.test.ts)
- [`tests/chrome-ai.test.ts`](tests/chrome-ai.test.ts)
- [`tests/providers.test.ts`](tests/providers.test.ts)
- [`tests/review-model.test.ts`](tests/review-model.test.ts)
- [`tests/explanation-pipeline.test.ts`](tests/explanation-pipeline.test.ts)

For release decisions, automated evidence checks supplement—not replace—a strong-player review of
the wording, particularly for quiet positional moves, equal alternatives, and exchanges.
