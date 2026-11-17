---
en_name: Damage numbers
zh_name: 伤害数字
---

# Damage numbers

Part of the game-ui-hud skill; read its SKILL.md first. The game's style reference, the confirmed plan and the parent's look rules decide the font and colours. This file decides when numbers appear, how they move and how many there may be. Colours named below are roles (normal, critical, heal, blocked), filled from the game's palette.

## Decide first

| Question | Default |
| --- | --- |
| Should the game show numbers? | Yes when the player compares damage or builds (RPG, survivor-style, loot). No in platformers, puzzle games and horror, where hit feedback is a flash and a sound |
| Whose numbers? | Damage the player deals; damage the player takes only if health is numeric |
| Variants | Normal, critical, heal; add blocked or immune only if the game has them |
| Merge rule | Hits on the same target within about 150 ms add into one number |

You decide size, motion, merging and caps. Ask first if numbers would expose values the design hides, or a variant needs a rule the game does not have (crits, resistances).

## Readable at a glance

- **Short life.** 0.5–0.9 s. Rise 20–40 px (at 720p) with ease-out, hold, then fade over the last third. A number on screen longer than a second is clutter.
- **Pop on spawn.** Start at about 130 % scale and settle to 100 % in 80–120 ms. Criticals start larger (150–180 %), stay a little longer and may shake once.
- **Size encodes importance, not value.** Two or three fixed sizes (normal, big hit, critical). Scaling continuously with damage makes late-game numbers fill the screen.
- **Spread so they do not stack.** Random horizontal offset of ±10–20 px and a slight arc; alternate left and right per target.
- **Outline, always.** A 1–2 px outline or hard shadow from the palette's darkest tone, so the number reads over any background. Tabular figures; no decimals unless damage is fractional and small.
- **Short formats.** 1,250 becomes `1.2K` once numbers pass four digits. Heals get a `+`.
- **Caps.** At most about 30 numbers alive; when the cap is hit, merge into the newest number on that target or drop the smallest. Survivor-style games often need an option to turn numbers off.
- **Never over the player's own character** or the HUD. Numbers spawn at the target's hit point, not its origin.
- **Reduced motion:** no shake, shorter rise.

## Build it

Spawn numbers from the event where damage was accepted (after armour and immunity), with the final amount and a variant. Pool the objects: survivor-style games spawn hundreds a minute.

- **Godot 4:** a pooled `Label` (or `RichTextLabel` only if you need inline icons) with a `LabelSettings` holding font, outline size and outline colour. Place it in world space under a node that is not affected by the target's flip or scale, or in a `CanvasLayer` at `get_viewport().get_canvas_transform() * world_pos`. Tween `position:y`, `scale` and `modulate:a` in one parallel tween; return to the pool on finish.
- **Phaser 3:** a pool from `this.add.group({ classType: Phaser.GameObjects.Text, maxSize: 40 })` or `BitmapText` for pixel fonts (crisper and cheaper). `group.get(x, y)`, set text and style, then one tween on `y`, `scale` and `alpha` whose `onComplete` calls `group.killAndHide(text)`. In world space so they move with the camera; set `depth` above enemies.
- **Unity 6:** pooled `TextMeshPro` (world) objects from `ObjectPool<T>`; a material preset with outline. Animate in `Update` with gameplay time, or with the project's tween library.
- **Web and Three.js:** pooled absolutely positioned elements in the HUD layer, positioned each frame from `vector.project(camera)`, animated with the Web Animations API (`el.animate(keyframes, { duration: 700, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' })`); hide when the projected `z` exceeds 1. For hundreds a second, draw them on a canvas or use instanced sprites instead.

## Verify in a playtest

After the parent's `pixo game verify` step, cause a burst of hits on one target and on several, and capture mid-burst:

```json
[
  {"wait": 500},
  {"key": "Space", "press": true},
  {"wait": 120},
  {"capture": "first-hit"},
  {"key": "Space", "press": true},
  {"key": "Space", "press": true},
  {"wait": 120},
  {"capture": "burst"},
  {"wait": 1000},
  {"capture": "cleared"}
]
```

Use the game's own attack binding. Check that numbers do not overlap into a smear, the cap holds in the busiest wave, the `cleared` frame has none left, and they read at the smallest target resolution. Godot capture injects no input and Unity has no capture; play those by hand and watch the pool size in a log.

## Common mistakes

| Wrong | Right |
| --- | --- |
| Number size grows with damage | Two or three fixed sizes by importance |
| Every tick of damage over time spawns a number | Merge ticks within ~150 ms on one target |
| No outline over a busy background | Outline or hard shadow from the palette |
| Numbers created and destroyed per hit | Pooled objects |
| Numbers in a platformer the plan never asked for | Hit flash and sound instead |
| Damage shown before armour or immunity is applied | Spawn from the accepted-damage event |
