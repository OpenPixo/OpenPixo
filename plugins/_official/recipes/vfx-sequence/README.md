# VFX flipbook

A skill or impact effect as a flipbook sheet on black for additive blending, sliced into frames.

The sheet normalized to 960x960 plus one frame per cell, in playback order.

## Inputs

- `effect` (string, required): Effect
- `palette` (string, required): Colors
- `grid` (select, default `4x4`): Frames grid (columns x rows)
- `style` (select, default `hand-drawn anime`): Art style
- `name` (string, required): File name (lowercase, no spaces)

## Pipeline

- Surface: `image`; model capability: `t2i`.
- Postprocess: `resize` → `slice`.
- Checks: `grid-divisible`.
- Output: `{{engine.spriteRoot}}/vfx/{{name}}/{{name}}` (written only when you adopt a candidate).

## Notes

- The background stays black on purpose: glows and smoke key badly against a chroma color. Render the frames with additive blending so black disappears: Godot `CanvasItemMaterial.blend_mode = BLEND_MODE_ADD`, Phaser `sprite.setBlendMode(Phaser.BlendModes.ADD)`.
- Play the frames at 12 to 24 fps and hide the sprite on the last frame.

## CLI

```bash
pixo recipe run openpixo/vfx-sequence --input "effect=fireball impact explosion" --input "palette=orange and yellow" --input name=fireball_hit --json --wait
pixo recipe adopt <runId> --candidate <candidateId>
```

Inspect the candidates before adopting; checks flag obvious failures but do not judge whether the asset looks right.
