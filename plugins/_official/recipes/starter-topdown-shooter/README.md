# Top-down shooter starter

Turns a Godot 2D or Phaser template into a wave shooter with pooled bullets, chasing enemies, a HUD and a restart loop.

Supports both `godot4-2d` (Godot 4, GDScript) and `phaser3-vite` (Phaser 3, TypeScript). Create a project with `pixo create-game` or New project → Game template first. The recipe uses the detected project engine and includes both engine skills, following only the applicable guidance. It does not convert an existing project between engines; use a 2D template.

## Inputs

- `theme` (string, default `a neon arena overrun by drone swarms`): Theme
- `controls` (select, default `WASD to move, mouse to aim and shoot`): Controls. Options: WASD to move, mouse to aim and shoot; WASD to move, arrow keys to shoot

## What runs

One code recipe starts one agent run through the same API used by Studio and `pixo recipe run`. The rendered brief contains engine-specific implementation notes, data-driven content, a complete playable loop and deterministic checks. No generated media or additional dependencies are required.

```bash
pixo recipe run openpixo/starter-topdown-shooter --input theme=... --json
```

## Verification

- Normalized diagonal speed matches axial speed; cooldown and invulnerability boundaries use an injected delta.
- Pooled bullets reset all hit/lifetime/body state; duplicate overlap gives one hit/reward.
- Wave data escalates within spawn/pool caps; best-score corrupt storage falls back safely; restart creates one spawner.

Phaser runs isolated rules checks at dev boot before input, throwing on failure; the existing check/build scripts still typecheck them. Godot shares checks between debug boot and a headless `checks/rules_check.gd` runner that exits nonzero on failure. After import, run `godot --headless --path . --script checks/rules_check.gd` with the configured Godot executable. The brief ends with `pixo game verify --steps check,build,run --screenshot --json` and screenshot inspection. Missing tools or Godot export presets are reported as unavailable, never passed.

## Playtest hints

Move with WASD. For mouse controls, aim at an enemy and click/hold the left mouse button; for arrow-key controls, fire with the arrows. Take damage, confirm invulnerability, reach game over and click or press Enter to restart twice. Capture active bullets and a changed score/HP HUD.

Use actual mouse clicks for mouse-driven interactions. If a native Godot adapter cannot inject input, report the limitation and keep this sequence as a manual test; screenshots alone do not prove interaction.

## Evaluation status

Pending real-provider evaluation on both templates; see [evals/README.md](evals/README.md).
