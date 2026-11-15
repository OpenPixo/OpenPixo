# 8-direction walk animation

Step 2 of a walk animation. It animates a walk sheet from `sprite-walk-sheet-8dir` into one looping walk per direction, then exports transparent frames as an engine sprite sheet.

## How it works

1. **The clip.** The sheet (8 copies of the character, mid-stride, 4x2 on green) goes to an image-to-video model as both the first and the last frame. The clip is 0.92 s at 768p, prompt rewriting is off, and the prompt states each copy's stride axis. Because the clip starts and ends on the sheet, it loops. Because the sheet is mid-stride, the loop never passes through a standing pose.
2. `video-frames`: one PNG per frame. The last frame repeats the first and is dropped, leaving 21 frames (or 7, evenly spaced).
3. `resize` to 1344x768, so the 4x2 grid divides exactly.
4. `remove-bg`: a soft green-screen key with despill, so outlines do not glow green.
5. `slice` 4x2: 8 cells per frame.
6. `export-spritesheet` with `order: by-cell`: cell N of every frame becomes animation N. The animations are `down`, `down-right`, `right`, `up-right`, `up`, `up-left`, `left`, `down-left`. With `loopSeconds: 0.875`, 21 frames play at 24 fps and 7 at 8 fps.

The intermediate frames are not staged (`keep: false`). A result holds the clip, the sheet, the engine descriptor and `walk.sheet.json` (cell size, columns, animations, fps).

## Inputs

- `source` (image-ref, required): the walk sheet. On 生成 the action "8-direction walk animation" appears on a walk sheet result. From the CLI, `--source-run <runId> --candidate <id>` passes a staged sheet without adopting it first.
- `frames` (`21` or `7`, default `21`): frames per direction.

## Models

`models.requires: ["i2v-loop"]`. Only a model that takes an end frame and a sub-second length can make this clip:

- your own media gateway key: `h3-max-turbo-gateway`
- otherwise, with credits: `openpixo-walk-video`

## CLI

```bash
pixo recipe run sprite-walk-sheet-8dir --input character=<slug> --json --wait
pixo recipe run sprite-walk-8dir --source-run <runId> --candidate <id> --json --wait
pixo recipe adopt <runId> --candidate <candidateId> --project <id>
```

## Notes

- Check the sheet before animating it: a wrong direction on the sheet stays wrong in the walk.
- The diagonals can twist slightly toward a side view at the passing pose. If one looks wrong, run step 2 again: each run is cheap, and every clip starts and ends on the same sheet.
- 0.2.0 drew all 64 frames in one picture, and models did not keep the eight directions consistent. 0.3.0 replaces that with this two-step method.
