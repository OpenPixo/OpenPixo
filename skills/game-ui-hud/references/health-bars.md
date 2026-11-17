---
en_name: Health bars
zh_name: 血条设计
---

# Health bars

Part of the game-ui-hud skill; read its SKILL.md first. The game's style reference, the confirmed plan and the parent's look rules decide how the bar looks. This file decides what it shows, where it sits and how it moves. Colours named below are roles (damage, heal, shield), filled from the game's palette.

## Decide first

| Question | Default |
| --- | --- |
| Whose health? | Player in screen space; enemies in the world; a boss in screen space |
| Bar, hearts or number? | Hearts or pips when the maximum is about 10 or less and damage comes in whole units. A bar when values are large or fractional. A number only when the player does arithmetic with it (RPG, card, tactics) |
| Extra layers? | Only what the game has: shield or armour over health, a pending-damage trail, a heal preview |
| Does the bar grow with max health? | Fixed length by default. If upgrades raise the maximum, grow the bar up to about 1.5× and then add segment ticks instead |

You decide layout, timing and representation. Ask first when the change adds a stat (shield, armour, regeneration), changes a maximum or a damage rule, or replaces hearts with a bar the plan described differently.

## Readable at a glance

- **Current value is instant.** The fill jumps to the new value the frame damage lands. Only the trail behind it animates.
- **Damage trail.** A lighter chunk holds the lost amount for 0.3–0.5 s, then drains over 0.2–0.4 s. A second hit during the hold restarts the hold but keeps the trail's start. Healing reverses it: a preview chunk appears first and the fill catches up.
- **Empty is visible.** The empty part is a dark version of the fill or a slot from the art, never the world showing through. Fill against empty needs at least 3:1 contrast, and so does the bar against the busiest background.
- **Chunks you can count.** Above about 100 maximum, draw ticks every 10, 25 or 100 units so the player reads "two chunks left". Hearts show halves and keep empty outlines.
- **Danger at the value.** Below 25–30 %, the bar pulses at 1–2 Hz and a low-health sound or screen-edge vignette starts. Never rely on colour alone. With reduced motion, swap the pulse for a steady outline.
- **Numbers on the bar** (optional): `current / max` inside the bar's end, in tabular figures so digits do not jitter.
- **Enemy bars** appear on the first hit (or always for elites), sit above the head, hide after 3–5 s without damage and never cover the player. Width follows the enemy's size class, not its health. One-hit enemies get none.
- **Boss bar** is screen space, 40–60 % of the width, centred at the top or bottom, with the name above it and notches at phase thresholds. Its entrance belongs to the boss intro (`enemy-ai-state-machines`, `references/boss-intros.md`, when that skill is listed).
- **Pixel art.** Round fill widths to whole pixels and draw hard edges; a smooth sub-pixel fill shimmers.

## Build it

The bar observes the health owner's change event (`current`, `max`, `delta`) and keeps only presentation state: displayed fill, trail value and its timer. It never changes health.

- **Godot 4:** a `TextureProgressBar` from the art (or a nine-patch) for the fill, a second one under it for the trail. On change: set the fill's `value`, kill the trail's previous tween, then `create_tween().tween_interval(0.4)` and `tween_property(trail, "value", new_value, 0.25)`. Pixel art: `texture_filter = TEXTURE_FILTER_NEAREST`.
- **Phaser 3:** in the HUD scene, an image cropped with `fill.setCrop(0, 0, Math.round(w * ratio), h)`, the trail drawn the same way underneath. Tween a plain `{ ratio }` object with `delay: 400, duration: 250` and redraw in `onUpdate`; stop the old tween first. World bars follow the enemy in `update` and are destroyed with it.
- **Unity 6:** two `Image`s with Image Type Filled, Fill Method Horizontal; set `fillAmount` on the fill, ease the trail in a coroutine. Use gameplay time so hit-stop holds the trail with everything else.
- **Web and Three.js:** two elements in the HUD layer with `transform: scaleX(ratio)` and `transform-origin: left`. The fill has no transition; the trail has `transition: transform 250ms 400ms`. World bars use `CSS2DRenderer` or a camera-facing sprite.

## Verify in a playtest

After the parent's `pixo game verify` step, drive damage through the real route, not a debug setter. On web, a script that walks into the first enemy and captures twice shows both the instant drop and the trail:

```json
[
  {"wait": 500},
  {"key": "ArrowRight", "press": true, "holdMs": 900},
  {"capture": "hit"},
  {"wait": 700},
  {"capture": "after-trail"}
]
```

Adapt keys and timing to the game; points are in the 1280 × 720 capture viewport. Godot capture injects no input and Unity has no capture, so play those by hand. Check: full, low, zero and a raised maximum; ten enemy bars at once; the smallest target resolution; restart resets the bar without a drain animation.

## Common mistakes

| Wrong | Right |
| --- | --- |
| The fill itself eases down over half a second | The fill jumps; only the trail animates |
| Empty part is transparent over the world | A visible empty track or slot |
| Red and green are the only signal for low health | Pulse, sound or vignette as well |
| Every enemy shows a bar from spawn | Bars appear on damage and hide when idle |
| The bar decrements health or is read back by gameplay | The health owner is authoritative; the bar observes |
| A new palette or bordered card for the bar | The game's palette and art, per the style reference |
