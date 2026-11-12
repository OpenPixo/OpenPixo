# Save system

Adds versioned save slots that survive corrupt files, wired into the game's real state and checkpoints.

Works in Godot and Phaser projects; the brief tells the agent how to implement it in each engine and to build on what the project already has.

## Inputs

- `data` (text, default `player position, health, collected items, current level and unlocked levels`): What to save
- `slots` (select, default `one autosave slot`): Slots

## What runs

The recipe renders a task brief from the inputs and starts one agent run in the
project. The brief ends with `pixo game verify --steps check,build,run --screenshot --json`,
so the run is only done when the host's checks pass or the agent reports why a
step could not run.

```bash
pixo recipe run openpixo/feature-save-system --input data=... --json
```
