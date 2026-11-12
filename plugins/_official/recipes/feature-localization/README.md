# Localization

Moves user-visible text to translation keys, adds locale files, a language switch, and a missing-key check.

Works in Godot and Phaser projects; the brief tells the agent how to implement it in each engine and to build on what the project already has.

## Inputs

- `languages` (string, default `en, zh-CN`): Languages (first is the source)
- `source` (select, default `extract every existing hard-coded string`): Strings

## What runs

The recipe renders a task brief from the inputs and starts one agent run in the
project. The brief ends with `pixo game verify --steps check,build,run --screenshot --json`,
so the run is only done when the host's checks pass or the agent reports why a
step could not run.

```bash
pixo recipe run openpixo/feature-localization --input languages=... --json
```
