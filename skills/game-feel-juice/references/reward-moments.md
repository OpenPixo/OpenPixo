---
en_name: Pickup and reward feedback
zh_name: 拾取与奖励反馈
---

# Pickup and reward feedback

Part of the game-feel-juice skill; read its SKILL.md first, including "Choose the layer" and the engine section. The game's style reference and the confirmed plan decide the sprites, particles and colours. This file decides how collecting, levelling up and opening something feels: the order of the cues and their timing.

## Decide first

Sort the game's rewards into three tiers and give each tier a fixed budget of cues:

| Tier | Examples | Cues | Total time |
| --- | --- | --- | --- |
| Small | Coin, XP gem, ammo | Pop or flyaway, one short sound, counter tick | 150–300 ms |
| Medium | Heart, key, power-up | Above, plus a burst of a few particles and the counter pop | 300–600 ms |
| Big | Level-up, chest, boss reward, new ability | Brief slow-down or hit-stop, a flash, a sound sting, a panel or name | 0.8–2 s, then control returns |

You decide the tiers, timings and cue choices. Ask first if a change affects what a reward gives, adds magnet or auto-collect behaviour the plan did not have, or adds a reward screen that pauses play.

## Readable at a glance

- **The value arrives where the player looks for it.** A pickup flies to its HUD counter (200–400 ms, ease-in-out), and the counter pops when it lands, not when the item was touched.
- **Instant acknowledgement.** The touched item reacts on the same frame (shrink, flash, sound) even if the flight takes longer; the gameplay value is added at once, the display catches up.
- **Pitch rising in streaks.** For quick runs of small pickups, raise each sound's pitch a semitone (up to about an octave) and reset after about half a second without pickups. It makes a streak audible without louder sounds.
- **Magnet range is honest.** If pickups drift to the player, start the drift at a visible distance and accelerate; they never escape once moving.
- **Big rewards stop the world briefly.** 100–300 ms of hit-stop or slow motion, a flash from the palette's lightest tone, then the reward's name or panel. Reward choice panels (upgrades) pause play and take input only after about 300 ms, so a held button does not pick by accident.
- **Do not drown the HUD.** Counters merge rapid increases into one rolling number rather than one pop per item.
- **Reduced motion and flashes.** Flashes cover no more than the reward's area, never full-screen strobing; the option for reduced motion removes slow-motion and screen shake from rewards.

## Build it

Fire the feedback from the event that grants the reward (pickup consumed, level reached), after the gameplay value is applied. Visual pieces live on presentation children or pooled effects, per the parent skill.

- **Godot 4:** on the pickup's `body_entered`, apply the value, disable its collision with `set_deferred`, then tween a pooled sprite from `get_global_transform_with_canvas().origin` to the HUD counter's screen position in the UI `CanvasLayer`; on finish, emit the counter's pop. Rising pitch with `AudioStreamPlayer.pitch_scale = pow(2.0, streak / 12.0)`. Particles with a one-shot `GPUParticles2D` or `CPUParticles2D` (`one_shot = true`, `emitting = true`).
- **Phaser 3:** in the overlap callback, apply the value and `disableBody(true, true)`; convert the item's world position to screen with `(x - cam.worldView.x) * cam.zoom` (and the same for y), spawn a pooled image in the HUD scene and tween it to the counter; `onComplete` pops the counter. Rising pitch with `this.sound.play('coin', { detune: streak * 100 })`. Particles with `this.add.particles(x, y, key, { emitting: false })` and `emitter.explode(8)`.
- **Unity 6:** on trigger, apply the value, disable the collider, convert with `Camera.WorldToScreenPoint` into the HUD canvas and tween a pooled UI image; `AudioSource.pitch = Mathf.Pow(2f, streak / 12f)`. A `ParticleSystem.Emit(count)` on a pooled system for bursts. Hit-stop for big rewards through the project's single time owner (see the parent skill).

## Verify in a playtest

After the parent's `pixo game verify` step, collect a run of small pickups and one medium or big reward, capturing during the flight and after:

```json
[
  {"wait": 500},
  {"key": "ArrowRight", "press": true, "holdMs": 700},
  {"capture": "collecting"},
  {"wait": 300},
  {"capture": "counter-landed"}
]
```

Check: the item reacts on touch, the counter changes when the flight lands, a fast streak does not spawn one pop per item, a big reward returns control within its budget, and the counter's final value equals the gameplay value. Listen for the rising pitch by playing it. Godot capture injects no input and Unity has no capture; play those by hand.

## Common mistakes

| Wrong | Right |
| --- | --- |
| Value added only when the flight lands | Value applied at once; the display catches up |
| Every coin has particles, shake and a flash | Cues by tier; small rewards stay small |
| Pickups that slip away from the magnet | Accelerate toward the player and never escape |
| An upgrade panel accepts the held attack button | Ignore input for about 300 ms after it opens |
| Full-screen white flash on level-up | Flash within the reward's area, from the palette |
| Auto-collect added because it "feels better" | Ask; collection range is game design |
