# Card battler starter

Turns a Godot 2D or Phaser template into a card battler with data-driven cards, enemy intents and pure battle rules.

Supports both `godot4-2d` (Godot 4, GDScript) and `phaser3-vite` (Phaser 3, TypeScript). Create a project with `pixo create-game` or New project → Game template first. The recipe uses the detected project engine and includes both engine skills, following only the applicable guidance. It does not convert an existing project between engines; use a 2D template.

## Inputs

- `theme` (string, default `an arcane duel between rival mages`): Theme
- `scope` (select, default `a single battle against one enemy`): Scope. Options: a single battle against one enemy; a run of three battles with a card reward after each

## What runs

One code recipe starts one agent run through the same API used by Studio and `pixo recipe run`. The rendered brief contains engine-specific implementation notes, data-driven content, a complete playable loop and deterministic checks. No generated media or additional dependencies are required.

```bash
pixo recipe run openpixo/starter-card-battler --input theme=... --json
```

## Verification

- Seeded reshuffling preserves every card instance; drawing from an empty discard is safe.
- An unaffordable or invalid-target card leaves energy/hand unchanged; valid cards deduct cost and resolve exactly once; block and damage ordering is correct.
- End Turn advances intent once; lethal damage stops the turn; scoped rewards add exactly one card and new battles reset transient state.

Phaser runs isolated rules checks at dev boot before input, throwing on failure; the existing check/build scripts still typecheck them. Godot shares checks between debug boot and a headless `checks/rules_check.gd` runner that exits nonzero on failure. After import, run `godot --headless --path . --script checks/rules_check.gd` with the configured Godot executable. The brief ends with `pixo game verify --steps check,build,run --screenshot --json` and screenshot inspection. Missing tools or Godot export presets are reported as unavailable, never passed.

## Playtest hints

Use mouse clicks: select an affordable attack, click the enemy, play a block card and click End Turn. Attempt an unaffordable card, inspect enemy intent and pile counts, then click a reward when in three-battle scope. Click Restart on victory/defeat. Capture the hand and a changed HP/energy state.

Use actual mouse clicks for mouse-driven interactions. If a native Godot adapter cannot inject input, report the limitation and keep this sequence as a manual test; screenshots alone do not prove interaction.

## Evaluation status

Pending real-provider evaluation on both templates; see [evals/README.md](evals/README.md).
