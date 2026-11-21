# Side-view attack sheet

Step 1 of a side-view attack animation, for platformers, brawlers and other side-scrollers. It draws one character twice on a green screen, in the ready stance, standing in the back half of its cell so the strike has room in front: the left copy faces right, the right copy faces left. `sprite-attack-side` animates it.

## The sheet

- 16:9, resized to 1344x768, a 2x1 grid on flat #00FF00: left cell facing right, right cell facing left. Each cell is 672x768, four times the pixels of a cell on the 8-direction sheet.
- The facing-left copy is the character turned around, not mirrored: one-sided details (a sword hand, a shield, a scarf end) stay on the same side of the body.
- The character is drawn at the same height as on the side-view walk and idle sheets (about 60% of the cell), but its body sits a quarter of the cell width behind the cell's centre, leaving the front of the cell for the strike. In the engine, offset the attack sprite by a quarter cell toward the way it faces, so the body stays where the walk and idle draw it.
- Same canvas and layout as the other side-view sheets, so a character's walk, idle and attack line up.

## Inputs

- `character` (character-ref, required): the design to follow.
- `attack` (text, required): what the strike is, e.g. "one fast horizontal sword slash". Use the same words in both steps.
- `style` (text): empty takes the game's look.

## Check before animating

Look at both copies: is each facing its own way, in the ready stance, with one-sided details on the right side of the body? Draw the sheet again rather than animate a wrong one, because the sheet costs far less than the clip.

## CLI

```bash
pixo recipe run sprite-attack-sheet-side --input character=<slug> --input attack="<strike>" --json --wait
pixo recipe run sprite-attack-side --source-run <runId> --candidate <id> --input attack="<strike>" --json --wait
```
