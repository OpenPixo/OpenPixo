# NPC voice line

Text-to-speech takes of one dialogue line in a chosen voice, trimmed and loudness-normalized. Script a whole cast by running it once per line.

Two or more takes of one line, with leading and trailing silence trimmed and loudness normalized to the chosen target.

## Inputs

- `line` (text, required): Line to speak (spoken verbatim)
- `voice` (string, required): Voice id (from your TTS provider)
- `language` (string): Language hint (optional)
- `lufs` (select, default `-18`): Loudness target (LUFS)
- `format` (select, default `ogg`): Format
- `name` (string, required): File name (lowercase, no spaces)

## Pipeline

- Surface: `audio`; model capability: `tts`.
- Postprocess: `audio-trim` → `audio-normalize` → `audio-convert`.
- Checks: `loudness-range`.
- Output: `{{engine.audioRoot}}/voice/{{name}}` (written only when you adopt a candidate).

## Notes

- The prompt is the line itself: TTS speaks every word it is given, so put acting direction in the voice choice, not in the text.
- Voice ids are provider-specific. List voices in Settings or with your provider before running.
- Batch a script from the CLI, one run per line (CSV with `name,line` columns): `while IFS=, read -r name line; do pixo recipe run openpixo/npc-voice-lines --input "name=$name" --input "line=$line" --input voice=<id> --json --wait; done < lines.csv`. Review and adopt each run's best take.
- Use one loudness target for all dialogue in the game.

## CLI

```bash
pixo recipe run openpixo/npc-voice-lines --input "line=Halt! The bridge is closed after dark." --input voice=<voice-id> --input name=guard_bridge_01 --json --wait
pixo recipe adopt <runId> --candidate <candidateId>
```

Inspect the candidates before adopting; checks flag obvious failures but do not judge whether the asset looks right.
