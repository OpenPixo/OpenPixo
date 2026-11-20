# UI kit and components

A game whose HUD is plain rectangles and system text reads as a debug overlay, whatever its world looks like. The UI is made from the master like everything else: one sheet per group, with the master as image 1 and the Style DNA pasted in.

## Groups

One group is one sheet (one image call), 4–12 pieces. Make the groups the game's screens use; a small game needs `core` only.

| Group | Pieces | Tier | Grid |
| --- | --- | --- | --- |
| `buttons` | primary normal, hover, pressed, disabled; secondary normal, pressed (the secondary keeps the shape with a plainer, darker face, so it reads as the second choice) | core | 3x2 |
| `panels` | large panel, popup with a title bar and close-button spot, dialogue box with a name plate, tooltip | core | 2x2 |
| `bars` | health empty and fill, stamina empty and fill, progress empty and fill | core | 2x3 |
| `hud-icons` | the game's own status and resource icons: coin, heart, clock, day, bag, the key items | core | 4x2 |
| `slots` | empty item slot, selected slot, rarity frames (common, uncommon, rare, epic, legendary) | std | 4x2 |
| `small-buttons` | close, back, plus, settings, pause, sound | std | 3x2 |
| `toggles` | tab normal and selected, toggle on and off, slider track and knob, checkbox on and off | std | 4x2 |
| `prompts` | keyboard key cap, mouse buttons, gamepad A B X Y, as empty frames the engine writes the letter into | std | 4x2 |
| `badges` | new marker, count dot, lock, check, star on and off | ext | 3x2 |
| `banners` | screen title bar, victory banner, defeat banner, divider ornament | ext | 2x2 |

Large single pieces that the player looks at most (the primary button, the dialogue box, the main HUD frame) are worth one image each with template 6, saved as `<name>-hq.png`.

## Naming and paths

- Names are `<group>-<use>-<state>`, lowercase with hyphens: `buttons-primary-pressed`, `slots-rare`, `bars-health-fill`.
- A sheet is `assets/ui/<group>-sheet.png`; its pieces land next to it under their names (a piece cannot share the sheet's name).
- Prompts go in `art/prompts/ui-<group>.txt`.

## States

| State | Change from normal |
| --- | --- |
| hover | slightly brighter, or a thin light outline |
| pressed | 10–15% darker, highlight weaker, shifted down 2–4 px, same outline |
| disabled | desaturated to grey, lower contrast, no glow |
| selected | an outer glow or bright outline, up to 5% larger |

Every state of a piece keeps the same outline, size and view; only colour, brightness and glow change.

## 9-slice

Buttons, panels, bars and frames are drawn with plain centres and their ornaments in the corners, so the engine can stretch them. After cutting, write each piece's margins (left, top, right, bottom in px) in `art/ui-slices.md`; the engine reads them into Godot's `NinePatchRect` patch margins, Phaser's `NineSlice`, or Unity's sprite borders.

## Check each sheet

- [ ] Every piece is whole; none is reported `touchesEdge` or `empty`.
- [ ] Next to the master, the material, outline, corners and light are the same.
- [ ] States of one piece line up when stacked.
- [ ] No text on any piece.
- [ ] Thin parts (a fishing line, whiskers) survived keying, and no stray specks sit around them; clean specks before the piece is used.
- [ ] At the size the game shows it, an icon still reads (64 px for HUD icons).

Then wire it in with `game-ui-hud`, and look at a game screenshot next to the master.
