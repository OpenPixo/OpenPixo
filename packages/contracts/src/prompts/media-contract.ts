import type { ByokMediaDefaults } from '../api/chat.js';
import type { EngineProfile } from '../api/game-project.js';
import { IMAGE_OUTPUT_MAX_EDGE, type AgentImageModelUnavailableReason, type MediaExecutionPolicy } from '../api/media.js';
import { OPENPIXO_MODEL3D_SERVICES } from '../api/openpixo-cloud-media.js';
import { ART_BUDGET_ESTIMATE_CREDITS, type ArtBudgetApproval, type ArtSpendingMode } from '../api/art-budget.js';
import { ART_REQUEST_EXAMPLE } from '../api/art-request.js';
import { PRODUCT_NAME } from '../product.js';

// Shared game media contract; the daemon adds its model catalogue.

/** Model ids the daemon dispatcher accepts, per surface. */
export interface GameMediaModelCatalog {
  image: readonly string[];
  video: readonly string[];
  audioMusic: readonly string[];
  audioSpeech: readonly string[];
  audioSfx: readonly string[];
  /** Image-to-3D models. Absent means none, same as an empty list. */
  model3d?: readonly string[] | undefined;
  /** Image model used when neither the user nor the run names one. */
  defaultImageModel?: string | undefined;
  /** `defaultImageModel` is the image model the user picked in Settings (`agentImageModel`). */
  defaultImageModelIsUserChoice?: boolean | undefined;
  /** The image model the user picked in Settings when it cannot run in this run, and why. */
  unavailableImageChoice?: { id: string; reason: AgentImageModelUnavailableReason } | undefined;
  /** The ids in `image` paid from the art budget the user approved. Absent otherwise. */
  budgetImageModels?: readonly string[] | undefined;
  /** The ids in the audio lists paid from that same budget. Absent otherwise. */
  budgetAudioModels?: readonly string[] | undefined;
  /** The ids in `model3d` paid from that same budget. Absent otherwise. */
  budgetModel3dModels?: readonly string[] | undefined;
  /**
   * The user is signed in but has never set an art budget for this project, so credits
   * could pay for art once they do. A budget of 0 is a choice, not this.
   */
  artBudgetUnset?: boolean | undefined;
}

export interface GameMediaContractInput {
  mediaExecution?: MediaExecutionPolicy | undefined;
  byokMediaDefaults?: ByokMediaDefaults | undefined;
  engineProfile?: EngineProfile | null | undefined;
  /** Omitted on the API/BYOK side, which has no model registry. */
  modelCatalog?: GameMediaModelCatalog | undefined;
}

export const GAME_MEDIA_CONTRACT_HEADING = '## Game asset generation (load-bearing)';
export const GAME_ART_DECISION_HEADING = '### When to make art, and at what size';

const GAME_ART_DECISION_RULES = `${GAME_ART_DECISION_HEADING}

Make the images the work needs when the project does not have them: character
and enemy sprites, items and pickups, tiles and textures, UI icons and buttons,
portraits, backgrounds, title art. The user does not have to ask for "an image";
"add a shop screen" that needs coin and item icons is a request to make them. In
a new game built from an approved plan, list what you will make first and wait
for the user's OK, as "New game plan" says; in any other project, make them on
your own. Do not generate when a suitable asset already
exists, when the user asked for placeholders or programmer art, or when they said
not to. Each generation can spend the user's plan allowance or API budget: make
only the assets the task needs, one call per asset or per set of small assets
("Small art in one image" below), and do not regenerate an asset without a
reason.

Choose the final size for how the asset is used. \`--width\`/\`--height\` (or
\`--size WxH\`) set the exact size of the written PNG; the long edge is capped at
${IMAGE_OUTPUT_MAX_EDGE} px and the host resizes the provider's render, so never ask
for more, and pick smaller sizes for small things:

| Asset | Typical final size | Flags |
| --- | --- | --- |
| UI icon, item, pickup | 64-128, square | \`--transparent\` |
| Character / enemy sprite, one still | 128-512 on the long edge | \`--transparent\` |
| Tile or texture | the project's tile size (32, 64, 128), square | opaque; say "seamless, tileable" |
| Portrait, card art | 512-1024 | \`--transparent\` for a cutout |
| Background, title, splash | the game's view scaled to at most ${IMAGE_OUTPUT_MAX_EDGE}, e.g. 1536x864 | \`--background scene\` |

When the project already has assets of the same kind, match their pixel size
(read it with a command-line tool) instead of the table. \`--transparent\` always
returns real alpha: native when the provider supports it, otherwise the host
keys out a flat backdrop, so do not describe a checkerboard or a "transparent
background" in the prompt yourself. Omit the size flags only when nothing
depends on the dimensions.

New art has to look like the game's other art. When the image model takes
reference images, pass the image it should match as the first \`--image\`: the
style reference the plan names, or the closest existing asset of the game. In a
game with a style reference (\`style get\`), an image request needs \`--image\` or,
for art meant to look different (a background, UI, a new style),
\`--no-reference\`; the host refuses one with neither before anything is spent.`;

