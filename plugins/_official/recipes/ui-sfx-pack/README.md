# UI sound effect

Variations of one short UI sound (click, confirm, error, pickup), trimmed, loudness-normalized and converted for the engine. Run once per sound to build a pack.

Several variations of one UI sound, silence-trimmed, normalized to the chosen loudness and converted to OGG or WAV.

## Inputs

- `sound` (select, default `button click`): Sound
- `timbre` (string, required): Sound character
- `lufs` (select, default `-16`): Loudness target (LUFS)
- `format` (select, default `ogg`): Format
- `name` (string, required): File name (lowercase, no spaces)

## Pipeline

- Surface: `audio`; model capability: `sfx`.
- Postprocess: `audio-trim` → `audio-normalize` → `audio-convert`.
- Checks: `loudness-range`, `duration-range`.
- Output: `{{engine.audioRoot}}/sfx/ui/{{name}}` (written only when you adopt a candidate).

## Notes

- The loudness target is an explicit input. Keep it the same for every sound in one pack so they sit together; -16 LUFS is a common starting point, but match whatever your game already uses.
- Integrated loudness is less reliable on very short clips; listen to the adopted sounds side by side.
- The prompt is kept short because ElevenLabs SFX prompts must stay under 450 characters.
- Adopt two or three variations of frequent sounds (click, hover) and pick one at random in code to avoid repetition.

## CLI

```bash
pixo recipe run openpixo/ui-sfx-pack --input sound=confirm --input "timbre=bright glassy chime" --input name=ui_confirm --json --wait
pixo recipe adopt <runId> --candidate <candidateId>
```

Inspect the candidates before adopting; checks flag obvious failures but do not judge whether the asset looks right.
