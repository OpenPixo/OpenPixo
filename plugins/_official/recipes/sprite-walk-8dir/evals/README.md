# Evals: openpixo/sprite-walk-8dir

Status: passed (0.2.0, 2026-11-12): 6 of 6 real candidates drew all eight directions in order; transparent background with clean edges; the adopted atlas loads and plays in Phaser 3.90.

Inspect every row before adopting, and run `asset frames check` / `asset frames align` per direction: the model's frames drift sideways and sometimes reach the cell edge.

## Setup

- Provider and model: `codex-cli` / `codex-image` (Codex CLI 0.160.0 with a ChatGPT sign-in), from the `pixo` CLI with no agent token.
- Project: a Phaser 3.90 top-down game with a cel-shaded anime heroine (Sakura Nightfall, made in OpenPixo).
- Character card `shrine-maiden`: one reference image (the heroine's full-body design, 256x256) and a written description.
- Inputs every run: `character=shrine-maiden`, `style=hand-painted 2D`, `frames=6`; default count of 2 candidates.

## Runs

| Run | Recipe | Candidates | Directions right | Background | Frames touching the cell edge (of 48) |
|---|---|---|---|---|---|
| 1 | 0.1.0, magenta key | 2 | 8/8, 8/8 | 5.7% of drawn pixels magenta-tinted; purple edge on every outline, magenta left in gaps | 9, 1 |
| 2 | 0.2.0, transparent | 2 | 8/8, 8/8 | 0% magenta, soft clean edges | 7, 0 |
| 3 | 0.2.0 plus margin wording | 2 | 8/8, 8/8 | 0% magenta, soft clean edges | 3, 0 |

- Checks: `has-alpha` and `grid-divisible` passed on all six candidates. They do not judge direction or alignment.
- Directions were judged by eye: the first frame of each row enlarged, and the right row compared with the left row mirrored.
- Run 1 led to 0.2.0: the sheet is now requested transparent instead of painted magenta and keyed with a hard cutoff.
- Run 2 led to the margin wording: a character drawn to its cell border loses hair and sleeve tips when the sheet is sliced.

## Frame check (`asset frames check`, per direction)

- Run 1, adopted candidate: 6 of 8 directions passed; two slid 11–16 px and one frame touched the edge.
- Run 2, adopted candidate: every direction slid 8–14 px. After `asset frames align --canvas 144x144` no direction slid any more, but frames already clipped at the cell edge stay flagged.

## Engine

- Both adopted candidates loaded in Phaser 3.90 (`load.atlas` with the exported JSON, `load.animation` with the animations file): 48 frames, all eight `walk-<direction>` clips, no load or page errors.
- The clips animate. A sprite walking a circle, choosing its clip from its velocity, used all eight.

## Known limits

- One candidate in run 3 invented a teal bow on the heroine's back. The reference shows only her front, so check the back rows against the design.
- The style input has no anime option; `hand-painted 2D` with a reference image kept the cel-shaded look.
- Adopting a second candidate into the same folder adds `_1` suffixes to every file name.