export const GAME_SMALL_ART_SET_HEADING = '### Small art in one image';

/**
 * Image models render at about 1024 px or more and charge for that render, whatever
 * size the file ends at (hosted: 1024x1024, 1536x1024, 1024x1536), so sixteen 64 px
 * icons made one call each cost sixteen full images (owner report, 2026-11-11). The
 * host's `--sheet` does the grid, the shape, the cut and the names in one call
 * (`apps/daemon/src/media/sheet-request.ts`): weaker models misapplied the four-step
 * version of this rule, so the steps live in the tool and the text stays short.
 */
const GAME_SMALL_ART_SET_RULES = `${GAME_SMALL_ART_SET_HEADING}

An image model renders at about 1024 px or more and charges for that render, so a
64 px icon costs as much as a full image. When the task needs two or more small
images in one style (icons, items, pickups, UI buttons, small props), make them in
one call with \`--sheet\`: the host lays out the grid, renders it once, cuts it and
writes each piece next to the sheet under its own name.

\`\`\`bash
"$PIXO_NODE_BIN" "$PIXO_BIN" media generate --project "$PIXO_PROJECT_ID" --surface image --model <id> \\
  --sheet 3x2 --names coin,heart,key,gem,potion,bomb --size 64x64 --transparent \\
  --output assets/icons/pickups-sheet.png --prompt "Pickup icons for a cozy farm game: coin, heart, key, gem, potion, bomb. Bold outlines, soft shading."
\`\`\`

Pick the grid for the count: up to 4 as 2x2, 6 as 3x2, 9 as 3x3, 16 as 4x4; more
than 16 take another sheet. \`--names\` lists the pieces left to right, then top to
bottom, named the way the project names such files; spare cells stay empty. The
prompt says what the set is and names every piece; the host adds the layout and
picks the image's shape, so pass no \`--aspect\`. \`--size\` is each piece's final
size and \`--transparent\` cuts each one out. The reply lists the written files in
\`file.pieces\`, marked \`empty\` or \`touchesEdge\` when a cell went wrong: reference
those files, not the sheet, and remake only a sheet whose pieces came out wrong.

Make an image on its own when it is the only one of its kind, above about 256 px,
much bigger than the others, a different shape, or a tile that has to repeat
seamlessly. A sheet counts as one image on an art card.`;

export const GAME_ANIMATED_CHARACTER_HEADING = '### Characters that move';

/**
 * Without this, a character read as "one image" and shipped as one still flipped
 * left and right (owner report, 2026-11-11). The states are the agent's call. The
 * layout, shape, cut and alignment are the host's (`--sheet --frames`, `asset frames`),
 * and the frame check answers in numbers and sentences, so a model that cannot see
 * images can still judge its frames.
 */
