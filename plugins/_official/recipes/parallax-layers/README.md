# Parallax background layer

One horizontally tileable layer (far, mid or near) of a side-scrolling parallax background, with everything above the scenery transparent.

One transparent 16:9 layer. Run it three times (far, mid, near) with the same scene and style for a full set; draw the sky as a gradient behind them.

## Inputs

- `scene` (string, required): Scene
- `layer` (select, default `far`): Layer
- `style` (select, default `pixel art`): Art style
- `name` (string, required): File name (lowercase, no spaces)

## Pipeline

- Surface: `image`; model capability: `t2i`.
- Postprocess: `remove-bg`.
- Checks: `has-alpha`.
- Output: `{{engine.textureRoot}}/parallax/{{name}}/{{name}}_{{layer}}` (written only when you adopt a candidate).

## Notes

- Godot: `ParallaxBackground` with one `ParallaxLayer` per image, `motion_scale` around 0.2 / 0.5 / 0.8 and `motion_mirroring.x` set to the texture width. Phaser: one `tileSprite` per layer, scrolling `tilePositionX` at different rates.
- Check the left and right edges line up before adopting; the model is asked for it but does not always deliver.

## CLI

```bash
pixo recipe run openpixo/parallax-layers --input "scene=misty pine forest at dusk" --input layer=mid --input name=forest --json --wait
pixo recipe adopt <runId> --candidate <candidateId>
```

Inspect the candidates before adopting; checks flag obvious failures but do not judge whether the asset looks right.
