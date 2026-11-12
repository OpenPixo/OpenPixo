# Survivors starter

Builds a Godot 2D or Phaser survivors loop with auto-attacks, XP gems, three-choice upgrades and pooled escalating hordes.

Supports both `godot4-2d` (Godot 4, GDScript) and `phaser3-vite` (Phaser 3, TypeScript). Create a project with `pixo create-game` or New project → Game template first. The recipe uses the detected project engine and includes both engine skills, following only the applicable guidance. It does not convert an existing project between engines; use a 2D template.

## Inputs

- `theme` (string, default `a lantern keeper holding back forest spirits`): Theme
- `duration` (select, default `three-minute survival`): Run length. Options: three-minute survival; five-minute survival

## What runs

One code recipe starts one agent run through the same API used by Studio and `pixo recipe run`. The rendered brief contains engine-specific implementation notes, data-driven content, a complete playable loop and deterministic checks. No generated media or additional dependencies are required.

```bash
pixo recipe run openpixo/starter-survivors --input theme=... --json
```

## Verification

- XP collected twice awards once; overflow queues the right number of levels; each offer has three unique eligible choices and a double click applies one upgrade.
- A recycled enemy restores HP/collision/velocity and cannot award a second kill; all pool caps and escalation intervals remain bounded.
- An injected active clock does not advance during upgrade pause; timeout wins, lethal damage loses, and restart clears pools and queued levels.

Phaser runs isolated rules checks at dev boot before input, throwing on failure; the existing check/build scripts still typecheck them. Godot shares checks between debug boot and a headless `checks/rules_check.gd` runner that exits nonzero on failure. After import, run `godot --headless --path . --script checks/rules_check.gd` with the configured Godot executable. The brief ends with `pixo game verify --steps check,build,run --screenshot --json` and screenshot inspection. Missing tools or Godot export presets are reported as unavailable, never passed.

## Playtest hints

Move with WASD/arrows and let auto-attacks kill enemies. Walk over XP gems, then use a mouse click on one of the three upgrade cards. Confirm the horde freezes while the menu is open and resumes after selection. Use short deterministic check fixtures for late-run pressure, then click Restart after a result; capture combat, XP and the upgrade overlay.

Use actual mouse clicks for mouse-driven interactions. If a native Godot adapter cannot inject input, report the limitation and keep this sequence as a manual test; screenshots alone do not prove interaction.

## Evaluation status

Pending real-provider evaluation on both templates; see [evals/README.md](evals/README.md).
