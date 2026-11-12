# Inventory

Adds data-driven items, a stacking inventory model, an inventory screen and world pickups.

Works in Godot and Phaser projects; the brief tells the agent how to implement it in each engine and to build on what the project already has.

## Inputs

- `layout` (select, default `slot grid with stacking`): Layout
- `capacity` (number, default `20`): Capacity (slots)
- `items` (text, default `health potion (stacks to 10), iron key, gold coin (stacks to 99), wooden sword`): Starter items

## What runs

The recipe renders a task brief from the inputs and starts one agent run in the
project. The brief ends with `pixo game verify --steps check,build,run --screenshot --json`,
so the run is only done when the host's checks pass or the agent reports why a
step could not run.

```bash
pixo recipe run openpixo/feature-inventory --input layout=... --json
```
