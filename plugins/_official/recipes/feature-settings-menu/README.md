# Settings menu

Adds a settings menu for audio, display and controls that applies immediately and persists between sessions.

Works in Godot and Phaser projects; the brief tells the agent how to implement it in each engine and to build on what the project already has.

## Inputs

- `options` (text, default `master, music and SFX volume; fullscreen; key rebinding; language (only if the game is localized)`): Options
- `entry` (select, default `the title screen and the pause menu`): Opened from

## What runs

The recipe renders a task brief from the inputs and starts one agent run in the
project. The brief ends with `pixo game verify --steps check,build,run --screenshot --json`,
so the run is only done when the host's checks pass or the agent reports why a
step could not run.

```bash
pixo recipe run openpixo/feature-settings-menu --input options=... --json
```
