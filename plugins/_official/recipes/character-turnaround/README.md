# Character turnaround

Front, side and back views of one character at identical scale on a transparent background, ready to use as character-card reference images.

One image with the character shown from several angles at the same scale, keyed to transparency and trimmed.

## Inputs

- `character` (character-ref, required): Character
- `views` (select, default `front, side and back`): Views
- `style` (select, default `match the reference images`): Art style

## Pipeline

- Surface: `image`; model capability: `t2i`, `i2i`.
- Postprocess: `remove-bg` → `trim`.
- Checks: `has-alpha`.
- Output: `{{engine.spriteRoot}}/{{character.slug}}/reference/{{character.slug}}_turnaround` (written only when you adopt a candidate).

## Notes

- Run this first for a new character, adopt the best candidate, then add the adopted file to the character card's `references` so `sprite-walk-8dir` and other character recipes stay on-model.
- The views are not sliced. Crop individual views with `pixo asset slice --grid 3x1` (or `4x1`) if you need them separately.
- Chroma keying removes #FF00FF. If the character really needs magenta, edit the card description to use another color or remove the background manually.

## CLI

```bash
pixo recipe run openpixo/character-turnaround --input character=fox-hero --json --wait
pixo recipe adopt <runId> --candidate <candidateId>
```

Inspect the candidates before adopting; checks flag obvious failures but do not judge whether the asset looks right.
