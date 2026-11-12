---
name: pixel-art-consistency
en_name: Pixel art consistency
zh_name: 像素美术一致性
description: Align selected existing pixel-art sprites to an approved palette, native grid, canvas and outline; not for generating replacements or choosing a new art style.
zh_description: 按已认可的调色板、原生网格、画布与描边规则统一选定的已有像素精灵；不用于生成替代素材或选择新画风。
triggers:
  - consistent pixel art
  - pixel sprite palette
  - pixel grid
  - 像素美术一致性
  - 统一像素精灵调色板
license: Apache-2.0
pixo:
  mode: utility
  category: game-assets
---

# Pixel art consistency

Align selected existing sprites only when the project uses or explicitly requests pixel art.
Project art conventions, engine version, architecture and explicit user choices take precedence.
Use an existing palette and grid contract; for a small edit, state the relevant rule in the handoff rather than requiring a new style document.
Generation or a new art direction is a separate task.

## Quick path

1. Inspect one approved reference and the selected input: `pixo asset info <path> --json`; inspect `pixo asset provenance <path> --json` when origin matters.
2. Confirm native canvas, visible baseline, palette and intended display scale before changing pixels.
3. Choose the smallest correction from the table and produce derivatives, preserving originals.
4. Review native-size and integer-zoom previews over light, dark and gameplay backgrounds.
5. After wiring reviewed files, run `pixo game verify --steps check,build,run --screenshot --json`; inspect the actual screenshot and step results.

Commands assume `PIXO_PROJECT_ID`; otherwise add `--project <id>`.
All paths below are project-relative examples; use the real output paths in each JSON report.
On Unity, `run` and `--screenshot` are skipped: use `--steps check,build` and review in the Game view at the target resolution.

## Choose a correction

| Defect or request | Choose | Limits to check |
| --- | --- | --- |
| Palette differs, grid already correct | `pixelate --size <input-longest-side> --palette <file> --dither none` | Remaps RGB; alpha values remain |
| Need a palette proposal | `palette --colors 16` | Extracted colors need approval; extraction is not the style contract |
| Enlarge native pixels | `resize --scale 2 --filter nearest` | Integer scale preserves clusters; display scaling is separate |
| Sheet needs per-cell editing | `slice --cell 32x32` | Confirm margin, spacing and expected count |
| Ragged outline or partial-alpha fringe | Existing pixel editor or focused local processing | No built-in outline-repair or alpha-threshold flag |
| Feet or pivots jump between frames | Restore shared canvas and baseline or retained offsets | Independent trim does not establish an anchor |

Useful contract fields, only where needed:

| Field | Example |
| --- | --- |
| Canvas and grid | Player 32 × 32, tiles 16 × 16; one drawn pixel per native pixel |
| Palette and alpha | Approved `art/palette.hex`, six-digit RGB entries; opaque or transparent unless style allows partial alpha |
| Outline | One native pixel; deliberate outline color and contour rule |
| Alignment | Feet at y=29 on every frame; same pivot and canvas |
| Display | Integer enlargement, nearest filtering; mipmaps disabled where inappropriate |

Different asset families may deliberately have different palettes or outlines.

## Deterministic commands

For a native 32 × 32 frame, palette-only remapping keeps its spatial resolution:

```sh
pixo asset pixelate sprites/hero_idle.png --size 32 --palette art/palette.hex --dither none --out derived/hero-palette --dry-run --json
pixo asset pixelate sprites/hero_idle.png --size 32 --palette art/palette.hex --dither none --out derived/hero-palette --json
pixo asset resize sprites/hero_idle.png --scale 2 --filter nearest --out derived/hero-2x --json
pixo asset slice public/assets/player.png --cell 32x32 --out derived/player-frames --json
```

- `--size` is the longest side of an intermediate image, enlarged back to original dimensions.
- On a 192 × 32 sheet, `--size 32` shrinks the entire sheet. Slice first or use its actual longest side for palette-only work.
- `pixo asset palette <image> --colors 16 --json` extracts GPL and HEX without applying them by default.
- `--dither ordered` is an art choice; `none` is usually clearer for small characters.
- `trim --padding` crops bounds and adds equal border padding; it cannot align feet to a shared canvas.
- Read failures, outputs and `originalsPreserved`; existing output files are skipped, so choose a fresh destination for a revised pass.

