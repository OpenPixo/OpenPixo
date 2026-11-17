---
en_name: Tutorial prompts
zh_name: 新手引导提示
---

# Tutorial prompts

Part of the game-ui-hud skill; read its SKILL.md first. The game's style reference, the confirmed plan and the parent's look rules decide the glyphs, font and panel. This file decides when a prompt appears, what it says and when it goes away. What to teach, and in what order, belongs to the first minute of play (`game-design-doc`, `references/first-minute.md`, when that skill is listed).

## Decide first

| Question | Default |
| --- | --- |
| Which actions need a prompt? | Only actions the level cannot teach by itself, and each at the moment it is first needed |
| Prompt kind | A button glyph and a verb ("[Space] Jump") near the player or the object. A panel only for a rule that has no button |
| Which device? | The one the player last used. Swap glyphs the moment they press a key or a button on another device |
| Repeat? | Once per save. Show again only if the player fails the same thing two or three times |
| Skip | Experienced players can turn tutorial prompts off in settings |

You decide wording, placement, timing and dismissal. Ask first before adding a separate tutorial level, a forced practice step, or rules the plan does not have.

## Readable at a glance

- **Glyph and verb, nothing else.** `[E] Open`, not "Press the E key to open the chest". Under 25 characters in English, leaving room for longer translations.
- **At the place it applies**: above the door, beside the ledge, under the player. Screen-centre panels only for something with no location.
- **Appear on proximity, leave on success.** Fade in (about 200 ms) when the player is near and the action is possible; fade out (about 140 ms) the moment they perform it. A timer alone is the wrong dismissal for an action prompt.
- **Never blocks play** unless the game cannot continue without the action. Never covers the thing it is teaching.
- **One at a time.** If two would overlap, show the one for the nearer object.
- **Glyphs match the device.** Keyboard keys in a key cap, controller buttons by their face (A/B/X/Y or the generic face positions), touch as an on-screen hand or highlighted control. Remapped controls show the current binding.
- **Contextual hints after failure.** After two or three failures at the same spot, show the prompt again, or a short hint ("Hold to jump higher"), and stop once they succeed.
- **The pause menu lists the controls** for anyone who dismissed a prompt too soon.

## Build it

A tutorial owner tracks which prompts were shown and completed, saved with progress or settings. A trigger area or interaction system asks it whether to show a prompt, and the action event tells it the prompt is done. The prompt widget only draws.

- **Godot 4:** an `Area2D` (or `Area3D`) with `body_entered` and `body_exited`. Read the current binding from `InputMap.action_get_events(&"jump")` and pick the glyph for the last device: track it in `_input` with `event is InputEventJoypadButton` versus `InputEventKey`. The prompt is a small `Control` in a `CanvasLayer` placed at the target's screen position, or a `Node2D` child of the target in world space.
- **Phaser 3:** a zone with `this.physics.add.overlap(player, zone, show)` and a distance check to hide. Track the last device from `this.input.keyboard.on('keydown')` and `this.input.gamepad.on('down')`. The prompt is a container of a glyph image and text, following the target in world space, depth above sprites.
- **Unity 6:** a trigger collider calling the tutorial owner; read the binding display string with `InputAction.GetBindingDisplayString()` for the current control scheme (`PlayerInput.currentControlScheme`, `onControlsChanged`) so remapping and device swaps update the glyph.
- **Web and Three.js:** check distance in the loop; the prompt is an element in the HUD layer at the projected position. Last device from `keydown` versus a Gamepad API press edge versus `pointerdown` with `pointerType === 'touch'`.

## Verify in a playtest

After the parent's `pixo game verify` step, walk to the first prompt, perform the action and capture before and after:

```json
[
  {"wait": 500},
  {"key": "ArrowRight", "press": true, "holdMs": 800},
  {"capture": "prompt-shown"},
  {"key": "Space", "press": true},
  {"wait": 300},
  {"capture": "prompt-gone"}
]
```

Check: the prompt appears where it applies and goes on success, a restart of a completed save does not show it again, keyboard and controller glyphs swap, and the longest translation fits. Godot capture injects no input and Unity has no capture; play those by hand.

## Common mistakes

| Wrong | Right |
| --- | --- |
| A wall of control text at the start | One prompt per action, when it is first needed |
| Prompts disappear after a timer whether or not the player acted | Leave on success; a timer only for passive hints |
| Keyboard glyphs while the player uses a controller | Glyphs follow the last device and the current binding |
| The same prompts on every restart | Once per save, again only after repeated failure |
| A forced tutorial level added to a short game | Teach in the first level through its layout |
