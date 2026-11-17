---
en_name: Title screens
zh_name: 标题画面
---

# Title screens

Part of the game-ui-hud skill; read its SKILL.md first, especially "Title and start screens", which sets the look: art leads, the logo is art, menu items are text, something moves. The game's style reference and the confirmed plan decide the art and palette. This file is the build method: the layers, the order things appear, the menu's logic and how to check it.

## Decide first

| Question | Default |
| --- | --- |
| Press-start screen? | Only on consoles or when there is a save to load and an intro to play. A web or desktop game goes straight to the menu |
| Menu items | Continue (only when a save exists), New Game, Settings, Quit (desktop only; never in a browser) |
| Intro | A logo reveal of 1–2 s that any input skips. No studio splash unless the user asks |
| Music | The title theme starts with the first visible frame, at the game's music volume setting |
| Key art and logo | Existing project art. If there is none, list what is missing with its cost and ask before generating |

You decide the layer stack, timings, menu order and transitions. Ask first before adding a save-slot screen, an attract-mode demo, a credits roll or new art.

## Compose the screen

Write the composition down before building, in one line per layer, back to front:

1. **Background**: the world or a scene, filling the frame at every aspect ratio (cover, not contain; crop the edges, never letterbox the art).
2. **Mid layers**: one or two parallax layers or the characters, which carry the idle motion.
3. **Logo**: the largest element, usually in the upper third or on the side opposite the characters.
4. **Menu**: three to five text items, in a lower third or under the logo, aligned to one edge or centred, never boxed.
5. **Corner**: version or build number, small, in the safe margin.

Keep a quiet area behind the menu: darken or blur only that region of the art, not the whole screen.

## The order things appear

| Time | What happens |
| --- | --- |
| 0 ms | Background visible, music starts. Never a blank or white frame first: preload title assets before the scene draws |
| 0–800 ms | Logo reveals (fade and scale from about 90 %, or a slide); parallax already moving |
| 600–1000 ms | Menu items fade in, top to bottom, 60–80 ms apart |
| Any input | Skips straight to the finished state and selects the first item |

Selecting an item plays the confirm sound, gives a short flash or scale on that item, and fades to black (200–400 ms) before the next scene loads. Back from Settings returns focus to Settings.

## Build it

- **Godot 4:** a `Control` scene with `TextureRect`s set to `STRETCH_KEEP_ASPECT_COVERED` for the background, `Parallax2D` or animated nodes for layers, and a `VBoxContainer` of flat `Button`s with a theme that removes the box and styles focus. Animate the entrance with one `Tween` chain; `grab_focus()` on the first item when it appears. Hide Quit on the web export (`OS.has_feature("web")`).
- **Phaser 3:** a `Title` scene that loads its assets in the `Boot` or `Preload` scene so `create` draws the full frame at once. Size the background with `Math.max(width / img.width, height / img.height)` for cover. Text items with one shared selection index; keyboard, gamepad and `pointerover` all set it. `this.cameras.main.fadeOut(300)` then start the next scene on `camerafadeoutcomplete`.
- **Unity 6:** a Canvas with the background `Image` and an Aspect Ratio Fitter set to Envelope Parent, TextMeshPro buttons with transparent target graphics and a colour or scale transition, `EventSystem.firstSelectedGameObject` set to the top item. Hide Quit under `#if UNITY_WEBGL`.
- **Web and Three.js:** the 3D scene itself can be the background (a slow orbit). The logo is an image or a web font loaded with `document.fonts.load` before the overlay shows. Menu items are `<button>`s styled as text; focus the first on show.

Continue is shown only when the save owner reports a save; it loads that save, not a new game. New Game over an existing save asks once.

## Verify in a playtest

After the parent's `pixo game verify` step, capture the very first frames, the settled screen and a skip:

```json
[
  {"capture": "first-frame"},
  {"wait": 1200},
  {"capture": "settled"},
  {"key": "ArrowDown", "press": true},
  {"wait": 150},
  {"capture": "second-item"},
  {"key": "Enter", "press": true},
  {"wait": 600},
  {"capture": "after-select"}
]
```

Check: no blank first frame, the logo is the largest element, the selection is visible and moves, the art covers the frame at 16:9 and a narrow window, and with and without a save the Continue item is right. Then compare the settled frame with the composition you wrote down; if it could pass for a website's hero section, it is not done. Godot capture injects no input and Unity has no capture; play those by hand.

## Common mistakes

| Wrong | Right |
| --- | --- |
| Background letterboxed or stretched | Cover the frame and crop edges |
| A white or empty frame before the art loads | Preload, then draw the full frame at once |
| Quit in a browser build | Hide it on the web |
| Continue starts a new game, or appears with no save | Shown only with a save, and loads it |
| The intro cannot be skipped | Any input finishes it |
| A whole-screen dark overlay to make the menu readable | Darken only the region behind the menu |
