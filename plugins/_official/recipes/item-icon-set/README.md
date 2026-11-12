# Item icon set

A matching set of inventory icons generated on one sheet, sliced into single icons and resized to a fixed size.

One sheet keyed to transparency, sliced into one icon per cell and resized to the chosen square size.

## Inputs

- `items` (text, required): Items, in order (comma separated)
- `grid` (select, default `3x3`): Sheet grid (columns x rows)
- `style` (select, default `pixel art`): Art style
- `iconSize` (select, default `64`): Icon size (px)
- `setName` (string, required): Set name (folder, lowercase)

## Pipeline

- Surface: `image`; model capability: `t2i`.
- Postprocess: `remove-bg` → `resize` → `slice` → `resize`.
- Checks: `has-alpha`, `dimensions`.
- Output: `{{engine.uiRoot}}/icons/{{setName}}/{{setName}}` (written only when you adopt a candidate).

## Notes

- List exactly as many items as the grid has cells (4, 9 or 16). Slices are numbered in reading order, so item N in your list becomes slice N.
- Empty cells produce empty icons; delete them before adopting or ignore them.
- Lanczos resizing suits painted and vector icons. For pixel art at 32 px, adopt and then run `pixo asset pixelate` on the icons.

## CLI

```bash
pixo recipe run openpixo/item-icon-set --input "items=iron sword, wooden shield, red potion, brass key" --input grid=2x2 --input setName=starter --json --wait
pixo recipe adopt <runId> --candidate <candidateId>
```

Inspect the candidates before adopting; checks flag obvious failures but do not judge whether the asset looks right.
