# Prompt templates

Prompts are in English; only the words that must appear on screen are in the game's language. Each prompt is one block in the labelled shape below, so the model keeps layout, look and text apart. The Style DNA is pasted whole.

## Style DNA

60–120 words, in this order:

1. The look in one phrase.
2. **Colour as a player sees it:** saturation and contrast, the two or three colours that dominate, what glows. No HEX codes: the model paints the whole scene from a list of swatches. A palette the user set is the exception and goes in as HEX. Large areas (ground, walls, sky) are a calmer, hue-shifted version of the main colour; full saturation is for characters, pickups, water, flowers and lights.
3. **Material and light.**
4. **Shape and outline:** characters, creatures and interactive props carry the outline; terrain tiles have none, or a thin edge of their own colour.
5. **UI frame language** for menus and panels, at the world's pixel size or outline weight, and the in-play HUD as bare icons, bars and numbers in that outline.
6. Detail level, then "consistent across every screen, sprite and UI component".

The signature a fan names first goes in at full strength ("strong rim light", "neon signs reflected on wet ground"). Never write it as "restrained", "subtle" or "soft".

> Style DNA: 16-bit pixel art game, one shared pixel size, 16 px terrain tiles that join seamlessly. Colour: bright and saturated with clear contrast; calm grass greens and warm sand on the ground, full saturation kept for characters, flowers and pickups; deep teal-green shadows. Flat colour clusters with two-step shading, warm afternoon light from the top left. One-pixel dark navy outline on characters and props, none on terrain. Cream pixel-bordered panels with a chunky pixel font for menus; the HUD is bare pixel icons and numbers. Low detail on ground, detail saved for characters. Consistent across every screen, sprite and UI component.

## Avoid block

Add to every prompt, trimming what does not apply:

```text
Avoid: poster, key art, concept painting, illustration framing, centred hero, symmetrical composition, centred landmark, an empty side of the screen, mobile game UI, buttons on top of the scene, bevelled icon tiles, depth of field, lens flare, photographic lighting, photographic lens vignette, the same texture over every surface, flat even lighting, garbled or misspelled text, logos and trademarks, characters or UI copied from existing games, perspective camera, vanishing point, receding ground, buildings showing a side wall, objects shrinking toward the top, mixed pixel sizes, grid lines drawn over the ground, watermark.
```

Exceptions:

- **3D perspective:** drop the camera words (from "perspective camera" to "objects shrinking"). Add "flat 2D illustration, cartoon drawing on a flat background". The DNA says the frame is rendered by a real-time 3D engine.
- **Neon, synthwave or sci-fi look:** keeps its glow and bloom.
- **HD-2D or tilt-shift look:** drops "depth of field". It asks for blur on the top and bottom edges, with the play area sharp.

## 1. Key screen (the style master)

```text
Asset type: final in-game screenshot of a <genre> video game, captured during play, used as the style master for all of the game's art
Game: "<title>", <the game in one sentence>, <platform and era, e.g. "a 2024 indie PC game">
Format: horizontal 16:9 desktop game screen, full-bleed, no device frame, no window chrome
Camera: <camera words from the camera table>
<Style DNA>
Moment: <the main verb under way, some way into a good session>
Density: <what fills the screen in the genre's own unit, with counts and where they sit>
Characters: <the player's visible features>; <each other actor's features>
Scale: <the genre's camera distance: tile size and tiles across, the player's height in tiles and as a pixel box, compared with something on screen (a door, a HUD slot)>
World: <the world in its build method's terms, from screen-layouts.md; where the player can walk>
HUD (drawn on the scene in the world's own art, bare icons, bars and numbers with an outline or glow, no box behind any corner):
- Top left: <...>
- Top right: <...>
- Bottom: <...>
Text (render exactly and only these): <up to 8 short strings separated by " | ", without quotes, e.g. Day 1 | 48 | [E] Fish>
Quality: polished released game, crisp edges; light with a time of day and a direction, soft shadows cast the same way, cool shadows and warm highlights; the scene's own lights pool on the play area so it is the brightest, warmest part of the screen, and lamps, fire and magic carry a soft painted glow; everything sharp; readability order: the play layer (walkable surfaces, characters, attacks, pickups) has the highest contrast and cleanest shapes, the background steps back in value and saturation with simpler, larger shapes and a little atmospheric haze, the ground is quiet repeated tiles or a smooth surface with soft shading; detail sits on props, edges and silhouettes, never as texture over every stone and plank; outlines are heaviest on characters and the foreground and thin out with distance
<Avoid block>, multiple screens in one image, wireframe, design annotations
```

