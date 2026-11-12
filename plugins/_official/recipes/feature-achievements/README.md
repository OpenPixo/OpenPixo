# Achievements

Adds event-driven achievements with progress, unlock toasts, an achievements screen and local persistence.

Works in Godot and Phaser projects; the brief tells the agent how to implement it in each engine and to build on what the project already has.

## Inputs

- `list` (text, default `First Steps: finish the first level; Collector: collect 100 coins in total; Untouchable: finish a level without taking damage`): Achievements (title: condition; ...)

## What runs

The recipe renders a task brief from the inputs and starts one agent run in the
project. The brief ends with `pixo game verify --steps check,build,run --screenshot --json`,
so the run is only done when the host's checks pass or the agent reports why a
step could not run.

```bash
pixo recipe run openpixo/feature-achievements --input list=... --json
```
