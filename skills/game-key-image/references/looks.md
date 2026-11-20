# Looks

Each row maps a look to its installed style (its prompt and palette are in the system prompt's style list), the genres it suits, how its world is usually built, its UI frame language and what makes it read as a game. A palette the user set is the requirement; a row's palette is a starting point.

## Choosing

1. The user named a look: take that row.
2. The user named a game: decide which era of it they mean, then the row closest to that screen. When a series looks different across eras, or a genre is often played in two cameras, the candidates differ by era or camera, or the art form asks, each option described as a screen.
3. The user attached a picture: read it into a custom row (colour as a player sees it, material and light, outline, UI motif, detail, camera).
4. Only a genre: the look most players picture for it, plus Game setup's style.

A named game or look word gives the rendering in plain words; the title never goes into a prompt. Reason the way these examples do:

| The user says | What a fan names first |
| --- | --- |
| a Hades-like | an isometric camera; hand-painted 2D with heavy dark ink contours, saturated reds, oranges and teals, strong rim light and glowing effects on dark stone |
| 水墨, ink wash | diluted ink washes, dry-brush edges, rice-paper tone, a few accents (cinnabar, jade); buildings named by culture (tiled-roof gates, pavilions) |
| 复古, retro (3D) | late-1990s console 3D: low-poly, small unfiltered textures, dithering, short fog; other candidates stay retro too |

## Rows

| Look | Style id | Suits | Usually built as | UI frame language | Reads as a game when |
| --- | --- | --- | --- | --- | --- |
| 16-bit pixel | `pixel-16-bit` | RPG, roguelike, platformer, farming | tile map | pixel-bordered panels, 1 px outline and highlight, chunky pixel font | one pixel size everywhere, tiles join seamlessly, small sprites |
| 8-bit pixel | `pixel-8-bit` | arcade, platformer, puzzle | tile map | flat black or blue boxes, light 1 px border, blocky font | few colours per sprite, flat tiles, few objects |
| Isometric pixel | `isometric-pixel` | tactics, builder, management | tile map (diamond grid) | stepped diagonal frames, small pixel icons | everything on one 2:1 diamond grid |
| HD-2D diorama | `sprite-diorama` | JRPG, adventure | sprites in a 3D scene | thin gold or silver frames on dark translucent panels | crisp pixel sprites in a lit 3D stage, blur only at the top and bottom |
| Flat vector | `flat-vector` | puzzle, casual, management | tile map or UI screen | solid rounded rectangles, one darker shade | shapes repeat exactly, a limited palette |
| Clean cel / anime | `cel-anime` | action RPG, gacha RPG, visual novel | painted layers, or rooms for dialogue and battle | white or navy panels with cut corners | clean ink lines at one weight |
| Chibi cute | `chibi-cute` | life sim, party, collecting | tile map | thick rounded panels, bubbly buttons | 2–3-head characters, soft one-step shadows |
| Cozy pastel | `cozy-pastel` | farming, life sim, crafting | tile map | wooden signboards, cream paper panels | calm ground, tidy repeated crops, fences and paths |
| Hand-painted fantasy | `painted-fantasy` | action RPG, card battler, adventure | painted layers, or rooms for battle stages | carved wood, iron or stone frames | painted texture with light from one side |
| Watercolor storybook | `watercolor-storybook` | narrative, puzzle, gentle adventure | painted layers or rooms | torn-paper and ink-line frames | soft washes, clear silhouettes and floors |
| Paper cutout | `painted-cutout` | side-view adventure | painted layers | paper cards with a cut edge | flat parts at a few depths, like a stage set |
| Dark gothic | `dark-gothic` | soulslike, roguelike, horror, deckbuilder | painted layers, or rooms | weathered stone and iron, bone-white text | dark scene, readable silhouettes, detail at a focal area |
| Ink and woodcut | `ink-woodcut` | wuxia, folklore, strategy | painted layers or rooms | rough ink borders, red seals | carved strokes at one weight, warm paper tone |
| Ink wash | none installed: write the DNA from the example above | wuxia, xianxia, folklore | painted layers | ink-stroke frames, red seals | soft washes, clear floors and silhouettes |
| Horde top-down | `horde-topdown` | survivors-like, arena | tile map | simple dark bars, bright icons | units pop against a muted ground |
| CRT card table | `crt-card-table` | card roguelite | UI screen | chunky low-res cards | cards and table share one scanline and glow |
| Vaporwave CRT | `vaporwave-crt` | arcade, racing, rhythm | painted layers or 3D kit | neon outline frames on dark violet | geometric shapes, glow, faint scanlines |
| Toon 3D | `toon-3d` | 3D adventure, platformer, kart | 3D kit | rounded plastic-like buttons | smooth models with soft shading, gloss, contact shadows, a receding floor; thin or no outlines |
| Low-poly 3D | `low-poly-3d` | 3D exploration, survival | 3D kit | flat matte panels | visible facets, matte colour |
| Retro 32-bit 3D | `retro-low-poly` | horror, retro adventure | 3D kit | blocky low-res frames, bitmap font | low resolution, blocky textures, short fog |
| Voxel | `voxel-3d` | builder, survival, puzzle | 3D kit | blocky square panels | one cube size everywhere |

The UI frame language is for menus, dialogue, inventories and toolbars; the in-play HUD uses only the look's outline, glow and type.

## Families and contrast

| Family | Looks |
| --- | --- |
| Pixel | 16-bit, 8-bit, isometric pixel, HD-2D, CRT card table |
| Clean cartoon | flat vector, clean cel, chibi, cozy pastel, horde top-down, vaporwave |
| Painted | hand-painted fantasy, watercolor, paper cutout, dark gothic, ink and woodcut, ink wash |
| 3D | toon, low-poly, retro 32-bit, voxel |

When the user's words leave the look open, candidates from different families show real alternatives. Two rules hold whatever the family:

- **Flat vector:** a candidate only when the user asks for flat or minimal or Game setup's style is flat; as a contrast it renders as a prototype.
- **Tile maps:** pixel or painted tiles; clean cel and flat vector make a tile world look like stickers.

A look that usually builds another way says so in its World line: the look decides the rendering, the build method decides how the world is put together. At most one secondary look adds its palette or motifs, and the DNA says which comes from which.