const GAME_ANIMATED_CHARACTER_RULES = `${GAME_ANIMATED_CHARACTER_HEADING}

A character or enemy the player watches move needs animation frames: one image
flipped left and right is not an animation. Decide from the gameplay which
states each one shows on screen (idle, walk or run, jump, attack, hurt, death,
whatever this game has) and how many frames each needs, usually 4 to 8 for a
loop and 3 to 6 for a one-shot. Flipping in the engine covers facing the other
way in a side view; a top-down character needs frames for each direction it
faces. One still image is right only for what does not move on screen:
portraits, card art, icons, props. Make the states this stage needs, not every
state the character might one day have.

In a top-down game where a character moves freely, its walk needs eight
directions; with four it faces the wrong way on every diagonal. Make the walk
with the \`sprite-walk-8dir\` recipe after the design (step 1): it draws all eight
directions in one image, cuts the frames and exports an engine atlas with a
\`walk-<direction>\` clip for each. Give it the design as a character card first,
\`"$PIXO_NODE_BIN" "$PIXO_BIN" character create <slug> --name <name> --description <text> --reference <design>\`,
then run \`"$PIXO_NODE_BIN" "$PIXO_BIN" recipe run sprite-walk-8dir --input character=<slug> --input frames=<4|6|8> --json --wait\`
(\`recipe show sprite-walk-8dir --json\` lists the style options). It makes two
candidates, two images. Look at every row before adopting: top to bottom down,
down-left, left, up-left, up, up-right, right, down-right. A model can turn one
row the wrong way or invent a detail the design does not show, such as the back
of a costume. Adopt with \`"$PIXO_NODE_BIN" "$PIXO_BIN" recipe adopt <runId> --candidate <id>\`,
then check each direction's frames with \`asset frames check\` as in step 3;
when \`asset frames align\` changes them, export them again as in step 4. Make
the other states with the steps below.

1. Design: one full-body image of the character in its idle pose (facing right
   in a side view), made as the table above says, or the project's own when it
   has one. Every state copies it.
2. One sheet per state, one call each with \`--sheet <C>x<R> --frames\`: 4 frames
   as 2x2, 6 as 3x2, 8 as 4x2. A sheet costs one image. The host lays out the
   grid, renders it once and writes the frames next to the sheet
   (\`hero-run-sheet.png\` gives \`hero-run-1.png\`, \`hero-run-2.png\`, …) on one
   canvas, at one scale, feet on one line. \`--size\` is each frame's size in the
   game. Describe the motion frame by frame in the prompt. Pass the design with
   \`--image\` when the model takes reference images, so every state shows the
   same character; otherwise repeat the design's description word for word.
   For example: \`--sheet 3x2 --frames --size 128x128 --image assets/hero/hero.png --output assets/hero/hero-run-sheet.png\`.
3. Check each state with \`"$PIXO_NODE_BIN" "$PIXO_BIN" asset frames check <frames in order...> --json\`.
   Its \`summary\` measures whether the feet move, the character slides or changes
   size, or a frame is empty, and \`summary.issues\` says each problem in a
   sentence, so you can judge frames without seeing them. \`asset frames align
   <frames...> --canvas <W>x<H>\` puts loose frames on one canvas and one line
   (\`--match-height\` when the same pose came out at different sizes). Remake a
   sheet once when a frame is empty or shows a different character.
4. Join each state into the sheet the engine loads with
   \`asset export-spritesheet <frames...> --columns <n> --fps <n>\` (\`--no-loop\`
   for a one-shot; see \`--help\` for names and formats; \`asset pixelate\` the
   frames first for pixel art). Asset tools write under \`derived/\` unless you
   pass \`--out\`, so give the engine sheet an \`--out\` inside the asset root.
5. Load each state as its own clip and switch clips from the character's state in
   code: idle when still, run when moving, jump in the air. The
   sprite-animation-pipeline skill has the engine details. Watch it move in a
   playtest; a still screenshot cannot show an animation.

When you list art for the user, name each moving character's states and count
the images ("hero: design, idle, run, jump, hurt: 5 images"), so they approve
animations, not one picture.`;

function codeList(ids: readonly string[]): string {
  return ids.length > 0 ? ids.map((id) => `\`${id}\``).join(', ') : '(none)';
}

function gameMediaPolicyScope(mediaExecution?: MediaExecutionPolicy | undefined): string {
  const lines: string[] = [];
  if (mediaExecution?.allowedSurfaces?.length) {
    lines.push(`- Surfaces allowed this run: ${codeList(mediaExecution.allowedSurfaces)}.`);
  }
  if (mediaExecution?.allowedModels?.length) {
    lines.push(`- Models allowed this run: ${codeList(mediaExecution.allowedModels)}. The dispatcher rejects anything else; pick only from these.`);
  }
  return lines.join('\n');
}

function gameMediaRunDefaults(defaults?: ByokMediaDefaults | undefined): string {
  const lines: string[] = [];
  const imageModel = defaults?.imageModel?.trim();
  const videoModel = defaults?.videoModel?.trim();
  const speechModel = defaults?.speechModel?.trim();
  const speechVoice = defaults?.speechVoice?.trim();
  if (imageModel) lines.push(`- Image model: \`${imageModel}\``);
  if (videoModel) lines.push(`- Video model: \`${videoModel}\``);
  if (speechModel) lines.push(`- Speech model: \`${speechModel}\``);
  if (speechVoice) lines.push(`- Speech voice: \`${speechVoice}\``);
  return lines.length > 0
    ? `Run defaults the user picked (use them unless the current message names something else):\n${lines.join('\n')}`
    : '';
}

function gameAssetRootsLine(profile?: EngineProfile | null | undefined): string {
  const roots = profile?.assetRoots?.filter((root) => root.trim()) ?? [];
  if (roots.length === 0) {
    return '- No asset root is known for this project. Find where its existing sprites, audio, and textures live and write next to them.';
  }
  return `- Asset roots, in priority order: ${codeList(roots)}. \`--output\` is a project-relative path inside one of them.`;
}

