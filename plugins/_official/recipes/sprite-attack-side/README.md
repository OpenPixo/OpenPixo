# Side-view attack animation

Step 2 of a side-view attack animation. It animates a sheet from `sprite-attack-sheet-side` into a one-shot `right` and `left` animation, as transparent frames and an engine sprite sheet.

## How it works

It is the 8-direction walk's method (see `sprite-walk-8dir`) on a 2x1 grid:

1. **The clip.** The sheet goes to an image-to-video model as both the first and the last frame: a short wind-up, one strike, and straight back to the ready stance. 0.92 s at 768p, prompt rewriting off.
2. **Frames.** The clip is cut into 21 frames (or 7), keyed off the green and split into 2 cells per frame.
3. **Export.** One animation per facing, `right` and `left`, `loopSeconds: 0.875` with `loop: false`: a one-shot of 21 frames at 24 fps, or 7 at 8 fps.

- The character is drawn at the same height as on the side-view walk and idle sheets (about 60% of the cell), but its body sits a quarter of the cell width behind the cell's centre, leaving the front of the cell for the strike. In the engine, offset the attack sprite by a quarter cell toward the way it faces, so the body stays where the walk and idle draw it.

A result holds the clip, the sheet, the engine descriptor and `attack.sheet.json`.

## Inputs

- `source` (image-ref, required): the sheet. On 生成 the action appears on a sheet result; from the CLI, `--source-run <runId> --candidate <id>` passes a staged sheet without adopting it first.
- `attack` (text, required): what the strike is, e.g. "one fast horizontal sword slash". Use the same words in both steps.
- `frames` (`21` or `7`, default `21`): frames per facing.

## Models

`models.requires: ["i2v-loop"]`, the same clip as the 8-direction walk:

- your own media gateway key: `h3-max-turbo-gateway`
- otherwise, with credits: `openpixo-walk-video`

## CLI

```bash
pixo recipe run sprite-attack-sheet-side --input character=<slug> --input attack="<strike>" --json --wait
pixo recipe run sprite-attack-side --source-run <runId> --candidate <id> --input attack="<strike>" --json --wait
pixo recipe adopt <runId> --candidate <candidateId> --project <id>
```
