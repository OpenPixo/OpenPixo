---
name: level-design-tilemap
en_name: 2D level and tilemap design
zh_name: 2D 关卡与瓦片地图设计
description: "Build or revise a 2D level or tilemap with measured movement, readable routes and correct collisions in Godot, Unity, Phaser with Tiled or an existing LDtk pipeline. Not tile-art generation or a mandatory map-format conversion."
en_description: "Build or revise a 2D level or tilemap with measured movement, readable routes and correct collisions in Godot, Unity, Phaser with Tiled or an existing LDtk pipeline. Not tile-art generation or a mandatory map-format conversion."
zh_description: "在 Godot、Unity、搭配 Tiled 的 Phaser 或既有 LDtk 管线中构建或修改 2D 关卡或瓦片地图，量化移动、安排清晰路线并配置碰撞；不用于瓦片美术生成，也不强制转换地图格式。"
triggers:
  - design a tilemap level
  - Godot TileMap
  - Unity Tilemap
  - Tiled level
  - LDtk level
  - platformer difficulty ramp
  - 瓦片地图关卡
  - 关卡难度递进
license: Apache-2.0
pixo:
  mode: utility
  engines:
    - godot
    - unity
    - phaser
  category: game-development
---

# 2D level and tilemap design

The user's route and difficulty goals, project conventions, engine version and current map format take precedence. A few platform edits do not require Tiled, LDtk or a new map pipeline.

## Quick path

1. Inspect the affected controller's speed, jump, gravity and body. Check tile size, camera, spawn, goal and retry rules.
2. Change or sketch only the relevant route section: safe introduction, variation, challenge and recovery when designing a new stage.
3. Budget usable landings and lanes from measured movement; separate terrain collision, decoration and gameplay entities.
4. Play the section from its real spawn and retry; inspect camera edges and both travel directions.
5. Run `pixo game verify --steps check --json` for Godot, `--steps check,build` for Unity or `--steps build` for Phaser, then verify required routes in gameplay.

Add `--project <id>` when `PIXO_PROJECT_ID` is absent. `pixo game run <projectId> --json` starts supported interactive gameplay; on Unity, play the route in the Editor or a player build.

## Pick the existing map path

| Project state | Choose | Boundary |
| --- | --- | --- |
| Small hand-placed level | Edit positions or its level-data array | A new editor dependency may cost more than the change |
| Godot 4.3+ TileMapLayer | One node per layer using the existing TileSet | Older TileMap overloads include a layer index; do not mix signatures |
| Godot 4.0–4.2 TileMap | Its existing layer-index APIs | TileMapLayer is unavailable in these versions |
| Unity 2D Tilemap | One `Grid` with one `Tilemap` per layer, using the existing Tile Palette and Tile assets | Rule Tiles need `com.unity.2d.tilemap.extras` |
| Unity + Tiled or LDtk | The installed importer package | Unity reads neither format natively |
| Phaser 3 + Tiled | Existing support for finite or infinite maps and tilesets | Confirm loader support for the authored map features |
| LDtk | Installed importer and version, or a project-owned converter | Do not assume the engine natively reads arbitrary LDtk data |

## Movement budgets

For a same-height ballistic jump with upward speed magnitude `v`, constant positive gravity `g` and constant horizontal speed `s`:

- Rise ≈ `v² / (2g)`, airtime ≈ `2v / g`, ideal horizontal range ≈ `s * airtime`.
- Illustrative `v=460 px/s`, `g=1000 px/s²`, `s=220 px/s` gives ~106 px rise, 0.92 s and 202 px range. These are not asserted template settings.
- Acceleration, early release, ceilings, collider extents and human delay reduce usable reach. Measure in-game before trusting the ideal range.
- Required gaps need margin for launch and landing; optional rewards can take visible risks. Leave floor space to stop and recover before the next challenge.
- For top-down maps, measure body diameter, diagonal corner clearance, turning room, sightlines and retreat routes instead.
- Read camera bounds and look-ahead: a physically reachable landing can still be unfair if hidden.

## Godot 4.3: cell, local and world coordinates

Configure the existing TileSet's atlas and solid-tile physics polygons first. Decorative tiles need no collision. This fragment assumes a `Ground` TileMapLayer with inspected source ID 0 and solid atlas tile `(0, 0)`; substitute actual project data:

```gdscript
@onready var ground: TileMapLayer = $Ground
@onready var player: CharacterBody2D = $Player

func _ready() -> void:
	for x in range(32):
		ground.set_cell(Vector2i(x, 16), 0, Vector2i(0, 0))
	var spawn_cell: Vector2i = Vector2i(3, 14)
	player.global_position = ground.to_global(ground.map_to_local(spawn_cell))

func cell_at_world(world_position: Vector2) -> Vector2i:
	return ground.local_to_map(ground.to_local(world_position))
```

