---
name: game-key-image
en_name: Game key image
zh_name: 游戏效果图
description: Make the game's key image first, one believable gameplay screen that becomes the style master, then grow the style bible, UI kit and UI components from it. Use for planning's style samples, for a new area or a changed look before its art is made, for the game's UI art, and when the user names a game whose look they want.
zh_description: 先做游戏的效果图：一张像真实游戏画面的图，作为风格母版；再从它延展出风格圣经、UI 规范板和界面组件。用于规划时的画风样图、新区域或新画风开始做美术之前、游戏的界面美术，以及用户说想要某个游戏那样的画面时。
triggers:
  - key image
  - style sample
  - style master
  - game screenshot mockup
  - UI kit
  - look like a real game
  - 效果图
  - 画风样图
  - 风格母版
  - 游戏界面美术
  - 像真的游戏
license: Apache-2.0
pixo:
  mode: utility
  category: game-assets
  design_system:
    requires: false
  example_prompt: Make 3 key images of the confirmed game, each in a different look with the same screen layout, and ask me to pick one as the style master.
  example_prompt_i18n:
    zh-CN: 为已确认的玩法做 3 张效果图：画面布局相同、画风不同，让我挑一张作为风格母版。
---

# Game key image

The key image is a screenshot of the finished game, made before the game exists. It is the **style master**: every later image is made with it as image 1, and its **Style DNA** is pasted word for word into every prompt.

Asked for "a game", an image model draws key art: a poster with a big hero, dramatic light and detail everywhere. A gameplay screen has a fixed game camera, characters at play size, a world built from repeated pieces, a clear play layer in front of a quieter background, and a HUD. This skill writes each request so the model draws the screen, and tests each result the way a player would see it.

The user's words, the confirmed one minute of play and Game setup come first. The system prompt's media section owns tools, sizes and paying; the planning section owns how many images planning may make and how the pick is recorded.

| File | Read it |
| --- | --- |
| [references/looks.md](references/looks.md) | At step 2: the looks, their installed styles and how to choose candidates |
| [references/screen-layouts.md](references/screen-layouts.md) | At step 3: build methods, HUD rules, each genre's screen, the other screens |
| [references/prompt-templates.md](references/prompt-templates.md) | Before every prompt: the Style DNA, the templates, the Avoid block, text rules |
| [references/ui-kit.md](references/ui-kit.md) | At step 6: UI component groups, states, sheets and 9-slice |

**When each part runs.** Planning (read-only) runs steps 1–5, within the planning image cap. The first stage that makes art runs step 6 before anything else. A new area or a changed look runs steps 3–5 with the master as image 1, saved as `concept/key-<area>.png`, and `game-art-set` makes its parts.

## Steps

1. **Read the inputs:** the one minute of play, Game setup (perspective, display, controls, languages), the user's art words, any picture they attached and any game they named.

2. **Read the brief and pick the candidates** ([looks.md](references/looks.md)). Most briefs are one line. The user pictures the screen most players know, at its busiest and most typical. Before any prompt, write down:
   - the play area's shape (wide field, tall field, board, room, track, stage);
   - what fills it at a full moment, in the genre's own unit (enemies, bullets, notes, buildings, terrain and hazards, cards, rivals), with counts;
   - the three HUD items its players check most, or "almost none";
   - for a named game or a look word, what a fan names first about its rendering: light, outline, colour, texture.

   Say the reading in one line of the reply, so the user can correct the words rather than the picture. An attached picture is the strongest reference: take its camera, scale and rendering, never its characters or places.

   Then the candidates:
   - Every candidate keeps what the user's words fix: 复古 stays retro, 水墨 stays ink wash, a named game keeps its look, and a named game's camera beats Game setup's.
   - They differ in rendering method (pixel, painted, cel, 3D) where the words allow. When the words fix the rendering, the second is the same look at another time of day or in other weather, lit by the scene's own lights, with every object keeping its colour; a scene with no sky shows another area instead. Never vary only the palette, pixel size or outline weight: the model draws those the same.
   - A genre-only brief gets the look most players picture for that genre, plus Game setup's style. A series whose look changed across eras offers its best-known eras.
   - When the words contradict Game setup's style, the words win and the reply says so.

3. **Lay out the screen** ([screen-layouts.md](references/screen-layouts.md)). Pick the build method an engine would use, then the genre's screen zone by zone: what, where, how big. When combat has its own screen, the sample shows the screen Game setup's perspective describes, where the player spends most of the game; the other screen comes later from the master.
   - **The moment** is the main verb under way, some way into a good session, when the screen is as full as this game gets.
   - **Quantities are content, not mechanics:** show as many enemies, crops, buildings, rivals or notes as the genre's screen shows, and the readouts it always shows (level, clock, minimap, turn order). Leave out only a new kind of thing the plan lacks.
   - **Invented gameplay keeps the genre's signature.** If you invented the one minute of play, it keeps what makes the genre recognisable (the avatar on the farm, the rivals in the race); if it lost that, fix the gameplay first.
   - **Describe every actor** by visible features (build, hair or hat, clothes, colours).

   All candidates share this layout.

4. **Write one Style DNA per candidate** ([prompt-templates.md](references/prompt-templates.md)): 60–120 English words, built from the candidate's installed style. The signature a fan names first goes in at full strength, never as "restrained" or "subtle", on the play layer, while the background steps back. A DNA is never reworded once written.

