# Tower defense starter

Turns a Godot 2D or Phaser template into tower defense with a winding path, data-driven waves, buildable towers and an economy.

Supports both `godot4-2d` (Godot 4, GDScript) and `phaser3-vite` (Phaser 3, TypeScript). Create a project with `pixo create-game` or New project → Game template first. The recipe uses the detected project engine and includes both engine skills, following only the applicable guidance. It does not convert an existing project between engines; use a 2D template.

## Inputs

- `theme` (string, default `a medieval valley defended against goblin raiders`): Theme
- `towers` (select, default `two towers: fast single-target and slow splash`): Towers. Options: two towers: fast single-target and slow splash; three towers: fast single-target, slow splash and slowing

## What runs

One code recipe starts one agent run through the same API used by Studio and `pixo recipe run`. The rendered brief contains engine-specific implementation notes, data-driven content, a complete playable loop and deterministic checks. No generated media or additional dependencies are required.

```bash
pixo recipe run openpixo/starter-tower-defense --input theme=... --json
```

## Verification

- Insufficient funds or occupied spots never spend gold; a sell returns floor(cost / 2) exactly once.
- Targeting chooses the furthest in-range live enemy; duplicate damage never duplicates gold or splash damage.
- A wave cannot finish while queued spawns remain; escape reduces lives once; restart clears spawns, towers and projectiles.

Phaser runs isolated rules checks at dev boot before input, throwing on failure; the existing check/build scripts still typecheck them. Godot shares checks between debug boot and a headless `checks/rules_check.gd` runner that exits nonzero on failure. After import, run `godot --headless --path . --script checks/rules_check.gd` with the configured Godot executable. The brief ends with `pixo game verify --steps check,build,run --screenshot --json` and screenshot inspection. Missing tools or Godot export presets are reported as unavailable, never passed.

## Playtest hints

Use mouse clicks: click a build spot, choose a tower, click Next wave, inspect a tower range, sell it and build again. Try an unaffordable tower and double-click Next wave. Play to a loss or final-wave victory and click Restart. Capture a wave with enemies moving and gold/lives changing.

Use actual mouse clicks for mouse-driven interactions. If a native Godot adapter cannot inject input, report the limitation and keep this sequence as a manual test; screenshots alone do not prove interaction.

## Evaluation status

Pending real-provider evaluation on both templates; see [evals/README.md](evals/README.md).
