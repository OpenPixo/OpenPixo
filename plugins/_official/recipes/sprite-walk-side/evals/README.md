# Evals: openpixo/sprite-walk-side

Status: pending (0.1.0). The first real run made a good clip but failed at export; the export is fixed and needs one more real run before this is marked passed.

## First real run (2026-11-21, 鸦堡 tutorial build)

- **Source:** a `sprite-walk-sheet-side` sheet of the game's hero (visored knight, white plume, lantern shield, broad blade), drawn with `codex-image`.
- **Run:** by the agent (Codex) with the user's approval card, on the hosted `openpixo-walk-video`, 10 credits from the art budget.
- **Clip:** good. Checked frame by frame after a local cut: 21 frames per facing at 24 fps, legs alternate along the facing, no copy turns, the blade and shield stay in the same hands, the green keys out cleanly, boots sit within 1 px, and the first and last frames join without a jump.
- **Failed:** `export-spritesheet` refused the row. The old resize kept 1344x768, so each facing was 672 px wide and 21 of them made a 14,112 px row, past the 8192 px limit. The agent recovered the frames from the clip locally; nothing was charged twice.
- **Fix:** the clip now resizes to 768x432 before slicing (384x432 cells, an 8,064 px row). `recipes-pipeline-regressions.test.ts` checks every animation recipe's widest row.

Record a real run of this version (export included) before marking it passed.