function gameImportSidecarLine(profile?: EngineProfile | null | undefined): string | null {
  if (profile?.importMetadata === 'unity-meta') {
    return '- Unity creates the `.meta` for a new file on import. Do not write one by hand.';
  }
  if (profile?.importMetadata === 'godot-import') {
    return '- Godot creates the `.import` for a new file on its next import. Do not write one by hand.';
  }
  return null;
}

const GAME_NO_IMAGE_MODEL_RULE = `**No image model can run right now**, which overrides the art rules above. Do not call \`media generate --surface image\`; it cannot succeed. Finish the parts of the request that do not depend on new art, do not reference a file that does not exist, and do not drop in a stand-in unless the user asked for placeholders. Tell the user once, in one sentence. For Simplified Chinese use these sentences exactly: "No image generator is connected yet, so I left the new art out. Connect Codex or add an image API key in Settings, or make the art in Library > Generate, then ask me again." / 还没有连接图片生成器,这次没有做新素材 —— 在设置里连接 Codex 或填入图片 API key,或者到「资源库 → 生成」里做好素材,再叫我继续。`;

/**
 * The same rule for a signed-in user who has not set an art budget yet. Telling them
 * to connect Codex sent a credits-only beginner off to install a tool they did not
 * need (2026-11-10 beginner audit); the budget is the one step between them and art.
 */
const GAME_NO_IMAGE_MODEL_UNTIL_BUDGET_RULE = `**No image model can run right now**, which overrides the art rules above: the user is signed in and can pay for art with ${PRODUCT_NAME} credits, but has not set an art budget for this project, and only they can. Do not call \`media generate --surface image\`; it cannot succeed. Finish the parts of the request that do not depend on new art, do not reference a file that does not exist, and do not drop in a stand-in unless the user asked for placeholders. Tell the user once, in one sentence, where to set the budget. For Simplified Chinese use these sentences exactly: "I left the new art out: to make it with ${PRODUCT_NAME} credits, set an art budget for this project above the message box (on the approve bar while the plan is not approved yet), then ask me again." / 这次没有做新素材 —— 用积分出图要先给这个项目设一个美术预算(在输入框上方的「美术预算」,计划还没批准时在批准栏里),设好后叫我继续。`;

const GAME_MODEL3D_RULES =`\`--surface model3d\` turns one image into a textured \`.glb\`. Pass the image with \`--image <project-relative path>\`; \`--prompt\` is not needed. Use it only for a project with a 3D view that needs a prop or character it does not have. A model costs far more than an image and takes minutes, so make the image first, check it shows one object on a plain background in a three-quarter view, and make one model per asset. Write it under the engine's model folder, then load it in a scene and check it in a playtest: generated meshes can come in at the wrong scale.`;

function gameBudgetImageRules(models: readonly string[], userChoice?: string | undefined): string {
  const order = userChoice && models.includes(userChoice)
    ? `The user picked \`${userChoice}\` in Settings as the image model, so it is the default even though every other image model here costs nothing extra.`
    : 'Every other image model here costs nothing extra, so use those first and use these only when nothing else can make the asset.';
  return `### Images paid from the art budget

${codeList(models)} spend ${PRODUCT_NAME} credits from the art budget the user approved for this project. ${order} Dispatch them like any other model: the host prices each request and charges the budget, so there is no quote, price or request id for you to pass. Each call spends real money, so make only the art the task needs: one call per asset, or one sheet for a set of small ones. \`openpixo-image-edit\` takes 1 to 4 \`--image\` references and \`openpixo-image\` takes none; the host sends a request with \`--image\` to \`openpixo-image-edit\` and one without to \`openpixo-image\`, so pass the style reference whenever new art must match the game. They render at the nearest shape the service offers; \`--size\` and \`--transparent\` still set the final file. Only the user can set or raise the budget, between turns. Do not try to change it, and do not reach these models any other way.`;
}

function gameBudgetAudioRules(models: readonly string[]): string {
  return `### Audio paid from the art budget

${codeList(models)} spend the same art budget, on the same terms: another listed audio model comes first, the host prices and charges each request, and one call makes one file. Pass \`--surface audio\` and an \`--output\` ending in \`.mp3\`, the format they all write. \`openpixo-sfx\`: describe the sound in up to 450 characters; \`--duration\` sets its length, up to 10 seconds, default 3. \`openpixo-voice\`: the prompt is the line to speak, up to 300 characters; \`--voice <name>\` picks the voice, and a name it does not have is refused with the list. \`openpixo-music\`: describe it in 10 to 300 characters; it is instrumental and its length cannot be set, so do not pass \`--duration\`. A track costs far more than the others and can take several minutes, so make it only when the user asked for music, one track at a time, and keep waiting on the task.`;
}

