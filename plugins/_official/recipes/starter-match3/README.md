# Match-3 starter

Turns a Godot 2D or Phaser template into match-3 with a pure board model, cascades, combos and a win/lose loop.

Supports both `godot4-2d` (Godot 4, GDScript) and `phaser3-vite` (Phaser 3, TypeScript). Create a project with `pixo create-game` or New project → Game template first. The recipe uses the detected project engine and includes both engine skills, following only the applicable guidance. It does not convert an existing project between engines; use a 2D template.

## Inputs

- `theme` (string, default `glowing gemstones in a crystal cave`): Theme
- `boardSize` (select, default `8x8`): Board size. Options: 7x7; 8x8; 9x9
- `mode` (select, default `limited moves with a target score`): Mode. Options: endless with score; limited moves with a target score

## What runs

One code recipe starts one agent run through the same API used by Studio and `pixo recipe run`. The rendered brief contains engine-specific implementation notes, data-driven content, a complete playable loop and deterministic checks. No generated media or additional dependencies are required.

```bash
pixo recipe run openpixo/starter-match3 --input theme=... --json
```

## Verification

- Seeded starting boards are match-free and have a legal move for every supported board size.
- Row/column and L/T matches clear unique cells; gravity preserves surviving order; invalid/nonadjacent swaps restore the board without spending a move.
- Cascades score once per stage, stuck boards recover, and win/lose waits until resolution finishes.

Phaser runs isolated rules checks at dev boot before input, throwing on failure; the existing check/build scripts still typecheck them. Godot shares checks between debug boot and a headless `checks/rules_check.gd` runner that exits nonzero on failure. After import, run `godot --headless --path . --script checks/rules_check.gd` with the configured Godot executable. The brief ends with `pixo game verify --steps check,build,run --screenshot --json` and screenshot inspection. Missing tools or Godot export presets are reported as unavailable, never passed.

## Playtest hints

Use mouse clicks on two adjacent tiles that make a match. Also click a nonadjacent pair and an invalid adjacent swap, then click during a cascade to confirm input stays locked. Exercise reshuffle with a deterministic fixture and click Restart after the move budget ends. Keyboard presses do not demonstrate this mouse-driven loop.

Use actual mouse clicks for mouse-driven interactions. If a native Godot adapter cannot inject input, report the limitation and keep this sequence as a manual test; screenshots alone do not prove interaction.

## Evaluation status

Pending real-provider evaluation on both templates; see [evals/README.md](evals/README.md).
