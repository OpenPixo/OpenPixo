# Music

Instrumental game music from a description, made to loop with a short crossfade.

This is the plain music recipe behind the generator's 音乐 tab. `bgm-loop` is the guided version with genre, mood and tempo fields.

## Inputs

- `prompt` (text, required): Description
- `format` (select, default `ogg`): Format
- `name` (string, required): File name (lowercase, no spaces)

## Pipeline

- Surface: `audio`; model capability: `music`.
- Postprocess: `audio-loop` (500 ms crossfade) → `audio-convert`.
- Checks: `duration-range`.
- Output: `{{engine.audioRoot}}/music/{{name}}` (written only when you adopt a candidate).

## CLI

```bash
pixo recipe run openpixo/music --input prompt="calm acoustic guitar for a cozy village" --input name=village_morning --wait --json
```
