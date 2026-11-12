# Deckbuilder roguelite starter

Builds score/combo card runs in Godot 2D or Phaser with between-round shops, joker-like modifiers and data-driven cards.

Supports both `godot4-2d` (Godot 4, GDScript) and `phaser3-vite` (Phaser 3, TypeScript). Create a project with `pixo create-game` or New project → Game template first. The recipe uses the detected project engine and includes both engine skills, following only the applicable guidance. It does not convert an existing project between engines; use a 2D template.

## Inputs

- `theme` (string, default `a travelling constellation card fair`): Theme
- `runLength` (select, default `four rounds`): Run length. Options: four rounds; six rounds

## What runs

One code recipe starts one agent run through the same API used by Studio and `pixo recipe run`. The rendered brief contains engine-specific implementation notes, data-driven content, a complete playable loop and deterministic checks. No generated media or additional dependencies are required.

```bash
pixo recipe run openpixo/starter-deckbuilder-roguelite --input theme=... --json
```

## Verification

- A fixed seed reproduces deals/shop offers; card instances are conserved through draw/discard/reshuffle.
- Fixed hands produce exact pair/straight/flush scores and additive-then-multiplicative modifier order; invalid selection or double-clicked Play Hand cannot consume two hands.
- Unaffordable/full-slot/sold purchases leave state unchanged; a successful purchase spends once; round transitions preserve deck/modifiers and final win/loss boundaries are correct.

Phaser runs isolated rules checks at dev boot before input, throwing on failure; the existing check/build scripts still typecheck them. Godot shares checks between debug boot and a headless `checks/rules_check.gd` runner that exits nonzero on failure. After import, run `godot --headless --path . --script checks/rules_check.gd` with the configured Godot executable. The brief ends with `pixo game verify --steps check,build,run --screenshot --json` and screenshot inspection. Missing tools or Godot export presets are reported as unavailable, never passed.

## Playtest hints

Use mouse clicks: select cards, click Play Hand, inspect the score breakdown, select a discard and click Discard. Clear a round, click one affordable shop offer and then Next Round; also try an unaffordable or sold offer. Click Restart on a result. Use a deterministic seed/fixture to reach the shop quickly and capture both hand scoring and a purchased modifier.

Use actual mouse clicks for mouse-driven interactions. If a native Godot adapter cannot inject input, report the limitation and keep this sequence as a manual test; screenshots alone do not prove interaction.

## Evaluation status

Pending real-provider evaluation on both templates; see [evals/README.md](evals/README.md).
