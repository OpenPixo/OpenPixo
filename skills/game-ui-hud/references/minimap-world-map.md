---
en_name: Minimap and world map
zh_name: 小地图与世界地图
---

# Minimap and world map

Part of the game-ui-hud skill; read its SKILL.md first. The game's style reference, the confirmed plan and the parent's look rules decide how the map looks. This file decides what a map shows, how it is drawn from game data and how the player reads it. Colours named below are roles (player, objective, danger, unexplored), filled from the game's palette.

## Decide first

| Question | Default |
| --- | --- |
| Does the game need a map at all? | Only if players get lost: levels larger than about three screens in both directions, backtracking, or objectives off screen. A linear level needs a progress bar, not a map |
| Minimap, full map or both? | Minimap for moment-to-moment direction; a full map (pause or a held key) for planning routes. Small games pick one |
| Rotate with the player? | North-up by default. Rotate only in vehicle or first-person games, and then show a north marker |
| Fog of war? | Only if exploring is part of the game. Otherwise show the whole level |
| What goes on it? | Player, current objective, exits or doors, and at most two or three more icon types |

You decide size, placement, scale and icon set. Ask first when the map adds a rule (fog that hides enemies, map pickups, fast travel) or the plan has no map and the level design would have to change for it.

## Readable at a glance

- **Placement.** A corner the genre expects, usually top-right, inside the safe margin. Size 15–20 % of the screen height. Never over the player's travel direction in an auto-scroller.
- **Simplify the world.** Draw walkable space and walls, not the tiles. Two or three tones from the palette: floor, wall, unexplored. Decorations never appear.
- **The player is the brightest thing on it**, with a direction wedge, always on top and always the same size.
- **Objectives clamp to the edge.** An off-map objective sits on the minimap's border as an arrow pointing at it, so direction is never lost.
- **Few icons, consistent shapes.** Shape carries the type (circle, diamond, door), colour carries state. Icons keep their screen size when the map zooms.
- **Scale that answers "how far".** A minimap shows about one to two screens around the player. Zooming out for speed is allowed; changing scale constantly is not.
- **Full map:** centred on the player when opened, with a legend for every icon used, the current objective named, and the same controls as other menus (pan with stick or arrows, Back closes).
- **Explored state is saved** with progress if fog exists; reopening the game must not reset it.

## Build it

Draw the map from level data (tile layers, collision shapes, room bounds), never by screenshotting the world camera at runtime unless the engine makes that cheap and the art already reads simplified.

- **Godot 4:** for a tile game, build a small `Image` once from the `TileMapLayer` (one pixel per cell: floor, wall), wrap it in an `ImageTexture` and show it in a `TextureRect` inside the HUD `CanvasLayer`. Icons are child `Control`s placed from world positions by `(world - origin) / cell_size * map_scale`. A `SubViewport` with a second `Camera2D` and a cull mask that renders only a map layer is the alternative when the map must show moving shapes.
- **Phaser 3:** a second camera with `setZoom`, `setBounds` and `ignore()` for decoration layers is the simplest live minimap; give the minimap camera a viewport rect in the corner. For a drawn map, render the walkable grid once to a `RenderTexture` and place icon images over it in the HUD scene.
- **Unity 6:** a second orthographic camera rendering only a Minimap layer into a `RenderTexture` shown by a `RawImage`. Put simple icon sprites on that layer above each tracked object so the world art stays off the map.
- **Web and Three.js:** draw a grid or room list to a small `<canvas>` in the HUD layer once, then redraw only icons each frame. For 3D, project positions onto the ground plane (x, z) and ignore height unless floors matter.

Clamp objectives to the border: take the vector from the player to the target in map space; if it falls outside the map rect, scale it to the rect edge and rotate an arrow to its angle.

## Verify in a playtest

After the parent's `pixo game verify` step, capture the map in three places: at spawn, far from spawn and with the objective off map. On web:

```json
[
  {"wait": 500},
  {"capture": "spawn"},
  {"key": "ArrowRight", "press": true, "holdMs": 3000},
  {"capture": "travelled"}
]
```

Check that the player marker moved the right amount and direction, the objective arrow points the right way, nothing decorative is drawn, and the map reads at the smallest target resolution. For a full map, check open, pan, legend and Back with keyboard and controller. Godot capture injects no input and Unity has no capture; play those by hand.

## Common mistakes

| Wrong | Right |
| --- | --- |
| A shrunken copy of the world art | Simplified walkable space in two or three palette tones |
| Objective disappears when off map | Clamped to the border as a pointing arrow |
| A dozen icon types | Player, objective, exits and at most a few more |
| Map icons scale with zoom until unreadable | Icons keep their screen size |
| Fog progress lost on reload | Explored cells saved with progress |
| A map added to a short linear level | A progress bar, or nothing |
