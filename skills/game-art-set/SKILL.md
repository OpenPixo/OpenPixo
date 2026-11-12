---
name: game-art-set
en_name: Matching game art set
zh_name: 风格统一的游戏美术
description: Generate new sprites, animation frames, props, icons, tiles, backgrounds or 3D-model concept images that match the game's style reference, with one style sheet and a fixed prompt template per asset family. Use when a stage needs new art; not for planning's style samples, processing existing files or fixing pixel grids.
zh_description: 按游戏的风格参考图生成新的角色、动画帧、道具、图标、瓦片、背景或 3D 模型概念图：一份风格说明，每类素材一个固定的提示词模板。适用于某个阶段需要新美术时；不用于规划时的画风样图、处理已有文件或修像素网格。
triggers:
  - game art
  - matching sprites
  - consistent art style
  - generate sprites
  - style reference
  - 生成游戏美术
  - 风格统一
  - 生成角色图
  - 生成道具
  - 风格参考图
license: Apache-2.0
pixo:
  mode: utility
  category: game-assets
  design_system:
    requires: false
  example_prompt: Make the stage 2 art from the style reference — the slime enemy with idle and hop frames, coin, key and heart pickups, and a grass tile — list it with the credits first, then generate and wire it in.
  example_prompt_i18n:
    zh-CN: 按风格参考图做第 2 阶段的美术——史莱姆敌人（待机和跳动帧）、金币、钥匙和爱心拾取物、一块草地瓦片——先列出清单和积分，再生成并接进游戏。
---

# Matching game art set

Art made one prompt at a time drifts: each image picks its own light, view, outline and detail level. This skill makes every new image from the same three inputs, so a set looks like one game:

1. **The anchor:** the style reference image the user picked in planning, passed as reference image 1.
2. **The style line:** one sentence, copied word for word into every prompt.
3. **A family template:** a fixed prompt shape per kind of asset.

The media section of the system prompt owns how to call the tools: sizes, `--sheet` for small art, `--sheet --frames` for characters that move, `frames check`, and the art list and art card. Follow it. This skill only adds what goes into each prompt and how to check that the result matches the game. The user's choices and the approved plan come first.

## Quick path

1. **Find the anchor.** `pixo style get "$PIXO_PROJECT_ID"` shows the project's style reference; otherwise use the path named in the approved plan (usually under `concept/`). If there is none, ask the user to pick one existing image or to make style samples first; do not invent a style. Record the one they pick with `pixo style reference "$PIXO_PROJECT_ID" <path>`.
2. **Write or reuse `art/style-sheet.md`** (format below). Write it once per game; later stages read it and add only new families.
3. **Write the asset list:** one row per image or sheet with id, family, concrete features and output path. Show it the way the system prompt says (art list or art card, with credits) and wait.
4. **Make the first image of each family, check it, then the rest.** A wrong first image is cheaper to fix than a wrong set.
5. **Check every result** against the review list. Regenerate a failure with one change to the prompt; after two failed retries, stop and tell the user what is wrong.
6. **Wire the art in and see it in the game** next to the existing art (`pixo game verify --steps check,build,run --screenshot --json`, and a playtest for anything that moves).

## The style sheet

`art/style-sheet.md` holds only these fields, filled from the anchor and the plan:

```text
Anchor: concept/style-2.png
Style line: Hand-painted storybook style, soft gouache texture, warm light from the top left, thick dark-brown outlines, simple flat shading.
Avoid: photo realism, 3D render look, gradients on outlines, text, watermark, drop shadows.
View: side view (platformer); props and pickups face the camera
Palette: (only if the user set one) art/palette.hex
Heights: player 1.0, slime 0.6, door 1.6
Sizes: player 128x128, slime 96x96, pickups 64x64, tiles 64x64
```

To write the style line, look at the anchor and describe five things: medium or technique, texture, light direction, outline, shading. Write what you see, not mood words. Never add extra style words to a single prompt; when the style should change, the user changes the sheet. Pick sizes from the media section's size table and keep them in proportion to the heights row.

## Turn vague words into features

A weak prompt says how something should feel ("cute", "scary", "powerful"). A strong prompt says what is visible. Before writing a row, turn each mood word into 3–5 features of shape, proportion, colour or material:

| Word | Features |
| --- | --- |
| cute | head a third of body height, round shapes, short limbs, big eyes set low |
| scary | mouth too wide, pinprick pupils, long thin limbs, hunched pose |
| heavy / strong | wide base, small head, thick forearms, armour plates |
| magical | glowing core, floating parts, one accent colour used nowhere else |
| valuable | gold with one bright highlight, simple readable shape, small sparkle |

The features go in the asset row and in the prompt, after the subject.

## Family templates

Fill `<…>`, keep the rest as written. `<style line>` and `<avoid>` come from the sheet. Flags follow the media section; the ones shown are the usual ones.

