# Gamepad support

Adds controller input through an action layer, analog movement with deadzones, menu navigation and device-aware button prompts.

Works in Godot and Phaser projects; the brief tells the agent how to implement it in each engine and to build on what the project already has.

## Inputs

- `scope` (text, default `movement, jump or primary action, pause, and menu navigation`): What the gamepad must control
- `glyphs` (select, default `Xbox-style (A/B/X/Y)`): Button labels

## What runs

The recipe renders a task brief from the inputs and starts one agent run in the
project. The brief ends with `pixo game verify --steps check,build,run --screenshot --json`,
so the run is only done when the host's checks pass or the agent reports why a
step could not run.

```bash
pixo recipe run openpixo/feature-gamepad --input scope=... --json
```
