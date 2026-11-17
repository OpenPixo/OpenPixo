---
en_name: Boss intros and phases
zh_name: Boss 登场与阶段
---

# Boss intros and phases

Part of the enemy-ai-state-machines skill; read its SKILL.md first, and `references/enemy-telegraphs.md` for the boss's attacks. The game's style reference and the confirmed plan decide the boss's look, the arena art and the name-card styling. This file decides how the fight is introduced, how it is split into phases and how each change is shown.

## Decide first

| Question | Default |
| --- | --- |
| Intro length | 2–4 s, skippable on any replay of the fight (after a death) |
| Phases | Two or three, at health thresholds such as 66 % and 33 % or 50 % |
| What changes per phase | One thing: a new attack, a faster pattern or a changed arena. Never all three |
| Arena | Closed during the fight; the entrance locks when the intro starts and opens on defeat |
| On death | Respawn at a checkpoint just outside the arena, with the intro shortened or skipped |

You decide intro staging, timing, thresholds and transitions. Ask first before adding phases, attacks, arena hazards or changing boss health: those change the game the plan describes.

## The intro

1. **Lock the arena** behind the player as they enter; their control continues for a moment so it does not feel like a cutscene trap.
2. **Take the camera** to the boss (300–600 ms ease), with the player's control off and invulnerable.
3. **The boss does one signature move**: a roar, a pose, a landing. It shows the silhouette and one tell the player will see again.
4. **Name card**: the boss's name, large, with an optional epithet, held about 1.5 s. It uses the title or display font of the game.
5. **Return the camera** and hand control back as the boss health bar fills in over about 500 ms (see `game-ui-hud`'s `references/health-bars.md` when that skill is listed). The boss does not attack in the first second.
6. **Music** switches at step 2 or 3.

Any input during a repeat skips to step 5. The first time, skipping is allowed only after the name card appears.

## Phase changes

- **Mark the threshold** on the boss bar as a notch so the player sees it coming.
- **On the threshold**, stop the current attack cleanly (cancel tells and hitboxes), make the boss briefly invulnerable (0.5–1.5 s) with a clear reaction: stagger, flash, roar.
- **Show what changed** in that pause: a new pose, an arena change, a colour shift from the palette, a short shake through the camera owner.
- **Damage overflow** past a threshold is clamped to it, so a big hit cannot skip a phase.
- **Phase state lives in the boss**, not in the HUD or the arena; the arena and music react to a `phase_changed` event.

## Defeat

Hit-stop and a longer reaction on the final blow, all boss hitboxes off at once, enemies and projectiles cleared, then the reward and the arena opening. The player cannot take damage after the boss's health reaches zero.

## Build it

- **Godot 4:** an intro state on the boss plus an arena node that owns the doors and the camera handoff; drive the camera with a `Tween` on a `Camera2D` (or switch to a boss `Camera2D` with `make_current()`). The name card is a `CanvasLayer` scene with an `AnimationPlayer`. Emit `phase_changed(phase)` from the boss's health handler; the arena and music listen.
- **Phaser 3:** `this.cameras.main.pan(x, y, 500, 'Sine.easeInOut')` with input locked, then `startFollow(player)` again; the name card is a container in the HUD scene tweened in and out. Phases change in the boss's damage handler; cancel pending `delayedCall`s for the current attack.
- **Unity 6:** a Cinemachine camera with higher priority for the intro, or a Timeline for the staged part with a signal to return control; the boss raises a C# event on phase change. Turn the boss's hurtbox off during intro and transitions.

Record "intro seen" with the checkpoint state so the shortened version plays after a death.

## Verify in a playtest

After the parent's `pixo game verify` step, enter the arena from the checkpoint and capture the intro beats:

```json
[
  {"key": "ArrowRight", "press": true, "holdMs": 1200},
  {"wait": 600},
  {"capture": "camera-on-boss"},
  {"wait": 1200},
  {"capture": "name-card"},
  {"wait": 1500},
  {"capture": "fight-starts"}
]
```

Then play the fight: check each threshold triggers once, a big hit cannot skip a phase, a death respawns near the arena with a short intro, and the arena opens on defeat. Log phase changes with health values. Godot capture injects no input and Unity has no capture; play those by hand.

## Common mistakes

| Wrong | Right |
| --- | --- |
| A 10-second intro replayed on every attempt | 2–4 s, skippable after the first time |
| The boss attacks while the camera is still away | Control and attacks resume together, with a one-second grace |
| Each phase adds attacks, speed and hazards | One change per phase |
| A single big hit skips phase two | Clamp damage at each threshold |
| The player dies to a projectile after the boss is dead | Clear projectiles and hazards on defeat |
| Extra phases invented to make the boss "epic" | Ask; phases are game design |
