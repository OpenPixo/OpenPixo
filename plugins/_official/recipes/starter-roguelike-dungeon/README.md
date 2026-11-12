# Roguelike dungeon starter

Turns a Godot 2D or Phaser template into a seeded dungeon crawler with grid movement, field of view, enemies and stairs.

Supports both `godot4-2d` (Godot 4, GDScript) and `phaser3-vite` (Phaser 3, TypeScript). Create a project with `pixo create-game` or New project → Game template first. The recipe uses the detected project engine and includes both engine skills, following only the applicable guidance. It does not convert an existing project between engines; use a 2D template.

## Inputs

- `theme` (string, default `a damp crypt beneath an abandoned chapel`): Theme
- `turns` (select, default `turn-based: enemies act after each player move`): Time model. Options: turn-based: enemies act after each player move; real-time movement on the grid

## What runs

One code recipe starts one agent run through the same API used by Studio and `pixo recipe run`. The rendered brief contains engine-specific implementation notes, data-driven content, a complete playable loop and deterministic checks. No generated media or additional dependencies are required.

```bash
pixo recipe run openpixo/starter-roguelike-dungeon --input theme=... --json
```

## Verification

- A fixed seed reproduces the map and spawns; several fixed seeds produce reachable stairs with no overlapping spawns.
- Walls block movement and line of sight; explored state persists after leaving visibility.
- A valid turn consumes exactly one enemy action, blocked movement consumes none, and descending/restarting resets the intended floor state.

Phaser runs isolated rules checks at dev boot before input, throwing on failure; the existing check/build scripts still typecheck them. Godot shares checks between debug boot and a headless `checks/rules_check.gd` runner that exits nonzero on failure. After import, run `godot --headless --path . --script checks/rules_check.gd` with the configured Godot executable. The brief ends with `pixo game verify --steps check,build,run --screenshot --json` and screenshot inspection. Missing tools or Godot export presets are reported as unavailable, never passed.

## Playtest hints

Use arrows/WASD for grid movement, Space to wait, and R to regenerate. Walk into a wall, attack by bumping an enemy, pick up a potion and descend the stairs. Confirm the selected time model, hidden rooms, seed display and death/restart loop.

Use actual mouse clicks for mouse-driven interactions. If a native Godot adapter cannot inject input, report the limitation and keep this sequence as a manual test; screenshots alone do not prove interaction.

## Evaluation status

Pending real-provider evaluation on both templates; see [evals/README.md](evals/README.md).
