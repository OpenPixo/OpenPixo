# Screen layouts

Write each zone concretely: what is in it, where, how big. "A normal HUD" gives the model nothing to draw. Sizes are shares of a 16:9 screen; keep about 4% clear at every edge.

## HUD rules

- **Space.** The play area, where the main verb happens, is 70–85% of the screen. The HUD covers about 10–15% of it, except where the genre's frame has its own panel (a vertical shooter's side panel, at most a third of the width). Eight strings is a ceiling, not a target. A genre that shows almost no HUD (precision platformer, horror, exploration) gets "none" or one element.
- **During play, the HUD is drawn on the scene.**
  - Bars, bare icons and numbers carry an outline or glow.
  - An ability icon is the symbol itself, with a cooldown ring, never inside a square tile or a button.
  - No box sits behind a corner.
  - Frames go only where text is read: dialogue, a command menu, an inventory, a toolbar.
- **The HUD uses the world's rendering:** its pixel size, or its characters' outline and material.
  - Numbers appear only where players read one (gold, a timer, a turn-based HP total). An action game's health is a bar with no "72/100".
  - Ability icons carry no key labels. The only key text is one context prompt beside the thing it acts on ("[E] Fish").
- **Placement.** Items go by corner, sized against the player or a tile. Never use a pixel rectangle: the model draws a box that size.

## Build it the way the engine would

A screen reads as a game when its world is put together the way an engine would build it, and as an illustration when it is drawn as one picture. Pick the build method for the look and perspective, then write the World line in its terms.

| Build method | Typical games | What the World line says |
| --- | --- | --- |
| **Tile map** | top-down RPG or adventure, farming, stealth, tactics, builder | paths run along rows and columns and turn at right angles; edges step in whole tiles; borders are rows of identical trees, rocks or walls; buildings sit on the grid facing the camera; props repeat |
| **Painted layers** | hand-painted platformer, metroidvania, side-scroller | a walkable foreground whose top edges are clearly the floor; 3–5 parallax layers, lighter and simpler with distance; a dark silhouette layer in front; props reused instead of tiles |
| **Rooms on a backdrop** | point-and-click, visual novel, card or turn-based battle stage | one painted room or stage per screen; characters as separate sprites at one scale on the floor line; usable things stand apart from the backdrop |
| **Sprites in a 3D scene** | HD-2D, billboard sprites | a small 3D diorama of repeated blocks or models, a tilted fixed camera with real perspective, flat sprites standing upright in it |
| **3D kit** | stylised 3D adventure, racing, survival | a real 3D camera; the world assembled from a small kit of repeated models on a visibly tiled ground; a frame rendered by a real-time engine (volumes, cast shadows, depth), never a drawing of a 3D place |
| **UI screen** | card hand, rhythm lanes, management, idle, puzzle board | the interface is the play area: a board, lanes, a hand or a grid fills most of the screen, in front of a scene (a stage, a character, a place) that fills the rest |

Composition holds for every method:

- **A window, not a diorama.** A play screen looks onto a bigger level: the level runs off at least two edges. Nothing is mirrored, no landmark sits dead centre, and no part of the screen is left empty.
- **Uneven positions.** Give positions off-centre and uneven (a ledge from 8% to 52%).
- **Theme nouns at prop size.** A theme noun in the Game line (a bell, a statue) appears at prop size in the World line, or the model makes it the centrepiece.
- **Culture named.** Every building's culture is named ("a Chinese mountain gate with a tiled roof").
- **Props of the game's world.** Props belong to this game's world and genre, never borrowed from a neighbouring genre.
- **Pieces, not panoramas.** Words for one big picture (sweeping, winding, a scenic vista, a lone hero) belong to no build method; describe the pieces.

> Example, tile map: "Built on the tile grid like a 2D tile engine map. The lake fills the right 45%, its bank stepping in whole-tile steps with repeated stone edge tiles. A path of path tiles runs across the upper third and turns at a right angle down the left side. Rows of identical round trees line the top and left edges. A hut at the top right, its door facing the camera."

## Gameplay screens

A row describes the genres in its title. A neighbouring genre takes a row's zones but not its counts or HUD items, and a genre with no row is drawn from the reading in step 2.

