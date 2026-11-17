---
en_name: Dialogue boxes
zh_name: 对话框
---

# Dialogue boxes

Part of the game-ui-hud skill; read its SKILL.md first. The game's style reference, the confirmed plan and the parent's look rules decide the panel, frame and font. This file decides how dialogue is laid out, paced, advanced and skipped. Colours named below are roles (speaker, emphasis, choice), filled from the game's palette.

## Decide first

| Question | Default |
| --- | --- |
| Box, speech bubble or subtitle? | A bottom box for conversations; bubbles over characters for short barks while play continues; subtitle lines for voiced or cinematic scenes |
| Portraits? | Only if the game has portrait art or the plan includes it. Otherwise the speaker's name, and the speaker highlighted in the world |
| Does play stop? | Conversations stop player control; barks never do |
| Choices? | Only where the script branches; two to four options |
| Where does the text live? | In data (JSON, a resource, Ink or Yarn if the project uses one), never inline in scene code, so it can be translated |

You decide layout, pacing, the advance and skip rules, and the data format when none exists. Ask first before branching dialogue, a relationship or affinity system, or voice lines are added: those change the game, not its presentation.

## Readable at a glance

- **Bottom box, full width minus margins**, about a quarter of the screen height. Three lines at most per page; 45–75 characters per line. The box never covers the speaking character if the camera can avoid it.
- **The speaker is obvious**: a name tag on the box's top edge, a portrait on the speaker's side, or the character highlighted. Colour per speaker is optional and never the only cue.
- **Typewriter at 30–60 characters per second**, with a short pause after `.`, `?`, `!` and `,`. A blip sound every 2–3 characters, pitched per speaker, is the convention; respect the game's sound volume.
- **One press completes, the next advances.** Pressing during typing shows the full page at once; pressing on a full page goes to the next. A held button never auto-advances through pages the player has not seen.
- **An advance marker** (a bouncing arrow or icon) appears only when the page is complete.
- **Skip and auto.** A separate button skips the whole conversation in story-heavy games; text speed is a setting. Already-read lines can be fast-forwarded.
- **Choices** are text items with the same selection style as menus, the first non-destructive option preselected; the chosen line is echoed or the box closes, so the player knows it registered.
- **Readable over anything.** The box has a backing from the art at 80–90 % opacity; text contrast at least 4.5:1. Leave 30–40 % room for longer translations, and wrap by measured width, not character count, for CJK.

## Build it

One dialogue runner owns the current line, page, typing progress and input. It pauses or restores player control through the existing owner, and emits an event when a line or conversation ends.

- **Godot 4:** a `PanelContainer` in the UI `CanvasLayer` with a `RichTextLabel`. Typewriter by increasing `visible_characters` (or `visible_ratio`) from a timer; `get_total_character_count()` gives the end. Use `autowrap_mode = TextServer.AUTOWRAP_WORD_SMART`. Read lines from a JSON or `Resource`; use `tr()` keys if the project is localised.
- **Phaser 3:** a `Text` (or `BitmapText` for pixel fonts) with `wordWrap: { width, useAdvancedWrap: true }`; compute pages by measuring with the final string, then reveal with `text.setText(full.slice(0, n))` from a timed event. Lock input on the gameplay scene while the dialogue scene is active.
- **Unity 6:** `TextMeshProUGUI` with `maxVisibleCharacters` stepped in a coroutine; `textInfo.characterCount` after `ForceMeshUpdate()` gives the end, and `pageToDisplay` with Overflow Mode Page handles pages.
- **Web and Three.js:** a `<div>` in the HUD layer; build the page's full text once, wrap by width, then reveal with a `<span>` per character or by slicing. Use `aria-live="polite"` on the full page, not on each character.

Reveal by character count measured on the final page layout, so words do not jump to the next line mid-word as they appear.

## Verify in a playtest

After the parent's `pixo game verify` step, start a conversation, press during typing, then advance:

```json
[
  {"wait": 500},
  {"key": "e", "press": true},
  {"wait": 150},
  {"capture": "typing"},
  {"key": "e", "press": true},
  {"wait": 100},
  {"capture": "completed-page"},
  {"key": "e", "press": true},
  {"wait": 600},
  {"capture": "next-page"}
]
```

Use the game's interact binding. Check: the first press completes rather than skips, the longest line fits in three lines at the smallest target resolution, choices work by keyboard and controller, the player cannot move during a conversation, and a restart mid-conversation leaves no box behind. Godot capture injects no input and Unity has no capture; play those by hand.

## Common mistakes

| Wrong | Right |
| --- | --- |
| A press during typing skips to the next line | First press completes, second advances |
| Words jump to the next line as they type out | Wrap on the final page, then reveal |
| Text hard-coded in scene scripts | Lines in data the localisation can reach |
| Holding the button races through unread pages | Advance only on new presses |
| Player can walk away mid-conversation | Control paused by the runner, restored at the end |
| Branching and affinity added to "improve" dialogue | Presentation only, unless the plan asks for branching |
