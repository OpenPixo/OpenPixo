# Key image first

Status: 2026-11-20. Read before changing the art step of game planning (`renderGamePlanBlock`), `skills/game-key-image` or how `skills/game-art-set` uses the style reference.

## Problem

A game OpenPixo builds often looks like a picture with a character pasted on, not like a game. The cause is the first image. The style sample the user picks becomes the style reference, and every later image is made from it. Before this change, nothing guided how that image was made: `game-art-set` excluded "planning's style samples", and the art step only said to draw "the same mock gameplay screen" in each style. Asked like that, the image model drew key art: a poster with a large central character, dramatic light, soft focus and unique detail everywhere. That look then spread to every asset and level.

A top-down tutorial run (2D, Godot, Codex) showed the chain:

1. The samples were posters, and both were variants of the setup's cartoon style, because the setup's style seeded every sample.
2. The stage's art copied the picked poster, including each area as one painted picture.
3. The style changed three times after stage 1, and each change remade 21 images.

Codex is not the cause. Its image hop passed the prompts on faithfully, and the same model drew plain, game-like pieces when the request was written like a game's.

## Decision

The key image comes first and is made with care: `skills/game-key-image`.

- **What it is:** a screenshot of the finished game in play, made before the game exists. It has the game's fixed camera, characters at play size, a world built from pieces that repeat, even light, everything sharp, and a HUD.
- **Where it is used:** for planning's style samples (each sample is one key image in one candidate look), and before the art of a new area or a changed look.
- **How it is made:** the skill pins down which look the user means (a named game's era and platform, or an attached screenshot), writes one shared brief (camera, moment, scale, world, HUD), writes each prompt from a fixed template, and runs a screenshot test on each result before showing it.
- **What it feeds:** the picked key image is the style reference, and `game-art-set` makes each area's parts to add up to its key image.
- **Round one shows different looks:** Game setup's style makes one sample and the others use other looks. Every sample passes `--style none`, because its Style DNA carries the look.
- **Built the way the engine would build it:** each sample's world is described in the terms of the build method an engine would use for that game and look (tile map, painted layers, rooms, sprites in 3D, 3D kit, UI screen). No look is ruled out.

## Changed

- `skills/game-key-image/` (new), built like a UI suite: the key screen is the style master, and a Style DNA paragraph written for it is pasted word for word into every later prompt. After approval the set grows from it: `art/style-bible.md`, a UI kit board, UI component sheets and the other screens, each made with the master as image 1. It has four references:
  - `looks.md`: looks mapped to the installed styles, with their UI frame language.
  - `screen-layouts.md`: zone-by-zone gameplay screens per genre.
  - `prompt-templates.md`: the labelled templates and the Avoid block.
  - `ui-kit.md`: component groups, states and 9-slice margins.
- `packages/contracts/src/prompts/openpixo-game.ts`: step 2 makes each sample a key image with the skill; the setup style seeds one sample, not all.
- `skills/game-art-set/SKILL.md`: points style samples and key images to the new skill; a new area or look starts with its key image; the style line is the style bible's Style DNA.
- `skills/game-ui-hud/SKILL.md`: HUD pieces come from the UI kit.

## How we know it works

Run a fresh top-down game and a fresh side-view game, each with a beginner's answers and a named reference game. It works if:

- every sample passes the skill's screenshot test, and a viewer takes it for a capture from a released game;
- the user settles the look within two rounds;
- the stage-1 screenshot looks like the picked key image.

## First test (2026-11-20)

Ten key screens made by hand from the templates, on the Codex image model (GPT-6.1-Sol). This tests the templates, not whether OpenPixo's agent follows the skill. Every screen passed the store-page test, with every HUD string spelled exactly.

- **Looks:** three looks of the 禁钓区 night-fishing screen.
- **Game types:** a side platformer, a card battle, an isometric builder and a third-person 3D game.

What the test changed in the skill:

- **Grid lines:** a look that said "visible tile grid" got grid lines drawn on the ground. Looks now say tiles "join seamlessly", and the Avoid block names grid lines.
- **Red cap:** an undescribed hero came back in a red cap. The brief now has a Characters line.
- **Illustrator's camera:** "three-quarter top-down" gave an angled camera with receding ground. The 2D camera rows now state the engine's projection: front-facing, no perspective, no side walls.
- **Characters too big:** sprites come out about 1.7 times the asked size. The Scale line now asks for a zoomed-out view in tile pixels with sizes compared against on-screen objects, which brought the player from 1/6 to about 1/7.5 of the screen height.

## Agent test (2026-11-20)

An isolated OpenPixo running this change planned 禁钓区 with the same setup answers on the user's Codex (GPT-6.1-Sol). The agent loaded `game-key-image` without being asked. It wrote every prompt in the template's shape, checked its own results and fixed character size with an edit.

Its first round was weaker than the hand-made tests, for three reasons, all now fixed:

- **A second style on top:** a sample passed `--style <id>`, so the host appended the installed style's own prompt, palette and "no text" list after the Style DNA. Samples now pass `--style none`, and the DNA is built from the installed style.
- **A shrunk render:** `--size 960x540` shrank the render and led the agent to size the world for a small screen. Samples are now made at 1536 by 864.
- **Look-alike candidates:** all three candidates were clean-cartoon looks with nearly one palette. Candidates now come from different families, each with its own palette.

The second round, after the fixes, matched the hand-made quality: a real night lake, small sprites, an engine-style projection and a consistent HUD.

A UI kit board, a button sheet and an icon sheet made from the picked master matched its frames, palette and icons. The sheets came back transparent, in order and inside their cells. Two gaps were added to `ui-kit.md`:

- **Secondary button:** it looked like the primary, so the buttons row now says how it differs.
- **Thin parts:** stray specks were left around them after keying, so the sheet check now looks for them.

## Harness or setup? (2026-11-20)

Same game, same user message, isolated test app.

**Harness.** One fixed agent-written prompt went four ways:

| Path | Setup style added | Size | Result |
| --- | --- | --- | --- |
| Straight to Codex | no | full | game-like |
| OpenPixo's pipeline | no | 1536 by 864 | the same quality |
| OpenPixo's pipeline | yes (chibi-cute) | 1536 by 864 | the same quality |
| OpenPixo's pipeline | no | 960 by 540 | the same quality |

With a good prompt, the pipeline does not change the result.

**Setup.** The agent made samples under three setups:

| Setup | Result |
| --- | --- |
| Chibi-cute with the art note | game-like |
| No style and no note | game-like, but one candidate came out pale and read as daytime |
| The 16-bit pixel preset | three near-copies |

In every setup the user's own words ("干净圆润") decided the first candidate; the preset only changed which families were offered.

The pixel run's copies came from the agent passing its first candidate as `--image` to the next two, not from the preset. The skill now makes each candidate from its prompt alone.

## What makes a screen read as a game

The screen that looked most like a game built its world the way a tile engine would:

- a straight path with right-angle turns;
- a bank stepping in whole tiles;
- rows of identical trees along the border;
- rectangular grass patches;
- a hut facing the camera.

The agent's World lines asked for looping paths, irregular shorelines and tree clusters, which draws one illustrated picture. Replacing only the World line of the agent's hand-painted prompt with tile-map terms turned that same look into a game screen.

That is a rule about how the world is put together, not about style, and every kind of game is put together differently. `screen-layouts.md` therefore names six build methods:

| Build method | Games built this way |
| --- | --- |
| Tile map | top-down RPGs, farming, pixel platformers |
| Painted layers | hand-painted platformers and metroidvanias |
| Rooms on a painted backdrop | adventures, visual novels, battle stages |
| Sprites in a 3D scene | HD-2D |
| 3D kit | stylised 3D |
| UI screen | card hands, boards |

`looks.md` names the method each look usually uses, and the World line is written in the chosen method's terms. No look is ruled out: the families only help the candidates differ.

## Build methods test (2026-11-20)

Five quick games, one per build method other than tile map, each with its own setup style. The agent went straight to the samples and wrote each World line in the right method's terms.

| Build method | Game | Result |
| --- | --- | --- |
| Painted layers | 灯守, a side platformer | Both samples read as painted platformers, with parallax and clear floor tops |
| Rooms | 雾港旧事, a point-and-click | Both read as point-and-click rooms with an inventory bar |
| Sprites in 3D | 星砂旅团, an HD-2D RPG | Convincing, but both candidates were pixel sprites in a diorama and came out alike |
| 3D kit | 云端邮差, a third-person game | The first try read as a flat 2D cartoon; the agent's retry got the camera right but still looked drawn rather than rendered |
| UI screen | 灰烬誓约, a deckbuilder | Both read as card battles, in clearly different looks |

Two changes came from the test:

- **Sprites in 3D:** the method now says the sprites can be pixel, painted or cartoon, so the candidates can differ in more than palette.
- **3D kit:** the method and the 3D Avoid note now ask for a frame rendered by a real-time 3D engine, and avoid a flat drawing. The installed toon-3d style says this, but the agent's DNA had dropped it.

## Reruns and anime-style games (2026-11-20)

**Sprites in 3D, rerun.** The two candidates now differ: pixel sprites in one, painted sprites in the other.

**3D kit, rerun.** The agent's prompt carried "rendered in a real-time engine" and avoided "flat 2D illustration". It even noticed the result looked flat and retried, but it still came out drawn. The cause was the moment: the player gliding in mid-air, big in frame, against open sky. The same prompt with the player running on a path that recedes into the distance, seen from behind, read as a 3D game frame. The camera table now says that for 3D the moment keeps the player on the ground with the ground plane in view, and the player is about 1/5 of the screen height.

**Three Japanese anime-style games,** each with a well-known game in Game setup's "similar games":

| Game | Similar game | Build method | Result |
| --- | --- | --- | --- |
| 苍潮舰队, shipgirl naval shooter | 碧蓝航线 | painted layers | Chibi shipgirls skating on the sea, enemy boats, bullet lanes, portraits and skill buttons |
| 晨星防线, tower defense | 明日方舟 | tile map, diamond grid | Route, deploy tiles, chibi units, operator portraits, cost counter |
| 放课后战术部, school tactics | 蔚蓝档案 | 3D kit | A receding 3D street, chibi students behind cover, skill portraits |

All three read as games in their genre with original characters, and none copied a logo or a character.

## Thin briefs (2026-11-20)

Ten popular genre and look pairings, each with a one-line brief ("种田游戏，可爱点", "像哈迪斯那样的肉鸽", "a match 3 game") and the gameplay left to the agent. An independent review session graded every sample before reading its prompt. A sample passes when someone scrolling a store page would take it for a capture from a released game.

**Round 1:** 3 of 23 samples passed. Rendering was clean everywhere and every HUD string was spelled right. The failures were:

- **Bare genre screens:** six plots and no farmer, a lone kart, 26 evenly scattered enemies, a wide field for a danmaku.
- **Briefs read literally:** "像哈迪斯" became flat grey light, and one candidate dropped 复古.
- **Prompts cut by the shell:** on Windows, the agent passed a here-string as `--prompt $p`, and Windows PowerShell 5.1 ends that argument at the first double quote inside it. The CLI dropped the loose words without a word, so two samples were made without their Quality and Avoid lines.

**Changes:**

- **CLI:** `pixo media generate` refuses words outside any flag, and nothing is made.
- **Media contract:** long prompts go on stdin with `--prompt-file -`. Stdin keeps Chinese and quotes intact in PowerShell 5.1, and the CLI drops the byte-order mark it adds.
- **Skill:**
  - "Reading a thin brief": the play area's shape, how full it gets, the three HUD items players check, and a named game's rendering in plain words.
  - Candidates keep what the user's words fix.
  - Each genre's density, and a Density line in the template.
  - Lighting follows the look.
  - No mirrored or centred staging, and buildings named by culture.
- **Planning prompt:** gameplay the agent invents keeps the genre's usual loop.

**Round 2,** the same briefs: 8 of 24 passed and no game got worse. What remained:

- **Readouts banned to protect a small first version:** no clock on the farm, no minimap in the race.
- **The setup style chosen over the genre's mainstream look.**
- **HUDs louder than the game.**
- **A toon 3D row that described a 2D drawing.**

The skill now separates mechanics from readouts and set dressing, puts the mainstream look among the candidates for a genre-only brief, and sizes HUDs per genre. Its toon 3D row now names 3D cues (soft shading, gloss, contact shadows) and says thin outlines.

**Round 3:** ten genres the thin-brief table did not name (tower defense, card roguelike, village life sim, 3D soulslike, rhythm, city builder, fishing, romance visual novel, precision platformer, twin-stick). 15 of 25 samples passed, the same level as the trained genres. The genres with no row at all (rhythm, fishing, life sim) scored best-per-game 6, 7 and 8, so the general reading carries over. The failures came from text written for a neighbouring genre:

- **Neighbour rows:** a twin-stick shooter got the survivors-like horde from a shared row.
- **Camera size:** a soulslike retry shrank its player to the camera table's size.
- **Density counted in actors:** a sparse platformer room and a village shown as the city builder.
- **Flat vector as the contrast candidate:** it lost in every round.
- **Neon looks:** written down to flat light.

The skill now:

- measures fullness in the genre's own unit, at a moment some way into a good session;
- lets a neighbouring genre take a row's zones but not its counts;
- treats the camera table's sizes as defaults;
- allows flat vector only when asked;
- keeps glow for neon looks;
- recommends what the user pictured, not what is cheapest.

It also lost its duplicate genre table, the era table and the sizing arithmetic.

**Round 4:** ten genres with no row and no close neighbour (3D collectathon, grid dungeon crawler, point-and-click, idle, football, auto-battler, stealth, survival crafting, hidden object, 3D metroidvania). 18 of 26 samples passed, and 9 of 10 games had a passing candidate. Flat vector appeared only where Game setup asked for it. Two failures remained:

- **3D retries that shrank a well-sized player** to the camera table's 1/5. That default is now 1/3 for a character, and a retry never only shrinks a player drawn at the genre's size.
- **Quantities copied from the first version:** four stars, three upgrade rows, four players. Quantities are now content: the screen shows what the genre shows.

The planning prompt now also says when a quick scope cannot hold a genre that is its scale (a football match, a city).

| Round | Briefs | Passed | Games with a pass |
| --- | --- | --- | --- |
| 1 | the ten trained genres, before the changes | 3 of 23 | 3 of 10 |
| 2 | the same ten, after | 8 of 24 | 6 of 10 |
| 3 | ten held-out genres | 15 of 25 | 7 of 10 |
| 4 | ten genres with no row | 18 of 26 | 9 of 10 |

**Round 5:** six famous games (Hades, Stardew Valley, Breath of the Wild, Balatro, Cuphead, Black Myth: Wukong) and six popular style words (吉卜力, PS1, cyberpunk neon pixel, HD-2D, Genshin-style anime, claymation). F7–F12 ran on Codex directly with the skill but without OpenPixo; pass rates were the same on both paths.

- **Results:** 14 of 25 samples passed and nothing was copied from any game. But only 5 of 12 games matched the look the user named.
- **Main cause:** agents named the look's signature, then hedged it ("restrained glow", a muted main colour), so Hades came out grey and cyberpunk lost its neon.
- **Changes:**
  - What a fan names first now goes in at full strength and overrides "even light".
  - HD-2D keeps its tilt-shift blur.
  - Candidates fixed to one rendering differ in light and palette.
  - Rivals are content.
  - A named game's camera beats Game setup's.
  - A named look gives rendering, not mechanics.

**Round 5b:** Hades, Balatro, cyberpunk and HD-2D, rerun after those changes: 8 of 8 passed (3 of 8 before), and a fan would call all four "that's what I meant". The cost is originality. The Balatro-like reads as a clone at a glance without copying any asset, and the HD-2D battle borrowed Octopath's break system. A style word now gives rendering only. A named game keeps one visible thing of the user's own, and the reply says what differs.

**Round 5c:** a held-out check on Stardew Valley, Cuphead, Dead Cells and Persona 5. Every first sample was believable and three of four matched their game. But every second sample was a colour swap no shipped game has, such as teal grass and magenta roofs. Two causes:

- **The candidate rule** asked for a different palette.
- **Seven HEX codes in every Style DNA:** the model paints the whole scene from that list of swatches, which had earlier made Hades grey and Persona maroon.

The changes:

- The second candidate is the same look at another time of day or weather, lit by the scene's own lights; a scene with no sky shows another area.
- The DNA describes colour as a player sees it, with no HEX codes except a palette the user set. The style bible's HEX palette is read from the picked master.
- A named game's camera wins on battle and menu screens too.
- A named game's signature mechanic is offered in the gameplay step, never put in silently.

**Round 5d,** the same check after those changes: 8 of 8 passed, every image a look shipped games use, and Hades kept its grades. The reviewer's verdict is that planning's style samples are ready to ship. Rounds 5 to 5d ran on Codex directly with the skill, without OpenPixo; earlier rounds showed both paths score about the same.

**Later fixes,** each from the owner's review of a few games (rounds 5e to 5k):

- the HUD drawn on the scene, with bare icons and frames only where text is read;
- a readability order: a clear play layer in front of a quieter background;
- lighting with a time of day and a direction;
- calm large areas with saturated accents, and props in clusters;
- for RPGs, exploration with an NPC conversation and combat on its own screen.

**The rewrite.** The fixes had grown the skill to 10,500 words, with rules repeated and some written for one game (Pokémon). It was rewritten to about 7,200 words: every rule is general and stated once, and the HUD rules sit in one section.

**Round 6,** twelve earlier briefs on the rewritten skill: 23 of 24 passed, the best of any round. Seven games beat their best earlier round, and none fell. The one loss was a creature close to a named game's design, so a general rule came back: design each creature so a fan could not name the original it resembles. Two more lines came back with it, no mirrored pairs and a scene behind UI-shaped play areas.

The reviews, samples and prompts are kept with the test content, outside this repository (`tests/key-image-test/review-1` to `review-4`).

**Not tested yet:**

- the style bible, UI kit, component sheets and area key images from step 6 (one earlier hand test only);
- the hosted image model: every round used Codex;
- the OpenPixo path since round 5's changes, which were tested on Codex directly;
- the crafted and long scopes;
- more than a few English briefs.

## Later, if the key image is not enough

- How levels are assembled from parts (tiles, props, building pieces) rather than one painted picture per area.
- A screenshot check at the end of each stage against the key image.
- Nearest-neighbour resizing for pixel looks: no official style declares `pixelSize`, so it never switches on.
