# Side-view walk sheet

Step 1 of a side-view walk animation, for platformers, brawlers and other side-scrollers. It draws one character twice on a green screen, mid-stride, left foot forward along its facing: the left copy faces right, the right copy faces left. `sprite-walk-side` animates it.

## The sheet

- 16:9, resized to 1344x768, a 2x1 grid on flat #00FF00: left cell facing right, right cell facing left. Each cell is 672x768, four times the pixels of a cell on the 8-direction sheet.
- The facing-left copy is the character turned around, not mirrored: one-sided details (a sword hand, a shield, a scarf end) stay on the same side of the body.
- Same canvas and layout as the other side-view sheets, so a character's walk, idle and attack line up.

## Inputs

- `character` (character-ref, required): the design to follow.
- `style` (text): empty takes the game's look.

## Check before animating

Look at both copies: is each facing its own way, mid-stride, with one-sided details on the right side of the body? Draw the sheet again rather than animate a wrong one, because the sheet costs far less than the clip.

## CLI

```bash
pixo recipe run sprite-walk-sheet-side --input character=<slug> --json --wait
pixo recipe run sprite-walk-side --source-run <runId> --candidate <id> --json --wait
```
