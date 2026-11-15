# 8-direction walk sheet

Step 1 of a walk animation. It draws one character eight times on a green screen, each copy mid-stride and facing its own direction, ready for `sprite-walk-8dir` to animate.

## The sheet

- 16:9, resized to 1344x768, a 4x2 grid on flat #00FF00:
  - top row, left to right: down, down-right, right, up-right
  - bottom row, left to right: up, up-left, left, down-left
- Every copy is at the contact pose: its own left foot forward along its facing, the other foot pushing off, arms swung opposite. The video step starts and ends on this pose, so a walk drawn mid-stride loops without a pause on a standing pose.
- One-sided details (a weapon, a bag, a scarf end) stay on the same side of the body in every view. The sheet is drawn in all eight directions, not mirrored, so asymmetric characters come out right.

## Inputs

- `character` (character-ref, required): the design to follow.
- `style` (select): clean cartoon, hand-painted 2D, chibi 2D, or a pixel-art look.

## Check before animating

Look at every copy: does it face its own direction, with one foot forward along that direction? A model can turn one copy, or invent a back view the design does not show. Draw the sheet again rather than animate a wrong one, because the sheet costs far less than the clip.

## CLI

```bash
pixo recipe run sprite-walk-sheet-8dir --input character=<slug> --json --wait
pixo recipe run sprite-walk-8dir --source-run <runId> --candidate <id> --json --wait
```
