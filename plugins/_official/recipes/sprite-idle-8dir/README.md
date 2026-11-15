# 8-direction idle animation

Step 2 of an idle animation. It animates an idle sheet from `sprite-idle-sheet-8dir` into one calm breathing loop per direction, then exports transparent frames as an engine sprite sheet.

## How it works

It is the walk's method with a different prompt and speed (see `sprite-walk-8dir`):

1. **The clip.** The sheet goes to an image-to-video model as both the first and the last frame, so the clip loops. It is 0.92 s at 768p, with prompt rewriting off. The prompt asks for one slow breath with the feet planted.
2. **Frames.** The clip is cut into 21 frames (or 7), keyed off the green, and split into 8 cells per frame.
3. **Export.** The frames are exported as one animation per direction: `down`, `down-right`, `right`, `up-right`, `up`, `up-left`, `left`, `down-left`.
   - It plays at half the clip's speed (`loopSeconds: 1.75`), so one breath takes 1.75 s: 21 frames at 12 fps, or 7 at 4 fps.
   - A breath at the clip's own speed would look rushed.

A result holds the clip, the sheet, the engine descriptor and `idle.sheet.json`.

## Inputs

- `source` (image-ref, required): the idle sheet.
  - On 生成, the action "8-direction idle animation" appears on an idle sheet result.
  - From the CLI, `--source-run <runId> --candidate <id>` passes a staged sheet without adopting it first.
- `frames` (`21` or `7`, default `21`): frames per direction.

## Models

`models.requires: ["i2v-loop"]`, the same as the walk:

- your own media gateway key: `h3-max-turbo-gateway`
- otherwise, with credits: `openpixo-walk-video`

## CLI

```bash
pixo recipe run sprite-idle-sheet-8dir --input character=<slug> --json --wait
pixo recipe run sprite-idle-8dir --source-run <runId> --candidate <id> --json --wait
pixo recipe adopt <runId> --candidate <candidateId> --project <id>
```