5. **Make the key screens.**
   - **Generate:** fill template 1 with the shared layout and each DNA, at full size (`--size 1536x864` for 16:9) with `--background scene` and `--style none`. Send each prompt on stdin with `--prompt-file -`, and save it as `concept/style-<n>.png`.
   - **Use only the user's pictures as `--image`:** never another candidate, or the user compares one look twice.
   - **Test and retry:** run the screenshot test. A failure gets one change and one retry; after a second failure, show the image and say what is off.
   - **Show the candidates:** list them by path, one line each: the look, the released game it would pass for, and its weakest point. Recommend the one closest to what the user's words picture, never the one cheapest to build.
   - **Changes and the pick:** a requested change is an edit with the picked image as `--image`, saved as the next version. Record the pick as the planning section says.

6. **Grow the set from the master** (after approval):
   - Write `art/style-bible.md` first, with the picked DNA word for word.
   - Then make the UI kit and component sheets ([ui-kit.md](references/ui-kit.md)) and the other screens the stage needs. Each prompt passes the master as `--image`, is saved in `art/prompts/<id>.txt`, and is checked before the next one.
   - These follow the art list and the art card; this skill adds no approval of its own.

7. **Report** what was made, by path, what failed or is missing, and what it cost.

## Camera table

A 2D engine draws with no perspective, but an image model draws like an illustrator: angled camera, receding ground, buildings turned to show a side. So the camera words state the engine's projection outright.

| Perspective | Camera words | Default view and player size |
| --- | --- | --- |
| `top-down-2d` | top-down oblique projection like a 2D tile engine: the camera tilts down from the front at a fixed high angle; the ground is flat like a map; buildings and objects face the viewer, showing their front and more of their top; characters are seen from the same height, top of the head visible, short bodies, each on a small contact shadow; vertical edges vertical, no side walls, no vanishing point, the same size at the top and bottom of the screen | about 20 tiles across; the player 1.5 tiles tall |
| `side-2d` | flat orthographic side view like a 2D platformer engine: platforms seen exactly from the side with a thin top edge; background layers are flat cut-outs behind | about 20 tiles across; the player 1.5–2 tiles |
| `isometric-2d` | isometric 2:1 projection on a diamond grid, fixed camera, parallel edges; characters seen from the same angle, facing along a diagonal, feet on a tile centre | about 1/10 of the screen height |
| `hd-2d` | 2D sprites on a 3D diorama stage, tilted fixed camera, soft focus only at the top and bottom edges | about 1/8 |
| `ui-2d` | flat screen layout: panels, cards or boxes over one backdrop; a battle stage that sets fighters near and far keeps that shallow depth (the near one larger, lower left, from behind; the far one smaller, upper right), with the HUD flat | portraits, half the screen at most |
| `third-person-3d` | third-person perspective camera a few metres behind and above the player, looking slightly down; the ground fills the lower half and recedes | about 1/3 for a character, 1/5 for a vehicle |
| `first-person-3d` | first-person view, the held item lower right | held item only |
| `top-down-3d` | high three-quarter 3D camera, fixed angle | about 1/10 |

The sizes are defaults; a genre that frames the player differently keeps its own ([screen-layouts.md](references/screen-layouts.md)). A 3D moment keeps the player on the ground with the ground receding: a player in mid-air against open sky reads as an illustration.

## The screenshot test

Look at the image at the size it was made. It passes when every line holds:

- [ ] Someone scrolling a store page would take it for a capture from a released game, and a fan of what the user named would say "that kind of look".
- [ ] One camera, the table's, over the whole image: ground, buildings and characters share it, and nobody looks pasted on.
- [ ] The player is the size this genre shows; other actors and doors are in proportion.
- [ ] It is as full as the genre's screen at this moment, and the play area has the genre's shape.
- [ ] The world is visibly built the way its method says (repeated tiles, layers, a stage, a kit of models), and it is clear where the player can walk.
- [ ] The HUD follows the HUD rules in [screen-layouts.md](references/screen-layouts.md): bare, in the world's own rendering, not the loudest thing on screen.
- [ ] Shrunk to a grey thumbnail, the player, the threats and the walkable surfaces are the clearest shapes; everything is sharp, with no photographic blur or lens vignette, and the screen is not a centred hero or a mirrored stage.
- [ ] It is lit, not evenly grey: the play area is the brightest part, the background steps back, and large surfaces are calm while props and edges carry the detail. Evenly detailed texture everywhere is what users call "ugly" next to the game they named (鸦堡 run, 2026-11-20).
- [ ] Only the text the prompt gave is readable; nothing else looks like garbled writing.

Images grown from the master also match it: colour, outline, material, light direction and UI frames.

## Iterating

- Change one thing per retry.
- When an actor or the play field comes out the wrong size, the retry gives its box in pixels ("fits inside x 655–885, y 605–755"). A player already at a size this genre's games use is kept, not shrunk to match the table.
- A new version is saved as `-v2`, `-v3`; nothing is overwritten.
- A whole new look keeps the layout and gets a new DNA and key screen; the old master stops being a reference.

## Rules

- **Original work only.** From a named game, take its look and its genre's rules, never its characters, creatures, places, logo, title, terms or HUD copied element for element.
  - Prompts name a platform and era, never a title.
  - Moves, items, places and creatures get new names and designs of the user's own. Design each creature and character so a fan could not name the original it resembles: avoid the named game's usual recipe (a common animal in the series' colours, its signature body features), and give each an unexpected body plan, material or colour.
  - Keep one visible thing that is the user's own, and say in the reply what differs from the original.
  - A style word (HD-2D, 吉卜力, 黏土) gives rendering only. A named game's signature mechanic is offered in the gameplay step, never put in silently.
- **No faking.** A failed generation is reported as failed, with its prompt kept; nothing is faked with placeholders.
