# Evals: openpixo/sprite-walk-8dir

Status: passed (0.3.0), 2026-11-15, on `media-gateway` / `h3-max-turbo-gateway` (own key).

**Not yet re-run (2026-11-18):** the prompt no longer says "cartoon character", only "character", so the source picture alone sets the look (a recipe should not bring a style of its own). Nothing else changed. Re-run one clip from an accepted sheet and judge every direction by eye before recording this version as passed.

## Recipe run (2026-11-15)

- **Source:** candidate `3be36acb` of `sprite-walk-sheet-8dir` run `23727d4a` (see that recipe's evals), passed with `--source-run` before adoption.
- **Command:** `pixo recipe run sprite-walk-8dir --source-run 23727d4a-ced5-4019-b29e-5b75f6219a07 --candidate 3be36acb-2f74-48f8-9e2e-f791ac2efac4 --model h3-max-turbo-gateway --wait --json`
- **Run:** `34acd336-0fe4-4a49-8d33-defb333d955e`, status `ready`, one candidate. It staged `primary.mp4`, `walk.png` (7056x3072: 21 columns of 336x384 cells, 8 rows), `walk.aseprite.json` and `walk.sheet.json` (24 fps, loop). Check `has-alpha` passed.
- **By eye:**
  - All 8 directions step along their own axis, with no standing pause in the loop.
  - The key is clean, with no green fringe.
  - As in the trial, the four diagonals turn toward a side view at the passing pose and back.
- **On 生成:**
  - The sheet result offers 「8 方向行走动画」.
  - With an own key the action is free in credits, so it starts at once. That run (16:35, also `ready`) previews as eight labelled, looping directions.
- **Found and fixed during the run:**
  - Each postprocess step writes under the previous step's path, so the third step's frame paths passed 260 characters.
  - On Windows the image library could not open them, and the first attempt failed at `remove-bg` after the clip was made.
  - Asset ops now open pictures through Node's long-path form. Covered by `apps/daemon/tests/asset-ops-long-path.test.ts`.
- **Cost:** three clips, about US$0.04 each (one failed run, one CLI run, one started from 生成).

## Trial of the method (2026-11-15, by hand, not through the recipe)

- **Sheet:** Codex image (`codex-image`, ChatGPT sign-in), an asymmetric adventurer (sword on the right hip, satchel on the left, a one-sided scarf tail), 4x2 on #00FF00.
- **Clip:** media gateway `minimax/h3-max-turbo/image-to-video`. Runs were 0.92 s with the sheet as both start and end frame, and prompt expansion `disabled`.
- **Frames:** extracted with FFmpeg, keyed with the same soft green key, cut 4x2, played back per direction and judged by eye.

| Run | Sheet | Prompt | Size | Result |
|---|---|---|---|---|
| 1 | standing pose | "walk in place" | 480p | Every direction stepped with a side-scroller stride: legs across the screen, so down, up and the diagonals walked sideways. Some copies turned. Rejected. |
| 2 | standing pose | each copy's stride axis spelled out | 768p | Down and up fixed. The diagonals were still partly sideways, and each loop paused on the standing pose. |
| 2b | standing pose | same, with the vendor's "quality" prompt expansion | 768p | Worse: the expansion dropped the per-direction detail. One step only, arms flapping. |
| 3 | **mid-stride**, left foot forward along each facing | as run 2 | 768p | All 8 step along their own axis and the loop has no pause. The diagonals twist slightly toward profile at the passing pose. Accepted as the method. |

- **Clip output:** H.264, 1344x768, 24 fps, 22 frames, with an AAC track. The format tags carry no vendor metadata.
- **Loop seam:** the first and last frames differ by a mean of 1.45 (0–255 per channel) in run 3.
- **Sideways drift:** under 3 px per direction.
- **Lesson:** loop-seam and drift numbers called run 1 "clean". Judge each direction by eye.

## Cost

The vendor's standard price is US$0.04/s at 768p, so about US$0.037–0.04 per clip, with all eight directions in one clip. Hosted (`openpixo-walk-video`) is priced by the cloud.

## 0.2.0 (replaced)

0.2.0 drew all 64 frames in one transparent picture with `codex-image` and passed on 2026-11-12: 6 of 6 candidates had all directions in order. Frames drifted 8–16 px sideways, and the directions were not kept consistent in general, which is why the method changed.