function gameBudgetModel3dRules(models: readonly string[]): string {
  return `### 3D models paid from the art budget

${codeList(models)} spend the same art budget, on the same terms: another listed 3D model comes first, the host prices and charges each request, and one call makes one file. Pass \`--surface model3d\`, exactly one \`--image\` and an \`--output\` ending in \`.glb\`, the format it writes. It takes no prompt, shape or size.${gameBudgetModel3dTiers(models)}`;
}

/** The three hosted tiers differ only in price and detail; medium is the default. */
function gameBudgetModel3dTiers(models: readonly string[]): string {
  const { draft, medium, high } = OPENPIXO_MODEL3D_SERVICES;
  if (!models.includes(medium) || (!models.includes(draft) && !models.includes(high))) return '';
  return ` Use \`${medium}\`, the medium quality, unless the user asked for something else.${models.includes(draft) ? ` \`${draft}\` costs a third as much and is rougher: use it when the user wants quick drafts or placeholders.` : ''}${models.includes(high) ? ` \`${high}\` costs twice as much for finer shape and textures: use it only when the user asks for higher quality.` : ''}`;
}

export const GAME_ART_CARD_HEADING = '### Asking before spending';

/**
 * How the agent asks for art when the project asks before spending. Stable text: the
 * turn note says which mode this project is in. The host, not this text, holds the
 * line: in `ask` mode it pays only for what the user approved with a click.
 */
const GAME_ART_CARD_RULES = `${GAME_ART_CARD_HEADING}

The turn note says whether this project asks before spending. When it does, the host pays only for art the user approved on an art card, so before any call to a model paid from the art budget, list that art and stop. End your reply with the card, with nothing after it:

${ART_REQUEST_EXAMPLE}

Write one line per asset or group of assets in the user's language, saying how many images, sounds or models it is. \`credits\` is the total: about ${ART_BUDGET_ESTIMATE_CREDITS.image} credits a new image and ${ART_BUDGET_ESTIMATE_CREDITS.edit} an image made from references, rounded up by about a fifth for one remake; audio and 3D cost more, so allow more for them. A recipe paid from the budget costs one image per candidate. The chat shows the card with an Approve button. Only the user's click approves it, and it lets the next turn spend up to that total; whatever that turn does not spend stays in the budget. Do not also ask in words, and do not dispatch anything paid from the budget until a turn note says the art was approved. Art from a model that costs nothing extra needs no card.`;

/** Which way this project spends its budget, for this turn's note. */
export interface ArtBudgetTurnSpending {
  mode: ArtSpendingMode;
  /** The latest approval; only one no run has claimed yet can pay for this turn. */
  approval?: ArtBudgetApproval | null | undefined;
  /** The plan is not approved yet: style samples need no card, and the host caps them. */
  planning?: boolean | undefined;
}

/**
 * This turn's budget figures. They change as images are made, so they travel in the
 * per-turn slice and never in the cached prefix. The rules above only move when
 * hosted models come or go. Without `spending`, the note reads as it did before
 * spending modes, which is `auto`.
 */
export function renderArtBudgetTurnNote(budget: { limitCredits: number; usedCredits: number; remainingCredits: number }, spending?: ArtBudgetTurnSpending): string {
  const figures = `${budget.usedCredits} of ${budget.limitCredits} credits used, ${budget.remainingCredits} left`;
  if (budget.remainingCredits <= 0) {
    return `Art budget this turn: ${figures}. It is used up, and this replaces the rule about no image model being connected: do not dispatch a model that spends credits. Finish what does not depend on new art, then tell the user once with the \`raise-art-budget\` sentence from the media section.`;
  }
  if (!spending || spending.mode === 'auto') {
    return `Art budget this turn: ${figures}. Keep the art, audio and 3D models you make within it.${spending ? ' This project spends within its budget without asking: say what you are making, then make it, with no art card.' : ''}`;
  }
  if (spending.planning) {
    return `Art budget this turn: ${figures}. This project asks before spending, but the style samples planning asks for need no art card; the host caps them.`;
  }
  const approval = spending.approval;
  if (approval && approval.runId === null && approval.remainingCredits > 0) {
    const left = Math.min(approval.remainingCredits, budget.remainingCredits);
    return `Art budget this turn: ${figures}. This project asks before spending, and the user approved up to ${approval.approvedCredits} credits on your last art card (${left} can still be spent): make that art now, and end with a new card for anything more.`;
  }
  return `Art budget this turn: ${figures}. This project asks before spending, and no art is approved for this turn: before making art paid from the budget, end your reply with an art card ("Asking before spending" in the media section).`;
}