| Family | Prompt | Usual flags |
| --- | --- | --- |
| Character design | `<subject>, <features>. Single character, full body, centered, <view>, facing right, idle pose. <style line> Plain flat background, no ground, no shadow, no text. Avoid: <avoid>` | `--image <anchor> --transparent --size <sheet size>` |
| Character state | `The same character as image 2, <state>: frame 1 <pose>, frame 2 <pose>, … Same proportions, colours and outline in every frame. <style line>` | `--sheet 3x2 --frames --image <anchor> --image <design> --transparent --size <sheet size>` |
| Small set (pickups, icons, small props) | `<what the set is>: <piece 1 + features>, <piece 2 + features>, … Each one whole, centered, <view>, bold readable silhouette. <style line> No text.` | `--sheet <grid> --names <a,b,…> --image <anchor> --transparent --size <piece size>` |
| Single prop | `<subject>, <features>. Single object, whole object visible, centered, <view>. <style line> Plain flat background, no shadow, no text.` | `--image <anchor> --transparent` |
| Tile / texture | `<surface>, <features>. Seamless tileable texture, top-down, flat even lighting, no perspective, no objects cut off at the edges. <style line>` | `--size <tile size>`, then `pixo asset seamless-check` |
| Background layer | `<place>, <features>. <far / middle> layer only, wide view, no characters, nothing in the foreground. <style line>` | `--background scene`; nearer layers `--transparent` |
| 3D concept | `<subject>, <features>. Front view, A-pose with arms 40 degrees from the body, legs slightly apart, whole body visible, plain light-grey background, even lighting, no shadow. <style line>` | Then `--surface model3d --image <concept>`; try `openpixo-model3d-draft` before a higher quality |

A new variant of an approved asset passes that asset as image 2 and describes only the change ("the same slime, but blue and twice as wide").

## Generating

Commands inherit `PIXO_PROJECT_ID`; otherwise add `--project <id>`. Paths are project-relative.

```text
pixo media image-models --json
pixo media generate --surface image --model <id> --prompt-file art/prompts/slime.txt --image concept/style-2.png --transparent --size 96x96 --output assets/enemies/slime.png --json
```

- Use the image model the user selected (`image-models`) and always pass the anchor with `--image`. Once the game has a style reference, a request with no `--image` is refused unless it says `--no-reference`; use that only for art meant to look different. On the art budget the host sends a request with `--image` to `openpixo-image-edit`, which takes up to 4 references (the anchor plus 3 approved images), whichever hosted model you named. If the model takes no `--image`, say consistency will be weaker, keep the style line and the design's description word for word, and review harder.
- Put each prompt in `art/prompts/<id>.txt`, so a retry or a later variant starts from the exact text.
- The project's installed art style is applied automatically; never pass `--style none` to get around it.
- A slow model returns a `taskId`: wait with `pixo media wait` instead of generating the same image again.

## Recipes and character cards

Some families have a recipe that already handles seams or layers: `tileset-seamless`, `parallax-layers`, `character-turnaround`, `model-from-image`, `pbr-texture`, `skybox`. Read `pixo recipe show <id> --json` for its inputs, then `pixo recipe run <id> --input <name>=<value> --wait --json`. A style input is often a fixed list: pick the option closest to the style sheet and put the features in the subject input. A recipe only stages candidates: review them below, then `pixo recipe adopt <runId> --candidate <id>`. Without a reference-image input a recipe cannot see the anchor, so compare harder.

Once a character is approved, save it as a card so later turns describe it the same way: `pixo character create <slug> --name "<name>" --description "<features>" --reference <approved image>`.

## Review every result

Open the image when you can see images. Otherwise judge from the reply's facts below and ask the user to look at the first image of each family.

- [ ] Next to the anchor and the other approved images, it looks like the same game: light direction, outline, texture and detail level.
- [ ] The whole subject is visible and centred in the sheet's view; no piece is marked `touchesEdge` or `empty` in `file.pieces`.
- [ ] Cutouts report `transparent: true`, with no stray shadow, ground patch, frame, text or watermark.
- [ ] Size matches the sheet and height matches the heights row.
- [ ] Every feature in the row is visible.
- [ ] Animation frames: `pixo asset frames check <frames in order...> --json` reports `ok`, or its issues are deliberate (a crouch is meant to be shorter).

If it fails, change one thing in the prompt (usually a missing feature or a stronger "no …") and regenerate. Do not paint over or crop a bad image to save it; `frames align` is for frames that are right but placed unevenly.

## Pitfalls: wrong → right

| Wrong | Right, and why |
| --- | --- |
| New style adjectives in each prompt | One style line, word for word; extra words pull each image a different way |
| "A scary toy soldier" | List visible features; the model cannot draw a feeling |
| Six pickups as six calls | One `--sheet` with `--names`, which costs one image |
| Several unrelated assets in one prompt without `--sheet` | `--sheet` lays out and cuts the grid; a free-form group image loses edges and sizes |
| Generating the whole list, then looking | First image of each family, check, then the rest |
| A character state without the design as image 2 | Pass the design, or every state shows a slightly different character |
| Characters with different sizes on screen | Use the heights row and the sheet's sizes, then check them in the game |
| Arms down on a 3D concept | A-pose at 40°; arms against the body fuse in the 3D model |

## Done when

- [ ] `art/style-sheet.md` exists and every new prompt in `art/prompts/` uses its style line.
- [ ] Everything on the approved list was generated, reviewed and placed at its path; anything that failed review twice is named for the user.
- [ ] The art is wired into the game; a screenshot shows it next to the existing art, and anything that moves was watched in a playtest.
- [ ] The reply says what was made, how many credits it used and what is still missing.
