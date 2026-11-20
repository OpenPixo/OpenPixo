# Side-view idle animation

Step 2 of a side-view idle animation. It animates a sheet from `sprite-idle-sheet-side` into a looping `right` and `left` animation, as transparent frames and an engine sprite sheet.

## How it works

It is the 8-direction walk's method (see `sprite-walk-8dir`) on a 2x1 grid:

1. **The clip.** The sheet goes to an image-to-video model as both the first and the last frame: one slow breath, feet planted. 0.92 s at 768p, prompt rewriting off.
2. **Frames.** The clip is cut into 21 frames (or 7), resized to 768x432, keyed off the green and split into 2 cells of 384x432 per frame (21 of them fit the 8192 px sheet limit).
3. **Export.** One animation per facing, `right` and `left`, `loopSeconds: 1.75`, half the clip's speed: 21 frames at 12 fps, or 7 at 4 fps.

A result holds the clip, the sheet, the engine descriptor and `idle.sheet.json`.

## Inputs

- `source` (image-ref, required): the sheet. On 生成 the action appears on a sheet result; from the CLI, `--source-run <runId> --candidate <id>` passes a staged sheet without adopting it first.
- `frames` (`21` or `7`, default `21`): frames per facing.

## Models

`models.requires: ["i2v-loop"]`, the same clip as the 8-direction walk:

- your own media gateway key: `h3-max-turbo-gateway`
- otherwise, with credits: `openpixo-walk-video`

## CLI

```bash
pixo recipe run sprite-idle-sheet-side --input character=<slug> --json --wait
pixo recipe run sprite-idle-side --source-run <runId> --candidate <id> --json --wait
pixo recipe adopt <runId> --candidate <candidateId> --project <id>
```