/** What to tell the user, once, when their Settings pick could not be used this run. */
const UNAVAILABLE_IMAGE_CHOICE_SENTENCES: Readonly<Record<AgentImageModelUnavailableReason, { why: string; en: string; zh: string }>> = {
  'not-connected': {
    why: 'its provider is not connected on this machine (for Codex: not signed in)',
    en: 'The image model you picked in Settings isn\'t connected right now, so I used another one. Connect it in Settings or pick a different one.',
    zh: '你在设置里选的生图模型现在没连上，这次先换了一个 —— 可以去设置里连接它,或者换一个。',
  },
  'needs-art-budget': {
    why: `it spends ${PRODUCT_NAME} credits, which needs a sign-in and an art budget with credits left for this project`,
    en: `The ${PRODUCT_NAME} image model you picked needs an art budget for this project, so I used another one. You can set the budget once this turn ends.`,
    zh: `你选的 ${PRODUCT_NAME} 生图要先给这个项目设好美术预算，这次先换了一个 —— 这一轮结束后可以设预算。`,
  },
  'unknown-model': {
    why: 'this version has no such text-to-image model',
    en: 'The image model you picked in Settings isn\'t available in this version, so I used another one. Pick a different one in Settings.',
    zh: '你在设置里选的生图模型在这个版本里用不了，这次先换了一个 —— 去设置里换一个吧。',
  },
};

function gameUnavailableImageChoiceRule(choice: { id: string; reason: AgentImageModelUnavailableReason }): string {
  const sentence = UNAVAILABLE_IMAGE_CHOICE_SENTENCES[choice.reason];
  return `The user picked \`${choice.id}\` in Settings as the image model, but it cannot run in this run: ${sentence.why}. Do not dispatch it; use the model choice below. The first time you make an image, tell the user once, in one sentence: "${sentence.en}" For Simplified Chinese use this sentence exactly: ${sentence.zh}`;
}

function gameModelSection(input: GameMediaContractInput): string {
  const scope = gameMediaPolicyScope(input.mediaExecution);
  const defaults = gameMediaRunDefaults(input.byokMediaDefaults);
  const catalog = input.modelCatalog;
  const lines: string[] = ['### Models', ''];
  if (catalog) {
    lines.push(
      'Allowed model ids:',
      `- image: ${codeList(catalog.image)}`,
      `- video: ${codeList(catalog.video)}`,
      `- audio · music: ${codeList(catalog.audioMusic)}`,
      `- audio · speech: ${codeList(catalog.audioSpeech)}`,
      `- audio · sfx: ${codeList(catalog.audioSfx)}`,
      `- model3d: ${codeList(catalog.model3d ?? [])}`,
      '',
      'For an id outside this list, tell the user and use a listed one. Never substitute silently. `(none)` means nothing connected can make that kind of asset in this run, so do not dispatch it.',
    );
    if (catalog.image.length === 0) lines.push('', catalog.artBudgetUnset ? GAME_NO_IMAGE_MODEL_UNTIL_BUDGET_RULE : GAME_NO_IMAGE_MODEL_RULE);
  } else {
    lines.push(
      'Get the allowed model ids from `"$PIXO_NODE_BIN" "$PIXO_BIN" media models --json` and pick only from them. Never substitute a model silently.',
    );
  }
  const userChoice = catalog?.defaultImageModelIsUserChoice ? catalog.defaultImageModel : undefined;
  if (catalog?.budgetImageModels?.length) lines.push('', gameBudgetImageRules(catalog.budgetImageModels, userChoice));
  if (catalog?.budgetAudioModels?.length) lines.push('', gameBudgetAudioRules(catalog.budgetAudioModels));
  if (catalog?.model3d?.length) lines.push('', GAME_MODEL3D_RULES);
  if (catalog?.budgetModel3dModels?.length) lines.push('', gameBudgetModel3dRules(catalog.budgetModel3dModels));
  if (catalog?.budgetImageModels?.length || catalog?.budgetAudioModels?.length || catalog?.budgetModel3dModels?.length) lines.push('', GAME_ART_CARD_RULES);
  if (scope) lines.push('', scope);
  if (defaults) lines.push('', defaults);
  // With no image model at all, the no-image rule already says what to tell the user.
  if (catalog?.unavailableImageChoice && catalog.image.length > 0) lines.push('', gameUnavailableImageChoiceRule(catalog.unavailableImageChoice));
  const fallback = catalog?.defaultImageModel
    ? `, otherwise \`${catalog.defaultImageModel}\`${userChoice ? ', the image model the user picked in Settings' : ''}`
    : '';
  lines.push(
    '',
    `Model choice: the one the user names, then the run default${fallback}. Pass \`--quality\` / \`--resolution\` only when the user asks for a quality tier or provider resolution ("2K" and "high quality" count); otherwise let the model default. An image's final pixel size always goes through \`--size\` / \`--width\` / \`--height\`.`,
  );
  return lines.join('\n');
}

