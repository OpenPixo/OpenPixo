# 8-direction walk sprite sheet

An 8-direction walk cycle on a strict grid, generated on a transparent background and sliced into per-frame PNGs.

The full sheet plus one PNG per frame, and an engine atlas with one walk animation per direction. The sheet is resized to 1024x1024, so each cell is 128x128.

## Inputs

- `character` (character-ref, required): Character
- `style` (select, default `pixel art, 32px character`): Art style
- `frames` (select, default `6`): Frames per direction

## Pipeline

- Surface: `image`; model capability: `t2i`, `i2i`.
- Background: requested transparent from the model. A model that cannot return alpha paints a key colour chosen away from the prompt's colours, and the host keys it out with a soft edge. (0.1.0 painted magenta and keyed it with a hard cutoff, which left a purple edge on every outline.)
- Postprocess: `resize` → `slice` → `export-spritesheet`.
- Checks: `has-alpha`, `grid-divisible`.
- Output: `{{engine.spriteRoot}}/{{character.slug}}/{{character.slug}}_walk` (written only when you adopt a candidate).

## Notes

- Row order is down, down-left, left, up-left, up, up-right, right, down-right. Frame order is left to right.
- Models do not always keep eight directions consistent. Inspect every row before adopting; a candidate with a wrong row fails in-game even when `grid-divisible` passes.
- Pack the frames into an engine atlas with `pixo asset pack --format godot-tres` or `--format texturepacker-json` (Phaser `load.atlas`).
- For crisp pixel art, run `pixo asset pixelate` on the adopted frames at the target sprite size.

## CLI

```bash
pixo recipe run openpixo/sprite-walk-8dir --input character=fox-hero --input frames=6 --json --wait
pixo recipe adopt <runId> --candidate <candidateId>
```

Inspect the candidates before adopting; checks flag obvious failures but do not judge whether the asset looks right.