`map_to_local` returns the cell center in layer-local coordinates. Parent transforms make a direct cell-to-global assignment incorrect. See [TileMapLayer 4.3](https://docs.godotengine.org/en/4.3/classes/class_tilemaplayer.html).
- The actor's mask must include the TileSet physics layer's collision bits; a tileset physics-layer index is not itself that bitmask.
- Inspect visible collision shapes for holes and offsets. Art alone does not make a platform solid.
- `set_cells_terrain_connect` needs configured terrain sets and compatible neighboring tiles; it cannot invent missing transitions.
- Keep existing TileSet resources when only moving cells; preserve pixel-art filtering and stable gameplay entity IDs.

## Phaser 3: Tiled anchors

Preload the actual public or build-relative image and JSON paths:

```ts
this.load.image('terrain-image', 'maps/terrain.png');
this.load.tilemapTiledJSON('level-one', 'maps/level-one.json');
```

In the scene's `create`, after its existing player has been created:

```ts
const map = this.make.tilemap({ key: 'level-one' });
const tiles = map.addTilesetImage('terrain', 'terrain-image');
if (!tiles) throw new Error('Missing Tiled tileset: terrain');
const ground = map.createLayer('Ground', tiles, 0, 0);
if (!ground) throw new Error('Missing Tiled layer: Ground');
ground.setCollisionByProperty({ solid: true });
this.physics.add.collider(this.player, ground);
this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
```

The example assumes a finite orthogonal map with embedded tileset metadata. Tiled tileset name `terrain` differs from Phaser texture key `terrain-image`. Set a boolean `solid` tile property in Tiled. Read installed Phaser 3 types or [tagged 3.90 Tilemap source](https://github.com/phaserjs/phaser/blob/v3.90.0/src/tilemaps/Tilemap.js).
- Use object layers for spawn, goal and checkpoints. Tile objects and point objects have different anchors; test one known marker.
- Set physics world bounds and out-of-bounds loss according to the level, rather than automatically turning every map edge into a wall.
- Preserve the build's asset base path; an arbitrary leading slash can break a subfolder export.

## Unity 6: Tilemap coordinates and collision

Budgets above are in world units here, not pixels. Divide by Pixels Per Unit and use the real Rigidbody2D values. Cell Y increases upward, the opposite of Godot and Tiled.

This fragment assumes an existing `Ground` Tilemap, a Tile asset that has a collider type, and a player Rigidbody2D:

```csharp
using UnityEngine;
using UnityEngine.Tilemaps;

public sealed class RoomBuilder : MonoBehaviour
{
    [SerializeField] private Tilemap ground;
    [SerializeField] private TileBase solidTile;
    [SerializeField] private Rigidbody2D player;

    private void Start()
    {
        var cells = new Vector3Int[32];
        var tiles = new TileBase[32];
        for (var x = 0; x < cells.Length; x++)
        {
            cells[x] = new Vector3Int(x, -4, 0);
            tiles[x] = solidTile;
        }
        ground.SetTiles(cells, tiles); // One batched update, not 32 refreshes.
        player.position = ground.GetCellCenterWorld(new Vector3Int(3, -2, 0));
    }

    public Vector3Int CellAt(Vector3 world) => ground.WorldToCell(world);
}
```

`GetCellCenterWorld` applies the Grid and Tilemap transforms and the tile anchor; `CellToWorld` returns a corner.

- Collision takes three parts: a Tile asset whose Collider Type is not None, a `TilemapCollider2D`, and the actor's layer enabled in the Physics 2D collision matrix. Collider Type Sprite uses the sprite's physics shape, so check it in the Sprite Editor.
- For solid ground, add a `CompositeCollider2D` with a Static Rigidbody2D and set the tilemap collider's Composite Operation to Merge. Separate per-tile shapes catch capsules and boxes on their seams. Geometry Type Outlines leaves the interior hollow, so a fast body can end up inside; use Polygons for solid terrain.
- Grid Cell Size must equal tile pixels divided by Pixels Per Unit (16 px at 16 PPU is 1), or tiles show gaps or overlap.
- Thin lines between tiles usually mean texture bleed. Use Point filtering, a Sprite Atlas with padding, and pixel-perfect camera settings before editing the art.
- `cellBounds` keeps erased cells until `CompressBounds()`. Call it before looping over the bounds or sizing a camera limit.
- Spawn, goal and checkpoints are prefabs or transforms in the scene, kept off the terrain layer. Restrict the camera with the existing `CinemachineConfiner2D` or clamp, using a shape that matches the route.
- Decoration goes on its own Tilemap with no collider. Sort layers through `TilemapRenderer`; Chunk mode batches best, and Individual mode is for tiles that must sort against characters.
- Painted tiles are stored in the scene or prefab YAML, so large repaints make unreadable diffs. Keep level edits scoped, and do not reorder a Tile Palette to move cells.

## LDtk, only when in scope

Inspect the installed loader first. For conversion, retain the authored LDtk source and selected level. Preserve grid size, dimensions, layer offsets, level offsets and entity pivots; collision IntGrid and rendered auto-layer tiles are different data. Resolve external levels rather than silently dropping them. Validate one known tile and entity position against the editor before expanding conversion.

## Pitfalls: wrong → right

| Wrong | Right, and why |
| --- | --- |
| Treat cells as world pixels | Convert cell ↔ layer-local ↔ world explicitly |
| Assume tile art defines collision | Inspect polygons, properties and the actor's mask |
| Change jump strength to rescue every gap | Adjust the route within the intended controller's measured reach |
| Use flood-fill as proof of jump reachability | Test physical movement and camera visibility |
| Call a stage fair from one screenshot | Play required routes, retries, edges and optional detours |

## Done when

- [ ] Required routes reach the goal from spawn with intended controls; retries restore entities and checkpoints correctly.
- [ ] Collision and camera edges match the route. Doors and gaps provide the intended clearance; new assets import and load.
- [ ] Record changed map paths and observed behavior for challenges and recovery; screenshots support layout rather than proving reachability.
- [ ] Applicable verify command above passes. For web input smoke tests, discover `pixo game playtest --list-presets --json` before choosing `pixo game playtest --preset <id> --json`; Godot capture does not support injected input and Unity capture is unsupported.