const GAME_MEDIA_FAILURE_RULES = `### When generation fails

Treat these as failures, never as a delivered asset: a non-zero exit (except
\`2\` from \`media wait\`), a set \`file.providerError\`, \`file.intentionalStub\`
or \`file.usedStubFallback\` true, a \`[stub]\` providerNote, or a ~67-byte
placeholder PNG. Keep stderr, exit codes, model and provider names, and error
codes in the tool trace. None of them go into your reply.

Branch on \`error.nextStep\` only, never on wording or HTTP status:

- \`switch-model\`: dispatch once more with another allowed model for the same surface.
- \`retry-later\`: dispatch the identical request once more.
- anything else: do not re-dispatch. It cannot change the outcome and may bill the user again.

If the asset still failed, do not reference a file that does not exist and do
not drop in a stand-in unless the user asked for placeholders. Finish the parts
of the request that do not depend on the asset, then tell the user what happened
in one sentence. For Simplified Chinese use these sentences exactly:

- \`revise-request\` with \`error.subject: "prompt"\`: "The asset prompt didn't pass content review. Reword it and try again." / 素材提示词没通过内容审核 —— 换个说法再试。
- \`revise-request\` with \`error.subject: "input_image"\`: "The reference image didn't pass content review. Try a different one." / 参考图没通过内容审核 —— 换一张参考图再试。
- \`revise-request\` with no subject: "The request didn't pass content review. Reword it or use a different reference image." / 这次请求没通过内容审核 —— 换个说法,或者换一张参考图再试。
- \`switch-model\`: "This image model can't take the request. Pick a different image model and try again." / 这个图片模型用不了 —— 换一个图片模型再试。
- \`open-settings\`: "The image model still needs its API key. Add it in Settings." / 图片模型的 API key 还没填 —— 在设置里填好就能用。
- \`sign-in\`: "The sign-in expired before the image was made. Sign in again and retry." / 登录已过期,图片没生成 —— 重新登录后再试一次。
- \`add-credit\`: "The image model is out of credit. Top up or switch to another image model." / 图片模型的额度用完了 —— 去充值或换一个图片模型。
- \`confirm-in-app\`: "This image would spend ${PRODUCT_NAME} credits, and only you can approve that. Set an art budget for this project once this turn ends, make it in Library > Generate, or connect Codex or an image API key in Settings, then ask me again." / 这张图要花 ${PRODUCT_NAME} 积分,只有你本人能确认 —— 这一轮结束后给项目设一个美术预算,或到「资源库 → 生成」里做,或在设置里连接 Codex 或图片 API key,再叫我继续。
- \`approve-art\`: nothing failed and nothing was charged. Do not dispatch it again and do not report an error: end your reply with an art card for the art still to make ("Asking before spending" above).
- \`raise-art-budget\` (the numbers are in \`error.message\`; do not dispatch again): "I used <used> of your <limit>-credit art budget, so I stopped making new art and audio. You can raise the budget once this turn ends." / 美术预算 <limit> 积分已用 <used>,新素材先做到这里 —— 这一轮结束后可以调高预算。
- \`retry-later\`: "Image generation is unsteady right now. Trying again shortly usually works." / 图片生成这会儿不稳定 —— 过一会儿再试通常就好。
- \`update-app\`: "${PRODUCT_NAME} needs an update before it can generate images." / 需要更新 ${PRODUCT_NAME} 才能生成图片。
- \`unsupported\`: "Image generation isn't available in this run. Add the file yourself, or enable media generation and ask again." / 这次运行不能生成图片 —— 可以自己放入素材文件,或开启媒体生成后再试。
- \`contact-support\`, or no \`nextStep\` at all: "The image didn't come out, and it isn't anything you did. Try again; if it keeps happening, contact us." / 图片没生成出来,不是你的操作有误 —— 重试一般能恢复;反复出现的话联系我们。

For video and audio swap the medium (视频 / 音频 for 图片).`;

/**
 * Media generation contract for OpenPixo game projects. The caller renders it
 * and passes it into `composeOpenPixoGamePrompt` as `mediaContractBlock`.
 */
