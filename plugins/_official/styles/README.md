# Bundled art styles

Language: English | [简体中文](README.zh-CN.md)

These 20 original Apache-2.0 art styles are data-only plugin bundles. Each folder
contains a `pixo.json` manifest with a positive style fragment, negative fragment,
palette, optional constraints and localized example prompts. They contain no
runnable skill. The official Store registry points at the same folders.

The default resolution recommendation is 1024 × 1024. Pixel-art examples also
name a logical sprite size: generate the art, then verify and export that native
size with nearest-neighbor scaling. Background remains the responsibility of
the generation request or recipe so transparent sprites and chroma-key sheets
keep their own output contract. The 3D presets describe rendered asset
concepts; an image preview is not a mesh.

## Families

The plugin manifest has no variant field, so a family is a set of sibling
styles whose titles share a prefix and therefore sort together.

| Family | Style ids |
| --- | --- |
| Retro pixel | `pixel-16-bit` (default), `pixel-8-bit` (four colors per sprite; its examples include a strict two-tone 1-bit mode), `isometric-pixel` |
| Pixel in 3D | `sprite-diorama` |
| 2D illustration | `painted-fantasy`, `painted-cutout`, `cel-anime`, `chibi-cute`, `cozy-pastel`, `flat-vector`, `ink-woodcut`, `watercolor-storybook`, `dark-gothic` |
| Genre readability | `horde-topdown`, `crt-card-table`, `vaporwave-crt` |
| 3D | `low-poly-3d`, `retro-low-poly`, `toon-3d`, `voxel-3d` |

`sprite-diorama`, `horde-topdown` and `crt-card-table` deliberately avoid the
`pixel` medium token: the recipe postprocess treats a pixel medium as a request
to pixelate and palette-quantize, which would flatten their bloom, depth of
field and screen glow.

The former `monochrome-1-bit` style was folded into `pixel-8-bit`. A project
that still names it keeps the id in its metadata and resolves to no style until
the user picks another one.

## Covers

Every style ships `previews/cover.webp`, registered as
`"previews": ["previews/cover.webp"]`. `previews/PROMPT.md` beside each cover
records the generation prompt and export notes. Cover rules:

- WebP, opaque sRGB, 1200 × 900 pixels, landscape 4:3.
- Show one original game-art subject with enough surrounding space for a
  thumbnail crop. Keep the focal subject within the middle 80% of the image.
- Follow that manifest's palette, positive fragment and negative fragment.
  Keep backgrounds appropriate to the sample; avoid baked-in titles, captions,
  logos, watermarks, third-party characters or artist imitations.
- For pixel styles, preserve a single logical pixel grid and enlarge with
  nearest-neighbor sampling. Do not blur pixel edges to reach the cover size.
- An optional second sample is `previews/detail.webp`, also 1200 × 900, 4:3.
  Add it as the second `previews` entry. Paths are relative to the style
  folder; the first image is the gallery cover.

Do not register a file before it exists.

| Style id | Cover file |
| --- | --- |
| `pixel-16-bit` | `pixel-16-bit/previews/cover.webp` |
| `pixel-8-bit` | `pixel-8-bit/previews/cover.webp` |
| `isometric-pixel` | `isometric-pixel/previews/cover.webp` |
| `sprite-diorama` | `sprite-diorama/previews/cover.webp` |
| `painted-fantasy` | `painted-fantasy/previews/cover.webp` |
| `painted-cutout` | `painted-cutout/previews/cover.webp` |
| `cel-anime` | `cel-anime/previews/cover.webp` |
| `chibi-cute` | `chibi-cute/previews/cover.webp` |
| `cozy-pastel` | `cozy-pastel/previews/cover.webp` |
| `flat-vector` | `flat-vector/previews/cover.webp` |
| `ink-woodcut` | `ink-woodcut/previews/cover.webp` |
| `watercolor-storybook` | `watercolor-storybook/previews/cover.webp` |
| `dark-gothic` | `dark-gothic/previews/cover.webp` |
| `horde-topdown` | `horde-topdown/previews/cover.webp` |
| `crt-card-table` | `crt-card-table/previews/cover.webp` |
| `vaporwave-crt` | `vaporwave-crt/previews/cover.webp` |
| `low-poly-3d` | `low-poly-3d/previews/cover.webp` |
| `retro-low-poly` | `retro-low-poly/previews/cover.webp` |
| `toon-3d` | `toon-3d/previews/cover.webp` |
| `voxel-3d` | `voxel-3d/previews/cover.webp` |

The complete cover path is this directory plus the file listed above.
No model or provider call is needed to register the manifests or test the
gallery.
