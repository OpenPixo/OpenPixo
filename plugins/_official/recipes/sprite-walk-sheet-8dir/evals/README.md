# Evals: openpixo/sprite-walk-sheet-8dir

Status: passed (0.1.0), 2026-11-15, on `codex-cli` / `codex-image`.

## Recipe run (2026-11-15)

- **Command:** `pixo recipe run sprite-walk-sheet-8dir --input character=hero --model codex-image --wait --json`, with default style `clean cartoon with bold outlines`.
- **Character card `hero`:** a front view of the trial's asymmetric adventurer as its reference.
- **Run:** `23727d4a-ced5-4019-b29e-5b75f6219a07`, status `ready`. Two candidates, each resized to 1344x768; check `dimensions` passed on both.
- **By eye, both candidates:**
  - every copy in its cell and facing its direction, mid-stride, with the left foot forward along its facing
  - sword and satchel on the correct sides in the front and back views
  - flat green with nothing green on the character
- **Next step:** candidate `3be36acb` was animated by `sprite-walk-8dir` (see its evals).

## Trial of the method (2026-11-15, by hand)

- **Provider:** Codex image (`codex-image`, ChatGPT sign-in), with the prompt this recipe uses, drawing an asymmetric adventurer (sword on the right hip, satchel on the left, a one-sided scarf tail).
- **Standing-pose sheet:** all eight directions in the right cells; one-sided details on the correct side in every view, the back views included.
- **Mid-stride sheet** (redrawn from the standing one as a reference):
  - every copy has its left foot forward along its own facing;
  - the diagonals step along the diagonal;
  - the back views show the boot sole lifting.

  Animated with `sprite-walk-8dir`'s method, this sheet gave the accepted walk (see that recipe's evals).
- **Background:** the dark green tunic stayed clear of the #00FF00 key.

