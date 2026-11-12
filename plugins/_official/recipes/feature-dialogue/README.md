# Dialogue system

Adds data-driven NPC dialogue with a typewriter text box, optional choices and flags, plus one sample conversation.

Works in Godot and Phaser projects; the brief tells the agent how to implement it in each engine and to build on what the project already has.

## Inputs

- `structure` (select, default `branching choices that set and check flags`): Structure
- `presentation` (select, default `bottom text box with speaker name and portrait slot`): Presentation
- `sample` (text, default `a gatekeeper who lets the player through only after they have found the key`): Sample conversation to write

## What runs

The recipe renders a task brief from the inputs and starts one agent run in the
project. The brief ends with `pixo game verify --steps check,build,run --screenshot --json`,
so the run is only done when the host's checks pass or the agent reports why a
step could not run.

```bash
pixo recipe run openpixo/feature-dialogue --input structure=... --json
```
