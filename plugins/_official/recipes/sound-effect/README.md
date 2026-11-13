# Sound effect

Any sound effect from a description, made as a few takes to choose from, trimmed and evened out in loudness.

This is the plain sound recipe behind the generator's 音效 tab. Games usually play one of several takes at random, so a run makes three by default.

## Inputs

- `prompt` (text, required): Description
- `duration` (number, default `1`): Length (seconds); a hosted service keeps it within its own limits
- `format` (select, default `ogg`): Format
- `name` (string, required): File name (lowercase, no spaces)

## Pipeline

- Surface: `audio`; model capability: `sfx`.
- Postprocess: `audio-trim` → `audio-normalize` (-16 LUFS) → `audio-convert`.
- Checks: `duration-range`.
- Output: `{{engine.audioRoot}}/sfx/{{name}}` (written only when you adopt a candidate).

## CLI

```bash
pixo recipe run openpixo/sound-effect --input prompt="a short metal sword swing" --input name=sword_swing --wait --json
```