**Top-down adventure, RPG, stealth or life sim**
- **Area and moment:** a walkable area bounded by repeated edges, with buildings showing their front walls and doors. An RPG shows exploration: the player facing an NPC mid-conversation, 2–4 other people, signs and doors, and a dialogue box (name plate, one short sentence). Combat is a separate screen.
- **HUD:** time or day and money small in the corners, plus one context prompt.
- **Farming:** the avatar on a field of many crop rows, a 10–12 slot hotbar, clock, date and season.
- **Camera:** an RPG or town camera is closer, 15–18 tiles across, with the player one tile tall.

**Side-view platformer or metroidvania**
- **Level:** ground at two or more heights and 2–3 platform levels, with the player left of centre facing right. Enemies come in a group or at different heights.
- **HUD:** health top left, a collectible count or minimap top right, and nothing over the lower half.
- **Precision platformer:** a dense one-screen room of tiles and hazards, with almost no HUD.

**Survivors-like**
- **Horde:** the player in the centre, with 60–150 enemies closing in as a loose ring and streams, never evenly spread. Gems lie where enemies died, and 3–4 weapon effects show at once.
- **HUD:** an XP bar across the top with the level, the timer at top centre, kills and gold at top right.

**Twin-stick or arena shooter**
- **Arena:** a room with walls and cover, and 10–30 enemies in groups, some firing. Bullets fill the screen, and the aim reticle sits away from the player.
- **HUD:** health, weapon and ammo, and the wave counter.

**Isometric action roguelike**
- **Room:** one room with 6–12 enemies of 2–3 kinds, red ground warnings and a hazard, the hero mid-dash, and an exit visible.
- **HUD:** health and ability icons bottom left, currency top right.

**Vertical shooter or danmaku**
- **Field:** a tall field, the full height and about 45% of the width, and a narrow side panel (hi-score, lives, bombs) with art filling the rest.
- **Action:** a player 3–4% of the screen height with a hit dot, and 200–500 bullets in overlapping patterns.

**Deckbuilder or card battle**
- **Stage:** the upper 55% has the player left and 1–3 enemies right, each with a health bar and an intent icon.
- **Cards and HUD:** a fanned hand of 5, the energy, draw and discard piles, and End turn. Health, gold and relics run across the top.

**Turn-based RPG battle**
- **Stage:** the party and the enemies on a battle stage, set near and far when the genre stages them that way, each on a ground ellipse.
- **Commands:** a short list of words with a selection marker on one panel, never a stack of buttons. The party's names and bars sit beside it, with a message line above or below.

**Visual novel or dialogue scene**
- **Scene:** a full-screen backdrop with one or two characters from the waist up.
- **Text:** a dialogue box in the bottom 25–30% with a name plate and two lines, and small menu icons.

**Grid tactics**
- **Map:** 10×10 tiles or more with height steps, water or cliffs, and 4–6 units a side. The move range shows as a diamond and the targets in red.
- **HUD:** a unit card with portrait, name and HP numbers, and the turn order.

**Tower defense**
- **Path:** the enemy path from an edge to the base, 4–6 build spots, a wave on the path and towers firing.
- **HUD:** base health, money and wave counter, and a tower bar with prices.

**Management, builder or city**
- **Map:** the map on its grid filling the screen, some way into the game, with buildings, roads and workers.
- **HUD:** a resource bar across the top and a build menu.

**Puzzle on a grid**
- **Board:** 75–85% of the height in a decorated frame, its pieces glossy and shuffled with no repeating pattern.
- **Sides:** the level, goal icons and moves left on one side; a theme scene and boosters on the other.

**Kart or arcade racer**
- **Track:** a chase camera with 3–7 rival karts ahead and beside, and item boxes or boost pads ahead.
- **HUD:** position large, lap, the item slot and a minimap.

**First-person 3D**
- **View:** the held item lower right, and the usable object at the reticle with its prompt.
- **HUD:** what the game counts, small.

**Third-person 3D**
- **Player:** about 1/3 of the screen height, back to the camera, on the ground, with the path ahead.
- **HUD:** health top left, and skills with cooldowns bottom right.

## Other screens

Made after approval with the master as image 1; frames, buttons, fonts and the currency bar match the master exactly.

| Screen | Layout |
| --- | --- |
| Title | a scene from the game's world, the logo upper centre, 3–4 menu entries below |
| Pause | the game screen dimmed, a centred panel with 4 entries |
| Shop | the shopkeeper or sign to one side, item cards (icon, name, price) on the other, money top right |
| Inventory | a grid of slots in rarity frames, a detail panel for the selected item |
| Results | a large banner, rewards in a row of frames, continue and retry |
| Battle (when separate) | as the turn-based battle row, in the master's look |
