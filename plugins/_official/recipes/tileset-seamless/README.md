# Seamless tile texture

A tileable ground or wall texture (grass, stone, sand, floorboards) that wraps on all four edges, resized to tile size and checked for seams.

One square tile texture at the chosen size, with a seam score from `seamless-check`.

## Inputs

- `material` (string, required): Surface
- `view` (select, default `top-down`): View
- `style` (select, default `pixel art`): Art style
- `tileSize` (select, default `128`): Tile size (px)
- `name` (string, required): File name (lowercase, no spaces)

## Pipeline

- Surface: `image`; model capability: `t2i`.
- Postprocess: `resize` → `seamless-check`.
- Checks: `seamless`, `dimensions`.
- Output: `{{engine.textureRoot}}/tiles/{{name}}` (written only when you adopt a candidate).

## Notes

- Seamlessness is hit or miss across models, so the default asks for four candidates. Prefer candidates whose `seamless` check passes, and look at the tiled preview before adopting.
- This produces a fill texture, not an autotile set with edges and corners. Build transitions in your tile editor or generate them separately.
- Godot: use it as a TileSet atlas source or a `TextureRect` with `stretch_mode = tile`. Phaser: `this.add.tileSprite(...)`.

## CLI

```bash
pixo recipe run openpixo/tileset-seamless --input "material=mossy cobblestone" --input tileSize=64 --input name=cobble_a --json --wait
pixo recipe adopt <runId> --candidate <candidateId>
```

Inspect the candidates before adopting; checks flag obvious failures but do not judge whether the asset looks right.
