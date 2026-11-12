# Cozy farm starter

Builds a Godot 2D or Phaser farm with tile tilling, planting, day-based crop growth, inventory and selling.

Supports both `godot4-2d` (Godot 4, GDScript) and `phaser3-vite` (Phaser 3, TypeScript). Create a project with `pixo create-game` or New project → Game template first. The recipe uses the detected project engine and includes both engine skills, following only the applicable guidance. It does not convert an existing project between engines; use a 2D template.

## Inputs

- `theme` (string, default `a tiny hillside farm supplying a village cafe`): Theme
- `pace` (select, default `two-minute days with a Sleep button`): Day length. Options: two-minute days with a Sleep button; five-minute days with a Sleep button

## What runs

One code recipe starts one agent run through the same API used by Studio and `pixo recipe run`. The rendered brief contains engine-specific implementation notes, data-driven content, a complete playable loop and deterministic checks. No generated media or additional dependencies are required.

```bash
pixo recipe run openpixo/starter-cozy-farm --input theme=... --json
```

## Verification

- Invalid planting leaves seeds unchanged; harvest with a full inventory leaves the crop intact; sale/buy transactions cannot make counts or coins negative.
- An injected clock grows watered crops exactly once per day, unwatered crops wait, and simultaneous Sleep/timer rollover does not double-grow crops.
- Round-trip saves preserve tile/day/inventory state; unknown item ids, corrupt saves and repeated reset inputs are handled safely.

Phaser runs isolated rules checks at dev boot before input, throwing on failure; the existing check/build scripts still typecheck them. Godot shares checks between debug boot and a headless `checks/rules_check.gd` runner that exits nonzero on failure. After import, run `godot --headless --path . --script checks/rules_check.gd` with the configured Godot executable. The brief ends with `pixo game verify --steps check,build,run --screenshot --json` and screenshot inspection. Missing tools or Godot export presets are reported as unavailable, never passed.

## Playtest hints

Use mouse clicks throughout: choose Hoe and click soil, choose Seeds and click the tilled tile, choose Water and click it, then click Sleep for enough watered days. Harvest, click the shipping bin to sell, buy seeds and reload to check the save. Verify menu clicks do not also till or plant. Capture a changed crop stage, inventory and coin count.

Use actual mouse clicks for mouse-driven interactions. If a native Godot adapter cannot inject input, report the limitation and keep this sequence as a manual test; screenshots alone do not prove interaction.

## Evaluation status

Pending real-provider evaluation on both templates; see [evals/README.md](evals/README.md).
