# Looping background music

An instrumental track written to loop, given a crossfaded loop point and converted for the engine. Needs a music provider.

One loop-ready track per candidate with a 500 ms crossfade at the loop point.

## Inputs

- `genre` (select, default `chiptune`): Genre
- `mood` (string, required): Mood and setting
- `bpm` (number, default `100`): Tempo (BPM)
- `lengthSec` (select, default `60`): Length (seconds)
- `format` (select, default `ogg`): Format
- `name` (string, required): File name (lowercase, no spaces)

## Pipeline

- Surface: `audio`; model capability: `music`.
- Postprocess: `audio-loop` → `audio-convert`.
- Checks: `duration-range`.
- Output: `{{engine.audioRoot}}/music/{{name}}` (written only when you adopt a candidate).

## Notes

- The music providers in OpenPixo's media catalogue (Suno, Udio, Lyria) are not integrated yet, so this recipe may report "no available model" until one is connected.
- Godot: enable `loop` on the imported OGG/WAV (Import dock) and play it from an `AudioStreamPlayer` on a Music bus. Phaser: `this.sound.add(key, { loop: true })`.
- Listen across the loop point at least twice before adopting.

## CLI

```bash
pixo recipe run openpixo/bgm-loop --input genre=chiptune --input "mood=tense dungeon crawl" --input bpm=120 --input name=dungeon_loop --json --wait
pixo recipe adopt <runId> --candidate <candidateId>
```

Inspect the candidates before adopting; checks flag obvious failures but do not judge whether the asset looks right.
