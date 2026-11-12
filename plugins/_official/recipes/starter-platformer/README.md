# Platformer starter

Turns a Godot 2D or Phaser template into a side-scrolling platformer with tight jumps, collectibles, enemies and a goal.

Supports both `godot4-2d` (Godot 4, GDScript) and `phaser3-vite` (Phaser 3, TypeScript). Create a project with `pixo create-game` or New project → Game template first. The recipe uses the detected project engine and includes both engine skills, following only the applicable guidance. It does not convert an existing project between engines; use a 2D template.

## Inputs

- `theme` (string, default `a fox exploring an overgrown temple`): Theme
- `scope` (select, default `coins, patrolling enemies and a goal flag`): Scope. Options: coins and a goal flag; coins, patrolling enemies and a goal flag; coins, moving platforms, double jump and a goal flag

## What runs

One code recipe starts one agent run through the same API used by Studio and `pixo recipe run`. The rendered brief contains engine-specific implementation notes, data-driven content, a complete playable loop and deterministic checks. No generated media or additional dependencies are required.

```bash
pixo recipe run openpixo/starter-platformer --input theme=... --json
```

## Verification

- Coyote-time and buffered-jump boundaries with an injected delta; early release shortens jump height.
- Collecting the same pickup twice counts once; respawn clears velocity and jump timers; restart resets level state.
- Level data places the start/checkpoints/goal on safe surfaces; scoped double jump resets only on landing.

Phaser runs isolated rules checks at dev boot before input, throwing on failure; the existing check/build scripts still typecheck them. Godot shares checks between debug boot and a headless `checks/rules_check.gd` runner that exits nonzero on failure. After import, run `godot --headless --path . --script checks/rules_check.gd` with the configured Godot executable. The brief ends with `pixo game verify --steps check,build,run --screenshot --json` and screenshot inspection. Missing tools or Godot export presets are reported as unavailable, never passed.

## Playtest hints

Use arrows or A/D to move, Space to jump, release Space early to compare jump height, collect a coin, fall and respawn, then reach the goal and restart. Check scoped enemy stomps, moving platforms and double jump. Capture the HUD and a mid-level jump, not only the start screen.

Use actual mouse clicks for mouse-driven interactions. If a native Godot adapter cannot inject input, report the limitation and keep this sequence as a manual test; screenshots alone do not prove interaction.

## Evaluation status

Pending real-provider evaluation on both templates; see [evals/README.md](evals/README.md).
