# Idle incremental starter

Builds a Godot 2D or Phaser idle game with generators, prestige, capped offline progress, big-number formatting and saves.

Supports both `godot4-2d` (Godot 4, GDScript) and `phaser3-vite` (Phaser 3, TypeScript). Create a project with `pixo create-game` or New project → Game template first. The recipe uses the detected project engine and includes both engine skills, following only the applicable guidance. It does not convert an existing project between engines; use a 2D template.

## Inputs

- `theme` (string, default `a clockwork workshop powered by fireflies`): Theme
- `offlineCap` (select, default `eight hours`): Offline earnings cap. Options: eight hours; twenty-four hours

## What runs

One code recipe starts one agent run through the same API used by Studio and `pixo recipe run`. The rendered brief contains engine-specific implementation notes, data-driven content, a complete playable loop and deterministic checks. No generated media or additional dependencies are required.

```bash
pixo recipe run openpixo/starter-idle-incremental --input theme=... --json
```

## Verification

- Purchase boundaries, geometric Buy Max and generator production use exact expected fixtures without negative currency; big-number normalization/comparison/formatting remains finite across 1e3, 1e6 and exponents beyond 308.
- Injected timestamps cover offline time below the cap, above the cap, rollback and repeated load/resume without duplicate earnings or multiplier application.
- Prestige resets only run state, preserves permanent state and awards once; save round trips preserve large values and corrupt/future-version saves recover safely.

Phaser runs isolated rules checks at dev boot before input, throwing on failure; the existing check/build scripts still typecheck them. Godot shares checks between debug boot and a headless `checks/rules_check.gd` runner that exits nonzero on failure. After import, run `godot --headless --path . --script checks/rules_check.gd` with the configured Godot executable. The brief ends with `pixo game verify --steps check,build,run --screenshot --json` and screenshot inspection. Missing tools or Godot export presets are reported as unavailable, never passed.

## Playtest hints

Use mouse clicks: Gather until affordable, buy a generator, click Buy Max and inspect changing production. Use an injected-clock check fixture for offline/rollback cases instead of waiting hours. Reload to see an offline summary once, reach prestige with a short deterministic fixture, click Prestige and Confirm, and verify the multiplier/save after reload. Capture generator purchase and prestige preview; do not substitute keyboard input for clicks.

Use actual mouse clicks for mouse-driven interactions. If a native Godot adapter cannot inject input, report the limitation and keep this sequence as a manual test; screenshots alone do not prove interaction.

## Evaluation status

Pending real-provider evaluation on both templates; see [evals/README.md](evals/README.md).
