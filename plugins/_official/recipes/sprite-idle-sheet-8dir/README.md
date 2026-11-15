# 8-direction idle sheet

Step 1 of an idle animation. It draws one character eight times on a green screen, each copy standing at rest and facing its own direction, ready for `sprite-idle-8dir` to animate.

## The sheet

- 16:9, resized to 1344x768, a 4x2 grid on flat #00FF00:
  - top row, left to right: down, down-right, right, up-right
  - bottom row, left to right: up, up-left, left, down-left
- Every copy stands relaxed, feet planted hip-width apart and arms at its sides. The idle clip starts and ends on this pose.
- One-sided details (a weapon, a bag, a scarf end) stay on the same side of the body in every view. The sheet is drawn in all eight directions, not mirrored.
- It uses the same grid and order as `sprite-walk-sheet-8dir`, so a character's walk and idle line up.

## Inputs

- `character` (character-ref, required): the design to follow.
- `style` (select): clean cartoon, hand-painted 2D, chibi 2D, or a pixel-art look.

## Check before animating

Look at every copy: does it face its own direction, standing still? Draw the sheet again rather than animate a wrong one, because the sheet costs far less than the clip.

## CLI

```bash
pixo recipe run sprite-idle-sheet-8dir --input character=<slug> --json --wait
pixo recipe run sprite-idle-8dir --source-run <runId> --candidate <id> --json --wait
```
