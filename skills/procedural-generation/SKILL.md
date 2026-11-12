---
name: procedural-generation
en_name: Seeded procedural game generation
zh_name: 带种子的游戏程序生成
description: Build or debug seeded rooms, dungeons or noise terrain with bounded generation and traversal validation; not for hand-authored level art.
en_description: Build reproducible game maps and validate seeds, connectivity and traversal; not a workflow for hand-authored level art.
zh_description: 构建或修复带种子的房间、地牢与噪声地形，验证有界生成、连通性和通行规则；不用于手工关卡美术。
triggers:
  - procedural dungeon
  - seeded generation
  - noise terrain
  - validate generated map
  - 程序生成地牢
  - 带种子随机
  - 噪声地形
license: Apache-2.0
pixo:
  mode: utility
  category: game-development
---

# Seeded procedural game generation

Build or debug reproducible rooms, dungeons or terrain in Godot 4, Unity 6 or Phaser 3.
Project conventions, installed versions, architecture and explicit user choices take precedence.
Reuse the current generator and traversal rules; a seed bug does not require replacing the algorithm or creating a new game.

## Quick path

1. Identify map data, traversal rules, RNG owner and the failing or requested seed.
2. Pick a topology below; generate data before creating scene objects.
3. Validate clearance at spawn and goal. Check reachability against actual traversal.
4. Bound retries and record seed, generator version and parameters for failures.
5. Replay known seeds plus a bounded sweep using the project's existing check runner.
6. Run `pixo game verify --steps check,build --json`, inspect logs and skipped steps, then play representative accepted maps with `pixo game run <projectId> --json`, or in the Editor on Unity.

Commands assume `PIXO_PROJECT_ID`; otherwise add `--project <id>`.

## Choose topology and validation

| Need | Start with | Validate |
| --- | --- | --- |
| Small connected dungeon | Room chain or spanning tree, optional loops | Floor reachability, spawn clearance, minimum route length |
| Terrain islands or caves | Seeded noise, threshold, component selection or repair | Walkable component and reachable usable spawn and exit |
| Keys and locked doors | Topology plus progression placements | Search `(cell, acquired_keys)`; plain flood fill can approve a key behind its own door |
| Platformer | Movement-aware jump and drop graph | Controller reach, headroom, landing size and one-way rules |
| Streamed chunks | Stable seed derivation for the world and its chunks | Border agreement, world coordinates and load-order independence |

Keep generation → validation → rendering separate so rejected maps do not leave nodes or colliders behind.

## Godot 4: a bounded connected starting point

This data-only `extends RefCounted` example carves six rooms in a 48 × 32 grid.
Overlaps are allowed; an L corridor connects successive centers without placement retries.

```gdscript
func make_floor(seed_value: int) -> Dictionary:
    var rng := RandomNumberGenerator.new()
    rng.seed = seed_value
    var floor_cells: Dictionary = {}
    var centers: Array[Vector2i] = []
    for room_index in range(6):
        var w := rng.randi_range(5, 9)
        var h := rng.randi_range(4, 7)
        var left := rng.randi_range(1, 48 - w - 1)
        var top := rng.randi_range(1, 32 - h - 1)
        for y in range(top, top + h):
            for x in range(left, left + w):
                floor_cells[Vector2i(x, y)] = true
        var center := Vector2i(left + floori(w / 2.0), top + floori(h / 2.0))
        if not centers.is_empty():
            var cursor: Vector2i = centers[-1]
            while cursor.x != center.x:
                floor_cells[cursor] = true
                cursor.x += 1 if center.x > cursor.x else -1
            while cursor.y != center.y:
                floor_cells[cursor] = true
                cursor.y += 1 if center.y > cursor.y else -1
            floor_cells[center] = true
        centers.append(center)
    return {"floor": floor_cells, "spawn": centers[0], "exit": centers[-1]}
```

Room overlap can place exit near or on the spawn. Require a minimum shortest-path distance or choose a farthest reachable exit.
Plain Dictionary works in Godot 4.3; typed Dictionary syntax needs a supporting newer minor.

Four-neighbor top-down reachability:

```gdscript
func reachable(floor_cells: Dictionary, start: Vector2i) -> Dictionary:
    if not floor_cells.has(start):
        return {}
    var seen: Dictionary = {}
    seen[start] = true
    var queue: Array[Vector2i] = [start]
    var head: int = 0
    while head < queue.size():
        var cell: Vector2i = queue[head]
        head += 1
        for direction in [Vector2i.LEFT, Vector2i.RIGHT, Vector2i.UP, Vector2i.DOWN]:
            var next: Vector2i = cell + direction
            if floor_cells.has(next) and not seen.has(next):
                seen[next] = true
                queue.append(next)
    return seen
```

