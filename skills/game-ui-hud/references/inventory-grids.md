---
en_name: Inventory grids
zh_name: 背包与物品格
---

# Inventory grids

Part of the game-ui-hud skill; read its SKILL.md first, including its pause and focus section for the engine. The game's style reference, the confirmed plan and the parent's look rules decide how slots and panels look. This file decides the grid's shape, selection, details and the actions on an item. Colours named below are roles (selected, equipped, rarity, unusable), filled from the game's palette.

## Decide first

| Question | Default |
| --- | --- |
| Grid, list or hotbar? | A grid for items that are mostly icons; a list when names and numbers matter (crafting materials, quest items); a hotbar of 4–10 slots for items used during play |
| Fixed slots or shaped items? | One item per slot. Shaped (Tetris-style) items only if packing is the game |
| Stacks? | Stack identical consumables with a count; never stack equipment |
| Does the world pause? | Yes for single-player unless the plan makes inventory pressure part of the game |
| Sorting | Keep the player's order; offer one sort action (type, then rarity) |

You decide the grid size, details panel, sort action and input mapping. Ask first when the change adds a rule: capacity limits, weight, item shapes, dropping or selling items, or equipment slots the plan did not have.

## Readable at a glance

- **Slots are always visible**, empty ones included, so the player sees capacity. Empty slots are a dim version of the full slot from the art.
- **Icon first.** The icon fills about 70–80 % of the slot. Stack count in a bottom corner with an outline; no item names inside slots.
- **Selection is unmistakable**: a frame or glow plus a small scale or bounce, visible on every slot background. Hover and controller selection are the same selection.
- **Details beside the grid**, never in a tooltip that covers the next slot: name, one-line effect, the numbers that matter, and what the action buttons will do. Compare against the equipped item with a plain up/down for each changed stat.
- **State marks that do not need words.** Equipped: a small corner badge. New: a dot that clears on first selection. Unusable: dimmed. Rarity: a frame tint plus a shape or pip, because colour alone fails for colour-blind players.
- **Actions show their binding.** "Use", "Equip", "Drop" with the button glyph for the current device. Destructive actions (drop, sell, salvage) ask once or need a hold.
- **Grid shape fits the screen.** 5–8 columns at 720p; slots at least 44 pt on touch. Long names wrap in the details panel, which allows translations 30–40 % longer.

## Build it

The inventory owner (a model of slots) is separate from the view. The view rebuilds from the model on open and on a change event; it never stores items.

- **Godot 4:** a `GridContainer` of slot `Button`s (or `TextureButton`s from the art) with `focus_mode = FOCUS_ALL`, so arrow keys and the D-pad move focus for free. Connect `focus_entered` and `mouse_entered` to one `select(index)` that updates the details panel, and grab focus on the last selected slot when opening. Drag and drop uses `_get_drag_data`, `_can_drop_data` and `_drop_data` on the slot.
- **Phaser 3:** compute slot positions from `index % columns` and `Math.floor(index / columns)`; keep `selected` as one index changed by keys, gamepad and `pointerover`. Wrap with `Phaser.Math.Wrap` within a row, clamp between rows. Draw slot frames from the art (`nineslice` for panels) in the menu scene.
- **Unity 6:** a `GridLayoutGroup` of `Selectable` slots with explicit or automatic navigation; `ISelectHandler` and `IPointerEnterHandler` both call the same select method. For drag and drop, `IBeginDragHandler`, `IDragHandler` and `IDropHandler` on slots, with a drag icon on a top canvas.
- **Web and Three.js:** a CSS grid (`grid-template-columns: repeat(6, var(--slot))`) of `<button>`s; arrow keys move by ±1 and ±columns; `focus` and `pointerenter` share one selection. Use `aria-label` with the item name and count.

Keep the selected index valid when items are removed: clamp it to the new count instead of resetting to 0.

## Verify in a playtest

After the parent's `pixo game verify` step, open the inventory, move the selection across a row end and down a column, use an item and close:

```json
[
  {"wait": 500},
  {"key": "i", "press": true},
  {"wait": 200},
  {"capture": "opened"},
  {"key": "ArrowRight", "press": true},
  {"key": "ArrowDown", "press": true},
  {"wait": 150},
  {"capture": "moved"},
  {"key": "Escape", "press": true},
  {"wait": 200},
  {"capture": "closed"}
]
```

Use the game's own bindings. Check: selection visible in every frame, details panel matches the selected item, full and empty inventory, a removed last item, mixed mouse and keyboard, restart. Godot capture injects no input and Unity has no capture; play those by hand.

## Common mistakes

| Wrong | Right |
| --- | --- |
| Item names and descriptions inside every slot | Icon and count in slots; text in the details panel |
| Hover and keyboard keep separate highlights | One selection shared by every device |
| Selection resets to the first slot after using an item | Clamp to the nearest remaining slot |
| Rarity shown only by colour | Colour plus shape or pips |
| Drop happens on one press with no undo | Confirm or hold for destructive actions |
| The view stores items and gameplay reads them back | The inventory model is authoritative |
