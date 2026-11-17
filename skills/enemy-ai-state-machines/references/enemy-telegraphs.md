---
en_name: Enemy attack telegraphs
zh_name: 敌人攻击预警
---

# Enemy attack telegraphs

Part of the enemy-ai-state-machines skill; read its SKILL.md first, including "Transition decisions" and the engine section for attack timing. The game's style reference and the confirmed plan decide the sprites, effects and colours. This file decides how an attack warns the player: how long, through which channels, and how the warning lines up with the hit. Colours named below are roles (warning, danger zone), filled from the game's palette.

## Decide first

For each attack, write one row:

| Attack | Wind-up | Active | Recovery | Tell | Counter |
| --- | --- | --- | --- | --- | --- |
| Slime lunge | 400 ms | 150 ms | 500 ms | Squash + flash | Jump over or step back |

- **Wind-up** is the warning. 300–600 ms for common enemies, 600–1200 ms for heavy or area attacks, 150–250 ms only for fast attacks the player has already learned.
- **Recovery** is the punish window. An attack that is hard to avoid should leave a long recovery.
- **Counter**: if no row has an answer the player can perform, the attack is unfair.

You decide wind-up lengths, tells and the danger-zone display. Ask first if a change alters damage, attack range, enemy health or adds an attack.

## Readable at a glance

- **At least two channels.** A pose (wind-up frame, crouch, rear back) plus one of: a flash or tint, a sound, a ground marker. Never colour alone.
- **The pose reads in silhouette.** The wind-up frame changes the outline (raised arm, crouch), not only the interior colour, so it reads on small sprites and busy backgrounds.
- **Area attacks show their area.** A ground marker with the exact hit shape, filled or growing over the wind-up so the player can read the remaining time. The marker's shape is the hitbox's shape.
- **The hit lands when the tell ends.** Damage is enabled on the active frames only, starting when the warning finishes. A hitbox active during the wind-up is a cheap hit.
- **Consistent language.** The same tell means the same kind of attack across all enemies: for example a white flash for "melee coming" and a ground marker for "area coming". Unblockable or special attacks get one distinct, reserved tell.
- **Sound starts with the wind-up**, not with the hit, and is audible over music. Off-screen attackers make sound or show an edge indicator.
- **Several enemies, one attack at a time.** In group fights, a token (at most one or two attackers in wind-up at once) keeps tells readable. Others circle or wait.
- **Accessibility.** An option to lengthen wind-ups (for example 1.5×) is cheap when timing lives in data.

## Build it

Put wind-up, active and recovery durations in the enemy's data or exported fields, read by the state machine; the tell is a presentation reaction to entering the wind-up state.

- **Godot 4:** a `WindUp` state that starts the tell (an `AnimationPlayer` track for the pose and a `modulate` flash, plus an `AudioStreamPlayer2D`) and a timer; on timeout, enter `Active`, enable the hitbox `Area2D` (`monitoring = true`, or set its `CollisionShape2D.disabled = false` with `set_deferred`) and disable it on exit. For area attacks, a child `Polygon2D` or sprite with the hitbox's exact shape whose `scale` or alpha tweens over the wind-up.
- **Phaser 3:** the state machine sets `enemy.setTintFill(warningColour)` on a short flash timer and plays the wind-up animation; the hitbox body is enabled in a `delayedCall(windUpMs)` and disabled after the active time. Cancel both timers if the enemy is stunned or dies. Area markers are a `Graphics` or image at depth below characters.
- **Unity 6:** an Animator with wind-up, active and recovery clips, and animation events (`EnableHitbox`, `DisableHitbox`) on the active clip, or state-machine timers if the project avoids animation events. Area markers are a sprite or decal with the hitbox's shape; scale it with the remaining wind-up.

Interrupting a wind-up (stun, death, phase change) must also cancel the tell, the queued hitbox and the sound.

## Verify in a playtest

After the parent's `pixo game verify` step, stand still in range and capture during the wind-up and at the hit:

```json
[
  {"wait": 1500},
  {"capture": "wind-up"},
  {"wait": 400},
  {"capture": "active"},
  {"wait": 600},
  {"capture": "recovery"}
]
```

Adjust waits to the attack's row. Check: the wind-up frame differs in silhouette, the area marker matches the hit area, damage arrives only after the tell, and a stun during wind-up cancels everything. Log state entry times to compare with the table. Then play it: the player should avoid each attack after seeing it once or twice. Godot capture injects no input and Unity has no capture; play those by hand.

## Common mistakes

| Wrong | Right |
| --- | --- |
| Hitbox active from the first wind-up frame | Hitbox on active frames only |
| The only tell is a colour change | Pose plus flash, sound or marker |
| Area marker smaller or larger than the real hit | Marker shape is the hitbox shape |
| Five enemies wind up at once | An attack token for one or two at a time |
| Stunned enemy still lands its queued hit | Interrupts cancel the tell and the hitbox |
| Wind-up shortened to make the game "harder" without asking | Difficulty changes go to the user |
