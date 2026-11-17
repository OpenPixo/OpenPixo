---
en_name: Level layout and pacing
zh_name: 关卡布局与节奏
---

# Level layout and pacing

Part of the level-design-tilemap skill; read its SKILL.md first, including "Movement budgets", which every number here depends on. The game's style reference and the confirmed plan decide the tiles, props and colours. This file decides the route: what the player meets, in what order, and how they know where to go.

## Decide first

Write a beat sheet before placing tiles: one line per section, with its purpose and the one new thing in it.

| Section | Purpose | Typical length |
| --- | --- | --- |
| Intro | A safe space to try the controls; the goal direction is visible | 1 screen |
| Teach | One new element where failing costs nothing (a gap with ground below, an enemy facing away) | 1–2 screens |
| Test | The same element where failing costs a little | 1–2 screens |
| Twist | The element combined with something known, or used in a new way | 1–2 screens |
| Rest | No threat; a pickup, checkpoint or view ahead | ½ screen |
| Finale | The hardest use of the element, then the goal | 1–2 screens |

One new element per level (or per section in a long level). You decide the beat sheet, placement, checkpoints and secrets. Ask first when a level needs a mechanic, enemy or hazard the plan does not have, or the plan's level count or length would change.

## Readable at a glance

- **The goal direction is never in doubt.** The first screen shows which way to go: open space, a path, light, a landmark or a pickup trail. In a top-down level, the exit or the next landmark is visible or pointed at.
- **Landmarks every one to two screens**: a distinctive prop, a colour change or a silhouette the player can name ("the broken tower"). They make backtracking and hub levels navigable.
- **Lead with lines.** Pickups, lighting and platform edges point along the critical path. A row of coins shows the jump arc; a lone coin off the path hints at a secret.
- **Show before you use.** A hazard or enemy is visible from safety before the player must deal with it; leaps of faith into the unseen are out unless something below is visible.
- **Readable ground.** Solid and walkable surfaces differ clearly from background tiles in value or outline, per the style reference. Decoration never looks like a platform. One-way platforms look different from solid ones.
- **Difficulty in sawtooth, not a ramp.** Each section is harder than the last of its kind, followed by a rest. The finale of a level is harder than the next level's opening.
- **Checkpoints before the test, not after.** Respawn within 20–40 seconds of play from any death. Never respawn the player into immediate danger.
- **Secrets are optional and fair.** Off the critical path, hinted by a visual tell (a cracked wall, a lone pickup, a gap in the ceiling), and never required to finish.
- **Both directions.** If the player can go back, the route back must be possible and not a trap.

## Build it

Keep the beat sheet as a comment or a short `levels/<name>.md` beside the level, and mark sections in the map so the route can be checked against it.

- **Godot 4:** paint terrain on a `TileMapLayer` with collision; put decoration on a separate layer with no collision; place spawn, checkpoints, the goal and section markers as nodes (or a `Marker2D` per beat) so tests can find them by name. Use the terrain system for auto-tiling so platform edges read.
- **Phaser 3 with Tiled:** a terrain layer with collision (`setCollisionByProperty({ collides: true })`), a decoration layer, and an object layer for spawn, checkpoints, goal, secrets and beat markers with a `type` property. Read objects with `map.getObjectLayer('objects').objects` rather than hard-coding positions.
- **Unity 6:** a Tilemap with `TilemapCollider2D` and `CompositeCollider2D` for terrain, decoration Tilemaps without colliders, and empty GameObjects for spawn, checkpoints and beats.

Measure every required jump against the movement budget from the parent skill, with at least one tile of margin. Gaps at the limit of the jump belong only in a test or finale section.

## Verify in a playtest

After the parent's `pixo game verify` step, play the critical path from the real spawn, die on purpose in each test section, and check the respawn. On a web build, a long hold captures the opening and the first section:

```json
[
  {"wait": 500},
  {"capture": "spawn"},
  {"key": "ArrowRight", "down": true},
  {"wait": 1500},
  {"key": "Space", "press": true, "holdMs": 120},
  {"wait": 1500},
  {"key": "ArrowRight", "down": false},
  {"capture": "first-section"}
]
```

Check against the beat sheet: the first frame shows the direction, each section introduces only its one element, every required jump fits the budget, the respawn after each test is close and safe, and decoration never reads as ground. Godot capture injects no input and Unity has no capture; play the route by hand in both directions.

## Common mistakes

| Wrong | Right |
| --- | --- |
| Several new elements in the first level | One new element, taught, tested, twisted |
| The first test of a hazard can kill | Teach where failing costs nothing |
| Jumps at the exact limit of the controller | At least one tile of margin outside finale sections |
| Checkpoint placed after the hard part | Before the test, 20–40 s of play apart |
| Decorative tiles with the same value as platforms | Ground reads differently, per the style reference |
| A new enemy type invented to fill a level | Use what the plan has; ask before adding |