## Engine anchors

**Godot 4**

- Sprite2D and AnimatedSprite2D inherit CanvasItem's `texture_filter`; use `CanvasItem.TEXTURE_FILTER_NEAREST` or the established project default.
- Inspect import mipmaps and compression on the selected textures. Reimport through the editor or `pixo game verify --steps check --json`.
- Preserve source files and project-owned `.import` sidecars; regenerate caches in `.godot/` through Godot.
- For an editor or source audit, `Image.load_from_file(path)` reads source pixels; handle load failure.
- In an exported game, use the imported Texture2D's `get_image()` when CPU pixel access is needed; source files may not be present.
- If that Image is compressed, check `is_compressed()` and the result of `decompress()` before reading pixels.
- A size and palette checker can count off-palette and partial-alpha pixels, but cannot certify intentional silhouettes or outline quality.

**Phaser 3**

```ts
// Merge into the existing Game config only when this is the chosen art style:
const renderOptions = { pixelArt: true, roundPixels: true };
// After loading, for an individual texture:
this.textures.get('player').setFilter(Phaser.Textures.FilterMode.NEAREST);
```

`FIT` can still yield a fractional CSS display scale. Inspect target viewports or use the project's integer-scale presentation.
Vite public assets load without the `public/` URL prefix. Keep gameplay hitboxes in their existing units when swapping art.

**Unity 6**

Pixel art needs specific import settings; the defaults blur and recolor it. To enforce them on one folder, this Editor-only postprocessor runs on every import in that folder:

```csharp
using UnityEditor;
using UnityEngine;

public sealed class PixelArtImport : AssetPostprocessor
{
    private void OnPreprocessTexture()
    {
        if (!assetPath.StartsWith("Assets/Art/Pixel/")) return;
        var importer = (TextureImporter)assetImporter;
        importer.filterMode = FilterMode.Point;
        importer.textureCompression = TextureImporterCompression.Uncompressed;
        importer.mipmapEnabled = false;
        importer.spritePixelsPerUnit = 16; // The family's agreed value.
    }
}
```

- Default compression changes exact colors, so a palette check on the source can pass while the game shows something else. Check Platform Overrides too, because Android and iOS tabs can override the default tab.
- Keep Pixels Per Unit the same across a family, or characters end up different sizes on screen. Keep the sprite's Mesh Type Full Rect when frames share a canvas.
- Use the Pixel Perfect Camera (URP's, or `com.unity.2d.pixel-perfect` on Built-in), with the Assets Pixels Per Unit and reference resolution set. A fractional Game view scale still shows uneven pixels, so review at integer multiples. Its Crop Frame and Grid Snapping settings change what the player sees, so change them only when the task asks.
- Sprite Atlas: Point filter, padding of 2 or more, Tight Packing and Allow Rotation off. Too little padding causes bleed lines.
- Reads through `Texture2D.GetPixels32()` need Read/Write enabled. Use `pixo asset` on the source file for audits instead of changing import settings.
- Keep each `.meta` when replacing a PNG, so pivots and slices survive. A sheet with changed dimensions still needs reslicing.

## Pitfalls: wrong → right

| Wrong | Right, and why |
| --- | --- |
| Palette remapping fixes partial alpha | Check and repair alpha separately; pixelate preserves it |
| Force one palette on every family | Use the approved family rules; environment colors may differ |
| Resize with both width and height blindly | Preserve aspect ratio; unequal dimensions stretch clusters |
| Trim every animation frame independently | Keep canvases or preserve offsets so pivots remain stable |
| Treat nearest sampling as a complete fix | Also inspect source grid, display scale, camera rounding and atlas bleed |

## Done when

- [ ] Selected derivatives match agreed palette, canvas, alpha and baseline rules without unrequested art changes.
- [ ] Native-size, integer-zoom and in-game reviews include animation transitions and actual backgrounds.
- [ ] Output paths and preservation results are checked; unresolved visual defects are named.
- [ ] Use `pixo game run <projectId> --json`, or the Editor on Unity, if motion or alignment needs interaction; a build alone cannot establish art consistency.
- [ ] After integration, inspect `pixo game verify --steps check,build,run --screenshot --json`; identify skipped checks and visually review the screenshot.