Filling it in:

- **Density.** Over about 30 of one thing goes in separate groups, each with its count and place. Paired things (doors, enemies, buildings) differ in size, height or side; nothing appears twice at mirrored positions. Props sit in clusters with quiet ground between them, never one per spot across the screen. Small decorations come in a few groups. The layout leads the eye to where the moment happens.
- **Scale.** The model draws actors about 1.5 times larger than asked, so ask for less. Give a pixel box (at 1536×864, a 48 px tile is a common start). Compare sizes with something on screen.
- **Candidates.** They keep every line but the DNA (and the World line, if their look builds the world another way). No candidate is passed to another as an image.

## 2. Area key image

Template 1, with `Input images: Image 1: style master — match its camera, scale, colour, outlines, materials and HUD exactly` first, `Asset type: final in-game screenshot of the same game in a new area`, and the new area's Moment and World lines. The HUD lines are copied from the master's prompt.

## 3. Other screen (title, pause, shop, inventory, results, battle)

```text
Input images: Image 1: style master — match its colour, materials, panel frames, buttons, font style and icons exactly
Asset type: the <screen> screen of "<title>", same game as Image 1
Format: same as Image 1
<Style DNA>
Layout: <zones from screen-layouts.md, made concrete>
Text (render exactly and only these): <title and button words>
<Avoid block>, a different art style from Image 1
```

## 4. UI kit board

```text
Input images: Image 1: style master
Asset type: game UI kit presentation board for "<title>", in exactly the style of Image 1
Format: horizontal 16:9, a plain backdrop that suits the look, items on a tidy grid with clear gaps
<Style DNA>
Sections: colour swatches with their HEX; buttons in normal, hover, pressed and disabled; a large panel, a popup with a title bar and close button, a dialogue box with a name plate; health and progress bars, empty and full; 8 item or function icons; slot frames in 5 rarities; tabs, a toggle, a slider, a checkbox; key and gamepad prompt glyphs
Text: the board title "<title> UI" only
<Avoid block>, a full game screen
```

## 5. Component sheet

```text
Input images: Image 1: style master — match its materials, bevel, outline and light exactly
Asset type: game UI component sheet for slicing, group: <group>
Pieces, in reading order: <1) ..., 2) ..., ...>
Arrangement: one piece per cell, whole, centred, front-facing, with wide empty margins; nothing touches a neighbour or the edge
<Style DNA>
Rules: states keep the same outline and size and change only colour, brightness or glow; buttons, panels and bars have plain centres for 9-slice stretching
Text: none
<Avoid block>, any text, glow bleeding into neighbours, background scene, cropped pieces
```

Generate with `--sheet <cols>x<rows> --names <a,b,...> --transparent --size <piece size> --image <master>`; the host cuts and keys the cells. One sheet holds 4–12 pieces.

## 6. Single component

Template 5 for one piece: `Asset type: one isolated game UI component: <name and use>, state <state>`, `Composition: centred, about 80% of the canvas, front-facing`.

## Text on images

- **What gets rendered.** Only the strings given, up to 8. A HUD the genre reads in numbers (tactics HP, moves left, race position) gets them.
- **Length.** Chinese, Japanese and Korean strings are six characters or fewer, except one dialogue or message sentence of up to 12. Real text is typeset in the engine.
- **Type.** HUD type is the world's type: a pixel font in pixel looks, a bold face with the characters' outline elsewhere. Never ask for text "at least N px": it makes the HUD shout.
- **Components and sheets** carry no text. A logo the model cannot spell is "a stylised logo emblem, no readable letters", and the report says the logo still needs making.

## `art/style-bible.md`

Written once after approval:

```text
Master: concept/style-<n>.png
Look: <row from looks.md>
Camera: <camera words>; player height <share>
Palette: <role> <HEX>, ... (read from the master)
Material and light: ...
Shape and outline: ...
UI frame language: ...
Text: in-engine font <name or kind>
## Style DNA
<the DNA, word for word as used for the master>
```