Assert that spawn and exit are floor cells, that the exit is reachable, and that all intended walkable cells are in the component.
Check bounds, distinct nonblocking placements and clearance using the player's real footprint.
Render accepted cells through the project's TileMap or TileMapLayer; TileMapLayer requires Godot 4.3+.
Keep atlas IDs in the renderer, not the generator.

## Phaser 3 and noise anchors

```ts
const layoutRng = new Phaser.Math.RandomDataGenerator([String(seed)]);
const roomWidth = layoutRng.integerInRange(5, 9);
// Generation owns this stream; cosmetic effects use another.
```

Keep plain grid or graph data and the same reachability checks outside Scene creation.
Phaser does not imply a built-in terrain-noise library; reuse the installed, pinned implementation.
Godot's `FastNoiseLite` uses explicit `seed`, `frequency` and noise type; sample world coordinates across chunks.
Thresholds change density, not solvability. Repair or reject disconnected components before placing gameplay entities.

## Unity 6 anchors

Keep the generator in a plain C# class with no MonoBehaviour, so an EditMode test can sweep seeds without a scene. The Godot rooms above port directly, with this reachability check:

```csharp
using System.Collections.Generic;
using UnityEngine;

public static class MapChecks
{
    private static readonly Vector2Int[] Steps = { Vector2Int.left, Vector2Int.right, Vector2Int.up, Vector2Int.down };

    public static HashSet<Vector2Int> Reachable(HashSet<Vector2Int> floor, Vector2Int start)
    {
        var seen = new HashSet<Vector2Int>();
        if (!floor.Contains(start)) return seen;
        var queue = new Queue<Vector2Int>();
        seen.Add(start);
        queue.Enqueue(start);
        while (queue.Count > 0)
        {
            var cell = queue.Dequeue();
            foreach (var step in Steps)
            {
                var next = cell + step;
                if (floor.Contains(next) && seen.Add(next)) queue.Enqueue(next);
            }
        }
        return seen;
    }
}
```

- Seed an owned `new System.Random(seed)` per stream. `UnityEngine.Random` is one global stream that any package or effect can advance. `Unity.Mathematics.Random` rejects a seed of 0, so derive a nonzero value. If old saves must regenerate the same world across engine upgrades, pin your own generator or bake the map.
- `Mathf.PerlinNoise` takes no seed, so add a seed-derived offset to the coordinates. It returns the same value at every integer coordinate, so multiply by a non-integer frequency first. Values can fall slightly outside 0–1, so clamp before thresholding. Very large offsets lose float precision.
- `HashSet` and `Dictionary` order is not a contract. Sort before any step that consumes random draws per element, or the same seed can diverge.
- Render accepted data with `Tilemap.SetTiles` in one batch. With a CompositeCollider2D, set Generation Type to Manual and call `GenerateGeometry()` once after placing tiles. `Destroy` waits for end of frame, so a retried map still sees the old objects unless they are disabled first.
- Pure data generation can run on `Awaitable.BackgroundThreadAsync()` to avoid a hitch. Tilemaps and other Unity objects stay on the main thread.

## Determinism and failure policy

- Record the seed, generator version and tuning inputs. Same seed is only meaningful with the same algorithm and configuration.
- Give layout, loot and cosmetics separate streams when changes in one must not perturb another.
- Preserve stable iteration order where it affects draws; compare sorted cell keys when comparing layouts.
- Bound candidate attempts by count or time; return a known-valid fallback or explicit failure after the cap.
- Validate fallback maps too, including spawn and exit clearance.
- Preserve generator version or baked map data when loading old saves must reproduce the original world.
- Use a fixed corpus (for example 0, 1, 42, 999 plus past failures) and a sweep sized to map cost; report coverage.

## Pitfalls: wrong → right

| Wrong | Right, and why |
| --- | --- |
| Global RNG for layout and particles | Isolate layout RNG so a cosmetic change cannot change rooms |
| Endless retries until a map looks right | Bound retries and retain the failing seed and reason |
| Same seed means identical maps in Godot, Unity and Phaser | RNG implementations differ; pin or share the actual algorithm when cross-engine parity is required |
| Connected tile centers mean playable | Test real collision footprint and controller traversal |
| Use `playtest --seed` as the world seed | That flag seeds preset input only; configure the game's generation seed separately |

## Done when

- [ ] The same seed, version and configuration produce the same map data; previously failing seeds are covered.
- [ ] Connectivity, clearance, progression, retry and fallback invariants pass for the recorded corpus.
- [ ] Representative accepted maps are playable through the real controller, not just a grid validator.
- [ ] Inspect `pixo game verify --steps check,build --json` logs; skipped check and build steps are stated.
- [ ] For browser input stress, discover `pixo game playtest --list-presets --json`, then optionally run `pixo game playtest --preset monkey --seed 42 --json`; report input coverage separately from map-seed coverage.