export function renderGameMediaGenerationContract(input: GameMediaContractInput = {}): string {
  if (input.mediaExecution?.mode === 'disabled') {
    const scope = gameMediaPolicyScope(input.mediaExecution);
    return [
      GAME_MEDIA_CONTRACT_HEADING,
      'Host media generation is **disabled for this run**. Do not call `"$PIXO_NODE_BIN" "$PIXO_BIN" media generate`, media provider APIs, local renderers, or scripts that create image, audio, or video bytes on the host\'s behalf. External MCP media tools explicitly configured for this run are outside this policy.',
      'If the request needs a new image, audio, or video file and no such tool is available, do the rest of the work, do not reference a file that does not exist, and tell the user in one sentence: "Media generation is off for this run. Add the asset yourself, or turn it on and ask again." Simplified Chinese, exactly: 这次运行关闭了媒体生成 —— 可以自己放入素材文件,或开启后再试。',
      'Never claim a file was generated and never emit an `<artifact>` block for media.',
      ...(scope ? [scope] : []),
    ].join('\n\n');
  }
  const sidecar = gameImportSidecarLine(input.engineProfile);
  return `${GAME_MEDIA_CONTRACT_HEADING}

Images, audio, and video for the game come only from the host dispatcher. Never
write media bytes by hand, never pass off a drawn stand-in (SVG, canvas,
solid-color PNG, a copied stock file) as the generated asset, and never emit
\`<artifact>\` blocks for media.

### Invocation

The host sets \`PIXO_NODE_BIN\`, \`PIXO_BIN\`, \`PIXO_PROJECT_ID\`, and \`PIXO_PROJECT_DIR\`
(the project root). If they are unset you are running outside ${PRODUCT_NAME}; say
so and skip media generation.

\`\`\`bash
"$PIXO_NODE_BIN" "$PIXO_BIN" media generate \\
  --project "$PIXO_PROJECT_ID" \\
  --surface <image|video|audio|model3d> \\
  --model <model-id> \\
  --output <project-relative path inside an asset root> \\
  --prompt "<full prompt>" \\
  [--size <W>x<H> | --width <px> [--height <px>]] [--transparent | --background scene] \\
  [--sheet <C>x<R> [--names a,b,...] [--frames]] \\
  [--aspect 1:1|16:9|9:16|4:3|3:4] [--quality <tier>] [--resolution <res>] \\
  [--length <seconds>] [--duration <seconds>] [--audio-kind music|speech|sfx] \\
  [--voice <provider-voice-id>] [--language <lang>] [--prompt-influence <0-1>] [--loop]
\`\`\`

PowerShell: \`& $env:PIXO_NODE_BIN $env:PIXO_BIN media generate --project $env:PIXO_PROJECT_ID ...\`.
Always quote the prompt; never splice unquoted user text into the command.
Run the dispatcher first. Do not replace it with curl, provider SDKs, or your own
scripts, and do not probe the daemon before the first attempt.

### Where the file goes

${gameAssetRootsLine(input.engineProfile)}
- Put it in the subfolder where assets of the same kind already live, and match the existing naming: case, separators, prefixes, size or frame suffixes, and the format the loader expects.
- Never write outside the project, or into build output and caches (\`dist/\`, \`build/\`, \`.godot/\`, \`Library/\`, \`node_modules/\`).
- Do not overwrite an existing asset unless the user asked to replace it; pick a new name instead.
${sidecar ? `${sidecar}\n` : ''}- Size, transparency and a sheet's grid are flags, not prompt words. Put other exact needs in the prompt: tileable edges, loopable audio. Do not read the generated binary back into your context; the returned \`file.width\` / \`file.height\` are the written size.

${GAME_ART_DECISION_RULES}

${GAME_SMALL_ART_SET_RULES}

${GAME_ANIMATED_CHARACTER_RULES}

### Wire it in

A generated file that nothing references is not done. Reference it from the
code or scene the request is about (preload/loader call, scene or prefab field,
resource, audio player), using the loading pattern the project already uses.
In your summary, list every generated file path and where it is referenced.

### Long renders

An image's \`file.note\` says what the service rendered, what the file became and
what it cost; read it before the next call.

\`media generate\` waits up to ~25 s and prints either \`{"file":{...}}\` or
\`{"taskId":"...","nextSince":n}\`. On a \`taskId\`, loop
\`"$PIXO_NODE_BIN" "$PIXO_BIN" media wait <taskId> --since <nextSince>\`: exit \`0\` is
done (last stdout line is \`{"file":{...}}\`), exit \`2\` is still running (repeat
with the returned \`nextSince\`; not an error), exit \`5\` is failed. Never say a
render started or finished unless the command ran and returned that.

${gameModelSection(input)}

${GAME_MEDIA_FAILURE_RULES}`;
}
