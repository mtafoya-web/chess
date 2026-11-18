# Testing Kibitz 1.2.3

Build from source with `npm run build`, then load this project's `dist` directory at `chrome://extensions`. Alternatively, extract `releases/kibitz-1.2.3.zip` and load that extracted directory. After updating an existing installation, click Reload on the extension and refresh each chess tab.

## Finished-game review

- Open a completed Lichess game on its original result board. Click **Review selected game**. Check that the overview starts and the selected-move card matches the native board.
- Repeat with White and Black orientation, a draw, and a game ending by resignation or checkmate. Both legacy game links and `/game/…` links should work.
- Select earlier moves, use **Next key moment**, and open the same game's native Analysis board. Review should follow the selected position and survive refresh. Changing games must not show the previous game's explanation.
- Repeat the flow on Chess.com. Check automatic review both enabled and disabled, pause/resume, and an explicitly dismissed review.
- An ongoing human game must not show move advice.

## Chrome AI and coaching

- In Settings, enable Chrome AI if required. Select Chrome AI only, save, and run **Test AI**. An available model is distinct from a successful generation test.
- In a review, choose **Explain further**. Check that the explanation names a concrete consequence and offers a useful lesson or comparison.
- Try Beginner, Intermediate, and Advanced. The assessment should stay consistent while wording and notation change.
- Test a quiet improvement, a tactical error, and a mate position. A searched continuation should be described as a possibility unless forced; evaluation changes must not be described as pieces captured.
- Change moves while AI is working. Old prose must not appear on the new position. If AI fails, existing verified feedback should remain readable.

## Interface

- Keep the native board visible. The card should emphasize the move, assessment, explanation, and next key moment.
- Expand Review options, Review controls, and Details. Check keyboard access and focus, narrow windows, browser zoom, and light/dark themes.
- Practice should hide Kibitz's solution and answer-bearing disclosures, while keeping hint, reveal, skip, and return controls available.
- Check that provider diagnostics stay in Settings or Details and that review progress is distinct from optional explanation progress.

AI prose is model-generated. Automated evidence-reference checks do not establish that every chess claim is correct. Final native-site compatibility and real-device inference are verified by this hands-on pass.
