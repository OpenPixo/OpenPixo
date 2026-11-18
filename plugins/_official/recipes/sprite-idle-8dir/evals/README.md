# Evals: openpixo/sprite-idle-8dir

Status: pending (0.1.0). A hand-run trial of the method passed, but no run of this recipe through `pixo recipe run` has been recorded. Record one before marking it passed.

**Not yet re-run (2026-11-18):** the prompt no longer says "cartoon character", only "character", so the source picture alone sets the look (a recipe should not bring a style of its own). Nothing else changed. Re-run one clip from an accepted sheet and judge every direction by eye before recording this version as passed.

## Trial of the method (2026-11-15, by hand, not through the recipe)

- **Clip:** the walk trial's standing-pose sheet, as both start and end frame. Media gateway `minimax/h3-max-turbo/image-to-video`, 768p, prompt expansion `disabled`, **1.5 s**, with this recipe's prompt.
- **Frames:** 39 frames; the last repeated the first (mean difference 1.01) and was dropped. Keyed with the walk's soft green key, cut 4x2, judged by eye.
- **Result:**
  - All 8 directions breathe and bob slightly, and the hair and scarf stir. The front views blink twice.
  - The feet stay planted. No copy turned, stepped or drifted.
  - Nothing reached a cell edge. The loop has no visible seam.

## Not yet tested

- The recipe makes a **0.92 s** clip and plays it at half speed (`loopSeconds: 1.75`) instead of making a 1.5 s clip.
  - That keeps one hosted service for walk and idle, and one price.
  - Whether a 0.92 s breath looks smooth at 12 fps is what the first recipe run must check.
  - If it looks rushed or choppy, the fix is a longer clip, which needs its own hosted service.

## Cost

About US$0.04 per clip at 768p on the vendor's standard price, the same as a walk.
