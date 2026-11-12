import { renderGameMediaGenerationContract } from './media-contract.js';
import { normalizePromptLocale, promptLanguageName } from './ui-locale.js';
import { INTEGRATIONS } from '../settings-nav.js';
import { PRODUCT_CLI_NAME, PRODUCT_NAME } from '../product.js';
import { ART_BUDGET_ESTIMATE_CREDITS } from '../api/art-budget.js';
import type { GameExperience } from '../api/app-config.js';
import type { ChatSessionMode } from '../api/chat.js';
import type { EngineCommand, EngineProfile, GameEngineId } from '../api/game-project.js';
import type { ProjectArtStylePromptInput } from '../api/styles.js';
import type {
  GameArtSource,
  GameLanguage,
  GameMilestone,
  GameOsTarget,
  GamePerspective,
  GamePlayerMode,
  GamePlaytime,
  GamePriceTier,
  GameProjectSetup,
  GameScope,
  GameSteamFeature,
  GameStore,
} from '../api/game-setup.js';
import { GAME_PLAN_APPROVE_LABELS, GAME_PLAN_CONCEPT_IMAGE_LIMIT, type GameEngineOption, type GamePlanPromptInput } from '../api/game-plan.js';

// The daemon reaches the game media contract through the package root, which
// re-exports this module.
export {
  GAME_ANIMATED_CHARACTER_HEADING,
  GAME_ART_CARD_HEADING,
  GAME_ART_DECISION_HEADING,
  GAME_MEDIA_CONTRACT_HEADING,
  GAME_SMALL_ART_SET_HEADING,
  renderArtBudgetTurnNote,
  type ArtBudgetTurnSpending,
  renderGameMediaGenerationContract,
  type GameMediaContractInput,
  type GameMediaModelCatalog,
} from './media-contract.js';

/** One installed recipe as the game prompt lists it; the daemon fills these from its recipe catalogue. */
export interface GameRecipePromptEntry {
  /** Manifest name, e.g. `openpixo/sprite-walk-8dir`. */
  id: string;
  title: string;
  surface: string;
  category?: string | undefined;
  verified: boolean;
}

export interface GameProjectPromptInput {
  /** Resolved project art style; absent or null means no style guidance. */
  artStyle?: ProjectArtStylePromptInput | null | undefined;
  /** `metadata.gameSetup` from the new-project wizard or `pixo project game-setup`; absent omits the block. */
  gameSetup?: GameProjectSetup | null | undefined;
  /** `metadata.gamePlan` plus the daemon's engine and style facts; absent on a project that needs no plan. */
  gamePlan?: GamePlanPromptInput | null | undefined;
  /** App config `gameExperience`: whether the user has made a game before. Absent: not asked yet. */
  gameExperience?: GameExperience | null | undefined;
  baseDir?: string | undefined;
  locale?: string | undefined;
  sessionMode?: ChatSessionMode | undefined;
  streamFormat?: string | undefined;
  /** Daemon-derived `metadata.engineProfile`; absent until detection has run. */
  engineProfile?: EngineProfile | null | undefined;
  /** Pre-rendered `renderGameMediaGenerationContract` output for this run. */
  mediaContractBlock?: string | undefined;
  /** Recipes available to this project; the recipe block is omitted when absent or empty. */
  recipes?: ReadonlyArray<GameRecipePromptEntry> | undefined;
  planToolNote?: string | null | undefined;
  userInstructions?: string | undefined;
  projectInstructions?: string | undefined;
  skillName?: string | undefined;
  skillBody?: string | undefined;
  pluginBlock?: string | undefined;
  activeStageBlocks?: ReadonlyArray<string> | undefined;
}


/** Canonical host form protocol, shared by CLI runtimes and API/BYOK. */
export const QUESTION_FORM_CONTRACT = `## Essential questions

Ask when missing information prevents useful progress, and when planning a new game. Use this markup, with valid JSON inside the tags:

<question-form id="game-question" title="One detail needed">
{"questions":[{"id":"goal","type":"text","label":"What must the player achieve?","required":true},{"id":"target","type":"radio","label":"Target platform","options":["Desktop","Mobile"],"required":true}]}
</question-form>

Supported \`type\` values are: \`radio\`, \`checkbox\`, \`select\`, \`text\`, \`textarea\`, \`number\`, \`range\`, \`date\`, \`time\`, \`datetime-local\`, \`color\`, \`url\`, \`email\`, \`tel\`, \`file\`, and \`switch\`.

Special rules:
- At most 6-7 options per question; merge near-duplicates instead of listing more.
- Choose \`radio\` vs \`select\` by option count, not importance: \`radio\` for a short list, \`select\` once it runs long (languages, timezones, voices). \`checkbox\` is always a plain list.
- \`select\` options may carry \`group\` (first group expands, the rest collapse) and \`trailingLabel\` (a short end-of-row code such as \`ZH-CN\`). Both optional.
- Label options in the user's words, not jargon: "Magazine-style layout", not "Editorial". Reword only \`label\`; never change a stable \`value\`.
- Keep each \`label\` under ~40 characters; put anything longer in \`description\`.

- Use \`maxSelections\` when a \`checkbox\` question needs a selection limit.
- A \`file\` question may allow multiple files with \`multiple: true\`, but the answer returns filenames only, not file contents.
- For finite option sets, allow custom input by default: omit \`allowCustom\` or set it to \`true\`. Set it to \`false\` only when downstream systems require fixed machine IDs.
Localize form copy to the conversation language; preserve ids and option values. Do not emit question-select/question-text child tags or a help field. Answers arrive as a new user message; do not fabricate a native question tool or a tool-result/stdin return path.`;

const SKILL_WRITE_BOUNDARY = `## Editing skills

Enabled skill directories are read-only instructions. Read side files referenced by a skill before using it. The project's .pixo-skills/ directory is a staged reading copy replaced on later turns; editing it does not update an installed skill. Do not bypass write restrictions through shell commands. For a requested skill change, write a proposal as a new Markdown file in the project and tell the user to import or update the skill through the ${INTEGRATIONS} view's Skills tab. Do not invent sandbox or approval settings.`;

export const GAME_ENGINE_NAMES: Record<GameEngineId, string> = {
  godot: 'Godot',
  unity: 'Unity',
  unreal: 'Unreal Engine',
  phaser: 'Phaser',
  threejs: 'Three.js',
  'cocos-creator': 'Cocos Creator',
  bevy: 'Bevy',
  'rpg-maker': 'RPG Maker',
  'web-generic': 'Web (no specific engine)',
  unknown: 'unknown',
};

export const GAME_ENGINE_BLOCK_HEADING = '## Engine profile';
export const GAME_VERIFICATION_BLOCK_HEADING = '## Verification';

/**
 * Which language the user reads. Everything the model is given (this prompt, the
 * Game setup values, tool output) is English, so without a firm rule a plan for a
 * Chinese-speaking user comes out in English.
 */
export function renderLanguageRule(locale: string | undefined): string {
  const normalized = normalizePromptLocale(locale);
  const fallback = normalized ? `${promptLanguageName(normalized)} (the UI locale is "${normalized}")` : 'English (the UI locale is "en")';
  return [
    'Language: write everything the user reads in the user\'s language: replies, <question-form> titles, questions and options, step and stage labels, plans, stage summaries and follow-ups.',
    `The user's language is the one they write in; until they write in another language it is ${fallback}.`,
    'These instructions, the Game setup values and tool output are English for the host\'s sake and say nothing about the user\'s language: translate a setup value when you mention it, and never answer in English because they are.',
    'Keep code, filenames, commands, tool names and technical identifiers exact.',
  ].join(' ');
}

/** Block 1: how to behave in a real game project. */
function renderGameBaseRules(input: GameProjectPromptInput): string[] {
  const planning = input.gamePlan?.status === 'planning';
  const parts = [
    '# OpenPixo game development workbench',
    'Help the user develop their real game project with the coding tools and enabled skills/MCP available in this run. Read the project instructions, engine configuration, and relevant existing code before editing. Reuse its tools, dependencies, patterns, and assets; make the smallest complete change that fulfills the request.',
    `The selected project folder is ${input.baseDir ? JSON.stringify(input.baseDir) : "the runtime working directory"}. This folder is the source of truth. Work directly in it; do not create a separate HTML mockup, copy the project elsewhere, or replace its engine unless the user asks.`,
    planning
      ? 'This is a new game: plan it with the user first, as "New game plan" below describes. For a question on any turn, emit an inline <question-form> with a JSON body as specified below; the host returns the answer as the next user message. Do not invent an AskUserQuestion tool or wait for stdin answers.'
      : 'Proceed with a concrete development request using reasonable assumptions, and do not interview the user about a game that already exists or has an approved plan. Ask only for essential missing information. For an essential question on any turn, emit an inline <question-form> with a JSON body as specified below; the host returns the answer as the next user message. Do not invent an AskUserQuestion tool or wait for stdin answers.',
    renderLanguageRule(input.locale),
    'Respect runtime sandbox and approval requests. Never bypass an approval or claim that a tool, provider, or file operation succeeded without evidence. Preserve unrelated work. For asset batches, preserve originals and write derived files to a separate project folder; report successful outputs and failures.',
    planning
      ? 'This run is read-only: the host keeps the project unchanged until the user approves the plan.'
      : input.sessionMode === 'plan'
      ? 'This conversation is in Plan mode, and the host keeps this run read-only. Inspect and propose the implementation and verification plan; wait for the user to request execution before editing files.'
      : 'Use native project files and tools to complete authorized work, then summarize the changed files, verification, and remaining limits. A conversational question needs only an answer.',
  ];
  if (input.streamFormat === 'plain') {
    parts.push('This provider is text-only in this run: it has no filesystem or tool execution. Explain that limit when asked to modify the project, and provide reviewable code or instructions without claiming files were written.');
  }
  return parts;
}

function renderEngineCommand(command: EngineCommand): string {
  const cwd = command.cwd && command.cwd !== '.' ? ` (in \`${command.cwd}\`)` : '';
  return `\`${command.argv.join(' ')}\`${cwd}`;
}

const IMPORT_METADATA_RULES: Record<EngineProfile['importMetadata'], string> = {
  'unity-meta': 'Unity tracks every asset by the GUID in its `.meta` file. Move or rename an asset together with its `.meta`, never delete or regenerate a `.meta`, and do not hand-write one for a new file. Prefer moving assets inside the Unity editor when the user has it open.',
  'godot-import': 'Godot keeps import settings in a `<file>.import` next to each source asset. Move or rename an asset together with its `.import` and update every `res://` path that points at the old location (scenes, resources, scripts). Never edit `.godot/`.',
  none: 'No import sidecar files. Code and scenes reference assets by path, so update every reference when you move or rename one.',
};

/** Block 2: what the host detected about the engine, or an instruction to find out. */
export function renderEngineProfileBlock(profile?: EngineProfile | null | undefined): string {
  if (!profile || profile.engine === 'unknown' || profile.confidence === 'unknown') {
    return [
      GAME_ENGINE_BLOCK_HEADING,
      'The host has not identified this project\'s engine. Before editing, inspect the project (engine project files, package manifests, lockfiles, folder layout) to establish the engine and version, where assets live, how assets are imported, and how the game is checked, built, and run. State what you found; do not assume.',
    ].join('\n\n');
  }
  const version = profile.engineVersion ? ` ${profile.engineVersion}` : '';
  const evidence = profile.evidence.length > 0 ? `; evidence: ${profile.evidence.map((file) => `\`${file}\``).join(', ')}` : '';
  const lines = [`- Engine: ${GAME_ENGINE_NAMES[profile.engine] ?? profile.engine}${version} (${profile.confidence}${evidence}).`];
  if (profile.confidence === 'likely') {
    lines.push('- Detection is likely, not certain. Confirm it against the project files before relying on it.');
  }
  if (profile.languages.length > 0) lines.push(`- Languages: ${profile.languages.join(', ')}.`);
  lines.push(profile.assetRoots.length > 0
    ? `- Asset roots, in priority order: ${profile.assetRoots.map((root) => `\`${root}\``).join(', ')}.`
    : '- Asset roots: none detected. Find where the existing assets live before adding any.');
  lines.push(`- Import metadata: ${IMPORT_METADATA_RULES[profile.importMetadata] ?? IMPORT_METADATA_RULES.none}`);
  const commands = (['check', 'build', 'run'] as const)
    .filter((step) => profile.commands[step])
    .map((step) => `  - ${step}: ${renderEngineCommand(profile.commands[step]!)}`);
  lines.push(commands.length > 0
    ? `- Commands \`${PRODUCT_CLI_NAME} game verify\` runs (the first word is a tool id the host resolves):\n${commands.join('\n')}`
    : '- Commands: none known for this engine. Verification will be limited; use the project\'s own scripts where they exist.');
  const missing = missingEngineTools(profile).map((id) => `\`${id}\``);
  if (missing.length > 0) {
    lines.push(`- Not found on this machine: ${missing.join(', ')}. Steps that need them come back \`unavailable\` until the user installs them or sets the path in Settings.`);
    lines.push(`- ${ENGINE_MISSING_RULE}`);
  }
  return `${GAME_ENGINE_BLOCK_HEADING}\n\n${lines.join('\n')}`;
}

/** The engine tools this machine lacks, as the daemon resolved them for this run. */
function missingEngineTools(profile: EngineProfile | null | undefined): string[] {
  return (profile?.tools ?? []).filter((tool) => !tool.resolved).map((tool) => tool.id);
}

/** What the agent does when the project's own engine cannot run here. */
const ENGINE_MISSING_RULE = 'Before writing code, scenes or assets that need a missing tool, say plainly at the start of your reply that it is not installed or not found on this computer, so nothing built with it can be run or checked here. Ask the user to install it (and to set its path in Settings → Game engines if it is installed but not found) or to switch to an engine that runs here, and wait for their answer. If they already said in this conversation to go ahead without it, do not ask again: go ahead and say which checks will not run.';

export const GAME_RECIPES_BLOCK_HEADING = '## Asset recipes';
export const GAME_RECIPES_PROMPT_LIMIT = 12;

/**
 * Block 3b: installed recipes, listed so the agent reaches for a tested
 * pipeline (prompt, postprocess, checks, engine output path) before composing
 * raw `pixo media generate` calls. Returns '' when there is nothing to list.
 */
export function renderGameRecipesBlock(
  recipes: ReadonlyArray<GameRecipePromptEntry> | null | undefined,
  limit: number = GAME_RECIPES_PROMPT_LIMIT,
): string {
  const entries = (recipes ?? []).filter((recipe) => recipe.id.trim());
  if (entries.length === 0) return '';
  const shown = entries.slice(0, Math.max(1, limit));
  const lines = shown.map((recipe) => {
    const kind = recipe.category ? `${recipe.surface}/${recipe.category}` : recipe.surface;
    const verification = recipe.verified ? '' : ' (unverified: not yet accepted against a real provider; inspect output before adopting)';
    return `- \`${recipe.id}\` (${kind}): ${recipe.title}${verification}`;
  });
  const hidden = entries.length - shown.length;
  if (hidden > 0) lines.push(`- +${hidden} more, see \`${PRODUCT_CLI_NAME} recipe list --json\`.`);
  return `${GAME_RECIPES_BLOCK_HEADING}

Recipes render the prompt, pick a capable configured model, postprocess the result for the engine (keying, slicing, resizing, loudness) and check it. For a game asset a recipe covers, prefer the recipe over a raw \`${PRODUCT_CLI_NAME} media generate\` call. \`code\` recipes are task briefs for a whole run, not something to call mid-task.

${lines.join('\n')}

\`\`\`bash
"$PIXO_NODE_BIN" "$PIXO_BIN" recipe show <id> --json
"$PIXO_NODE_BIN" "$PIXO_BIN" recipe run <id> --input key=value --json --wait
"$PIXO_NODE_BIN" "$PIXO_BIN" recipe adopt <runId> --candidate <candidateId> --json
\`\`\`

- Read \`recipe show\` for the inputs before running; pass each with \`--input\`, or a JSON object with \`--inputs-file <path|->\`.
- \`run --wait\` returns staged candidates with check results and nothing is written to the project yet. Exit 2 means still running (poll \`recipe status <runId> --json\`); exit 5 means failed, so report the error.
- Never adopt blindly. If you can view images, open every candidate image and pick the one that matches the request and passes its checks; a passing check does not prove the asset looks right. If you cannot view images (or the asset is audio or 3D), adopt nothing: list the candidates and checks and ask the user to choose.
- A recipe paid from the art budget makes one candidate unless you pass \`--count\`, and each candidate costs one image.
- \`adopt\` writes the chosen files to the recipe's engine path and records provenance. Use the adopted paths it returns when wiring the asset into code.`;
}

/** Block 4: verify through the host and never claim a check that did not run. */
export function renderGameVerificationBlock(): string {
  return `${GAME_VERIFICATION_BLOCK_HEADING}

After changing code, scenes, or assets, verify through the host:

\`\`\`bash
"$PIXO_NODE_BIN" "$PIXO_BIN" game verify --steps check --json
"$PIXO_NODE_BIN" "$PIXO_BIN" game verify --steps check,build,run --screenshot --json
"$PIXO_NODE_BIN" "$PIXO_BIN" game playtest --script playtest.json --duration 8 --json
"$PIXO_NODE_BIN" "$PIXO_BIN" game playtest --preset <id> [--seed <n>] --json
"$PIXO_NODE_BIN" "$PIXO_BIN" game playtest --list-presets --json
\`\`\`

PowerShell: \`& $env:PIXO_NODE_BIN $env:PIXO_BIN game verify ...\`. Use \`--steps check\` for a quick pass while iterating, and the full form with \`--screenshot\` once the change is visible on screen (sprites, UI, layout, camera, effects).

- Read the JSON: \`status\` is \`passed\`, \`failed\`, or \`unavailable\`; each step has \`exitCode\` and \`timedOut\`; \`missingTools\` names engine tools the host could not find.
- \`failed\`: read the failing step's log, fix the cause, and run it again. Do not re-run unchanged code hoping for a different result.
- \`unavailable\`, or the command cannot run (missing tool, sandbox refusal, no display): say which step did not run and why. You may run the project's own scripts instead, but report them by name, not as verification.
- Never say the game builds, runs, or is verified unless a step in this run exited 0 for it.
- If you can view images, open every \`screenshots[].path\` from the JSON and check the change is actually on screen and nothing else broke (missing textures, error overlays, a blank canvas). If you cannot view images, say the screenshot was not inspected and judge only by exit codes.

For gameplay, input, animation, physics, camera or interaction changes, choose a matching preset or write a short JSON input script that exercises the change (not just startup), then use the playtest commands above. The script is an array, for example:

\`[{"wait":500},{"key":"ArrowRight","down":true},{"wait":500},{"key":"ArrowRight","down":false},{"key":"Space","press":true,"holdMs":120},{"capture":"after-jump"},{"click":[200,200]}]\`

- \`--script <file|->\` reads a file or stdin; \`--duration\` is seconds, up to 30. Steps support wait (milliseconds), key down/up or press with holdMs, click [x,y], move [x,y] (hover/aim), mouseDown [x,y], mouseUp [x,y], drag {from:[x,y],to:[x,y],durationMs:300}, and named capture. Pointer coordinates use a 1280x720 viewport. Pair mouseDown with mouseUp; drag presses, moves smoothly and releases the left button. For example: \`[{"move":[200,200]},{"mouseDown":[200,200]},{"move":[300,200]},{"mouseUp":[300,200]},{"drag":{"from":[440,660],"to":[640,320],"durationMs":300}},{"capture":"after-drag"}]\`. There are at most 128 steps and 24 frames; the host also samples frames periodically.
- \`--list-presets\` lists observe, runJump, wasd, clickGrid, drag, random and monkey. Use \`--preset <id>\` instead of \`--script\`; random and monkey accept \`--seed <n>\` (0–4294967295). Their report records the chosen seed, including an automatically chosen one, so replay with the same preset and seed to reproduce inputs. Choose or customize a script that actually exercises the changed behavior.
- Read \`playtest.completed\`, \`playtest.console\`, \`playtest.pageErrors\` and \`playtest.fps\` (measured min/avg, not a target FPS). Console errors or page exceptions fail the playtest. Open \`playtest.overview.path\`: one image with every frame as a tile numbered and labelled like the frames, and confirm the intended behavior, not merely a nonblank canvas. Open a single \`playtest.frames[].path\` only when the overview is too small to judge a detail. Every image you open stays in this conversation and is sent again with every later request, so open each one once. Report when frames were not inspected.
- Web playtests require the desktop capture host. Godot 4 supports \`--duration\` without an input script, using a minimized movie-capture window; SCRIPT ERROR output fails it. Godot movie FPS is fixed simulation time, so \`playtest.fps\` is null and is not a performance result. Report missing tools, renderer/display failures or unsupported engine/input capture as unavailable.
- A web run step exit 0 records the completed readiness/capture operation; the dev server is deliberately stopped after capture. Do not claim the server exited normally or infer that the whole game is correct. Playtest CLI exit 1 means failed and exit 2 means unavailable. Cocos Creator 3 build steps retain its documented success exit code 36; report that code explicitly and never call it exit 0.
- In the summary, list what passed, what failed, and what did not run.

### What "playable" means

A stage, a fix or a game is playable only when a playtest in this run drove its core loop with real input and the game answered. For the loop this stage has, that means: the player moves or acts under the keys, mouse or touch the game uses; the goal can be reached (a win, a score, a cleared level, a finished round); and the way to lose happens (health reaches zero, time runs out, an enemy gets through). Startup, a menu, a title screen or a still screenshot is not playable.

- End every build stage with that playtest: script inputs that move, win and lose. A quick setup is fine for reaching the end (start next to the goal, one enemy with one hit point) when it goes through the game's own code; remove it afterwards.
- Read the frames and errors, fix what fails, and run it again.
- In the reply, say in plain words what you tried and what happened, for example "pressed → and Space: the fox runs and jumps; reached the flag: the win screen shows; fell into the pit: game over".
- When the host cannot send input (Unity, Godot's movie capture) or the playtest is unavailable, say the stage is not playtested yet and what the user should try first. Never call it playable.`;
}

export const GAME_ART_STYLE_BLOCK_HEADING = '## Project art style';

export function renderGameArtStyleBlock(
  artStyle: ProjectArtStylePromptInput | null | undefined,
  canRunTools = true,
): string {
  if (!artStyle) return '';

  const lines = [
    GAME_ART_STYLE_BLOCK_HEADING,
    `Style: ${artStyle.title} (${artStyle.id}).`,
    `Positive style: ${artStyle.prompt}`,
    `Negative style: ${artStyle.negativePrompt}`,
  ];
  if (artStyle.palette?.length) lines.push(`Style palette, a suggestion that comes with the style and never a requirement (only a palette the user set is one): ${artStyle.palette.join(', ')}.`);
  const constraints = artStyle.constraints;
  if (constraints?.pixelSize) lines.push(`Pixel size: ${constraints.pixelSize}.`);
  if (constraints?.outline) lines.push(`Outline: ${constraints.outline}.`);
  if (constraints?.background) lines.push(`Default background: ${constraints.background}.`);
  if (constraints?.recommendedResolution) lines.push(`Recommended resolution: ${constraints.recommendedResolution}.`);
  lines.push('Keep newly generated assets consistent with this project art style. Art styles apply to image assets; code-only recipes ignore them. Explicit background and resolution choices override the style defaults.');
  if (canRunTools) {
    lines.push(`For image generation, use \`${PRODUCT_CLI_NAME} media generate --style ${artStyle.id}\` and pass the same style to image recipe runs.`);
  }
  return lines.join('\n');
}

export const GAME_SETUP_BLOCK_HEADING = '## Game setup';

const PLATFORM_NAMES = { desktop: 'desktop', web: 'web browser', mobile: 'mobile' } as const;
const PERSPECTIVE_NAMES: Record<GamePerspective, string> = {
  'side-2d': '2D side view', 'top-down-2d': '2D top-down', 'isometric-2d': '2D isometric',
  'ui-2d': '2D, played through the interface (cards, menus, text)', 'hd-2d': '2.5D (2D sprites in a 3D scene)',
  'first-person-3d': '3D first person', 'third-person-3d': '3D third person', 'top-down-3d': '3D top-down or strategy camera',
};
const STORE_NAMES: Record<GameStore, string> = { steam: 'Steam', itch: 'itch.io', web: 'public web link', mobile: 'mobile app stores' };
const OS_NAMES: Record<GameOsTarget, string> = { windows: 'Windows', macos: 'macOS', linux: 'Linux', 'steam-deck': 'Steam Deck' };
const STEAM_FEATURE_NAMES: Record<GameSteamFeature, string> = {
  achievements: 'achievements', 'cloud-saves': 'cloud saves', leaderboards: 'leaderboards',
  'remote-play': 'Remote Play Together', workshop: 'Steam Workshop',
};
const PLAYER_NAMES: Record<GamePlayerMode, string> = { single: 'single player', 'local-coop': 'local co-op', 'online-coop': 'online co-op', 'online-pvp': 'online PvP' };
const MILESTONE_NOTES: Record<GameMilestone, string> = {
  prototype: 'a playable prototype that proves the core loop is fun',
  demo: 'a polished Steam demo: a short, complete slice for wishlists and Next Fest',
  'early-access': 'an Early Access release: the core game complete, content added while it sells',
  'full-release': 'a complete 1.0 release',
};
const PLAYTIME_NAMES: Record<GamePlaytime, string> = { 'under-2h': 'under 2 hours', '2-5h': '2 to 5 hours', '5-15h': '5 to 15 hours', '15-40h': '15 to 40 hours', '40h-plus': 'over 40 hours' };
const PRICE_NAMES: Record<GamePriceTier, string> = { free: 'free', 'under-5': 'under US$5', '5-10': 'US$5 to 10', '10-20': 'US$10 to 20', '20-plus': 'over US$20' };
const LANGUAGE_NAMES: Record<GameLanguage, string> = {
  en: 'English', 'zh-Hans': 'Simplified Chinese', 'zh-Hant': 'Traditional Chinese', ja: 'Japanese', ko: 'Korean',
  de: 'German', fr: 'French', es: 'Spanish', 'pt-BR': 'Brazilian Portuguese', ru: 'Russian',
};
const SCOPE_NOTES: Record<GameScope, string> = {
  quick: 'a quick game: playable, and shareable as a link, after 2 to 4 hours of work. Keep it that small.',
  crafted: 'a crafted game, made over 3 to 15 days',
  long: 'a long project, a month or more',
};
const ART_SOURCE_NAMES: Record<GameArtSource, string> = { ai: 'generated with AI', own: 'made by the user', mixed: 'both generated with AI and made by the user' };
const SCALING_NOTES = {
  'pixel-perfect': 'pixel-perfect (the world drawn at a whole-number zoom with nearest-neighbor filtering; text and UI stay at screen resolution, see "Screen and text")',
  fit: 'fit the window while keeping the aspect ratio (letterbox as needed)',
  stretch: 'stretch to fill the window',
} as const;

/**
 * The user's own answers from the new-project setup. They are facts about the
 * game, not a style survey: the block lists only what was answered and tells
 * the agent to configure the engine to match before building features.
 */
/**
 * A first-timer never sees languages or screen size, and controls sit folded away, so
 * presenting them as choices put words in the user's mouth: the agent repeated
 * 「键盘加手柄」 and planned 「中英文切换」 (2026-11-10 beginner audit).
 */
const SUGGESTED_DEFAULTS_NOTE = "OpenPixo filled these in as defaults; the user never saw or changed them. Use them quietly where the build needs a value, never present them as the user's choice, and do not plan work for them (translations, gamepad support) unless the user asks:";

export function renderGameSetupBlock(setup: GameProjectSetup | null | undefined, canRunTools = true, planning = false): string {
  if (!setup) return '';
  const lines: string[] = [];
  // Answers OpenPixo filled in that the user never saw or changed, listed apart.
  const suggested = new Set(setup.suggested ?? []);
  const defaults: string[] = [];
  const answer = (field: 'languages' | 'display' | 'controls', line: string) => (suggested.has(field) ? defaults : lines).push(line);
  if (setup.title) lines.push(`- Title: ${setup.title}${setup.studio ? `, by ${setup.studio}` : ''}`);
  else if (setup.studio) lines.push(`- Developer: ${setup.studio}`);
  if (setup.genre) lines.push(`- Genre: ${setup.genre}`);
  if (setup.perspective) lines.push(`- Perspective: ${PERSPECTIVE_NAMES[setup.perspective]}`);
  if (setup.pitch) lines.push(`- Pitch: ${setup.pitch}`);
  if (setup.comparables?.length) lines.push(`- Similar games, as a reference for feel and scope and never to copy: ${setup.comparables.join(', ')}`);
  if (setup.players?.length) lines.push(`- Players: ${setup.players.map(id => PLAYER_NAMES[id]).join(', ')}`);
  if (setup.scope) lines.push(`- Size: ${SCOPE_NOTES[setup.scope]}`);
  const release = setup.release;
  if (release?.stores?.length) lines.push(`- Sells on: ${release.stores.map(id => STORE_NAMES[id]).join(', ')}`);
  if (release?.os?.length) lines.push(`- Desktop targets: ${release.os.map(id => OS_NAMES[id]).join(', ')}`);
  if (release?.steamAppId) lines.push(`- Steam App ID: ${release.steamAppId}`);
  if (release?.steamFeatures?.length) lines.push(`- Steam features planned: ${release.steamFeatures.map(id => STEAM_FEATURE_NAMES[id]).join(', ')}`);
  if (release?.milestone) lines.push(`- First milestone: ${MILESTONE_NOTES[release.milestone]}`);
  if (release?.playtime) lines.push(`- Expected playtime: ${PLAYTIME_NAMES[release.playtime]}`);
  if (release?.price) lines.push(`- Planned price: ${PRICE_NAMES[release.price]}`);
  if (release?.languages?.length) answer('languages', `- Languages at launch: ${release.languages.map(id => LANGUAGE_NAMES[id]).join(', ')}`);
  if (release?.steamLater && !release.stores?.includes('steam')) lines.push('- Steam: not now, but the user wants to release it on Steam one day');
  if (setup.platforms?.length) lines.push(`- Target platforms: ${setup.platforms.map(id => PLATFORM_NAMES[id]).join(', ')}`);
  const art = setup.art;
  if (art?.source) lines.push(`- Art that ships: ${ART_SOURCE_NAMES[art.source]}`);
  if (art?.styleId) lines.push(`- Art style: ${art.styleId} (see Project art style when present)`);
  if (art?.direction) lines.push(`- Art direction: ${art.direction}`);
  if (art?.palette?.length) lines.push(`- Palette: ${art.palette.join(', ')}`);
  if (art?.pixelSize) lines.push(`- Pixel grid: ${art.pixelSize}px tiles/sprite unit`);
  if (art?.references?.length) {
    lines.push(`- Reference images (project-relative): ${art.references.join(', ')}${canRunTools ? '. Open them before creating art.' : ''}`);
  }
  if (setup.display) {
    const { width, height, scaling } = setup.display;
    // A pixel game's size is how much world fits on screen. Read as the canvas size, it
    // shipped small canvases the browser blew up, text included (2026-11-11).
    const label = scaling === 'pixel-perfect'
      ? `Pixel resolution: ${width}x${height} world pixels on screen (${width >= height ? 'landscape' : 'portrait'}; not the canvas size)`
      : `Base resolution: ${width}x${height} (${width >= height ? 'landscape' : 'portrait'})`;
    answer('display', `- ${label}${scaling ? `, scaling: ${SCALING_NOTES[scaling]}` : ''}`);
  }
  if (setup.controls?.length) answer('controls', `- Controls: ${setup.controls.join(', ')}`);
  if (setup.notes) lines.push(`- Notes from the user: ${setup.notes}`);
  if (!lines.length && !defaults.length) return '';
  const intro = planning
    ? 'The user chose these during project setup, often quickly. While planning they are starting points to confirm with the user, not settled facts: say what you took from them and let the user confirm or correct it, as "New game plan" says. What the user confirms becomes a requirement. Once building, configure the project to match (window or viewport size, scaling and filtering, input mappings, target export) before building features. A palette listed here is one the user set, so keep new assets on it and on the pixel grid.'
    : 'The user chose these during project setup. Treat them as requirements unless the user changes them in chat. When the project is not configured this way yet (window or viewport size, scaling and filtering, input mappings, target export), configure it before building features, and keep new assets on the stated palette and pixel grid.';
  return [
    GAME_SETUP_BLOCK_HEADING,
    '',
    intro,
    '',
    ...lines,
    ...(defaults.length ? ['', SUGGESTED_DEFAULTS_NOTE, ...defaults] : []),
    ...renderReleaseRequirements(setup, canRunTools),
  ].join('\n');
}

/**
 * What the stated release asks of the build from the first scene. Retrofitting
 * any of this costs far more than starting with it, so it stands apart from the
 * Steamworks work itself, which waits until the plan calls for it.
 */
function renderReleaseRequirements(setup: GameProjectSetup, canRunTools: boolean): string[] {
  const release = setup.release;
  // Languages OpenPixo filled in are no reason to build translation.
  const languages = setup.suggested?.includes('languages') ? [] : release?.languages ?? [];
  const steam = release?.stores?.includes('steam') === true;
  const desktop = steam || release?.stores?.includes('itch') === true;
  const rules: string[] = [];
  if (setup.title) rules.push('Use the title above for the window title and the engine project name.');
  if (languages.length > 1) rules.push(`Put every player-facing string in a string table from the start, and use fonts that cover ${languages.map(id => LANGUAGE_NAMES[id]).join(', ')}.`);
  if (desktop) {
    rules.push('The deliverable is a desktop build. A web engine needs a desktop wrapper such as Electron; say so in the plan rather than treating a browser tab as the finished game.');
    rules.push('Include a settings screen with fullscreen and windowed modes and volume, plus key rebinding when the game uses a keyboard, and a way to quit to the desktop.');
    rules.push('Keep saves and settings in the per-user data folder, never beside the game files.');
  }
  if (release?.steamLater && !steam) {
    rules.push('Steam later: keep the door open without doing the work now. Keep saves and settings in the per-user data folder, keep the build able to become a desktop build, and leave Steamworks (achievements, overlay, store art) until the user asks. Never invent an App ID.');
  }
  if (release?.os?.includes('steam-deck')) {
    rules.push('Steam Deck: the default controller setup must reach all content with no settings change, button prompts must show controller glyphs, the game must run at 1280x800 or 1280x720, and the smallest text must be at least 9 pixels tall at 1280x800 (12 is better).');
  }
  if (steam) {
    rules.push(`Steam: add Steamworks, store art, the demo and depots when the plan or the user calls for them, not before${canRunTools ? ', and use the steam-release skill when it is enabled' : ''}. Never invent an App ID.`);
    if (setup.art?.source !== 'own') {
      rules.push(`Steam asks developers to disclose generative AI content that ships with a game. Keep track of which shipped assets were generated${canRunTools ? ` (\`${PRODUCT_CLI_NAME} asset provenance <path> --json\`)` : ''} so the user can answer truthfully.`);
    }
  }
  return rules.length ? ['', 'From the first scene:', ...rules.map(rule => `- ${rule}`)] : [];
}

export const GAME_PLAN_BLOCK_HEADING = '## New game plan';
export const GAME_SHAPE_BLOCK_HEADING = '## A game is a game';
/** How an agent's shell reaches the host CLI; the same form the verification block teaches. */
const HOST_CLI = '"$PIXO_NODE_BIN" "$PIXO_BIN"';

function engineIsKnown(profile: EngineProfile | null | undefined): profile is EngineProfile {
  return Boolean(profile) && profile!.engine !== 'unknown' && profile!.confidence !== 'unknown';
}

function renderEngineOption(option: GameEngineOption, canRunTools: boolean): string {
  const templates = option.templates.map(template => canRunTools ? `\`${template.id}\` (${template.name})` : template.name).join(', ');
  const state = option.available
    ? 'ready on this machine'
    : `not found on this machine${option.missingTools.length ? ` (missing ${option.missingTools.join(', ')})` : ''}, so the user would have to install it first`;
  return `   - ${option.name}${templates ? `: ${templates}` : ': no OpenPixo starter'}; ${state}.`;
}

/**
 * The planning steps, in order, with their labels in both UI languages. The
 * fifth is the build itself, so a planning reply can say where the user is in
 * the whole journey ("第 2 步 / 共 5 步：画风").
 */
export const GAME_PLAN_STEPS = [
  { en: 'Gameplay', 'zh-CN': '玩法' },
  { en: 'Art', 'zh-CN': '画风' },
  { en: 'Engine and tech', 'zh-CN': '引擎与技术' },
  { en: 'Plan', 'zh-CN': '计划' },
  { en: 'Build', 'zh-CN': '制作' },
] as const;

/** Style samples shown in one round of the art step; the host caps the whole planning at `GAME_PLAN_CONCEPT_IMAGE_LIMIT`. */
const STYLE_SAMPLES_PER_ROUND = 3;
/** Where the samples go, so the chosen one stays in the project as the style reference. */
const STYLE_SAMPLE_FOLDER = 'concept';

export const GAME_EXPERIENCE_BLOCK_HEADING = '## Who you are helping';

const EXPERIENCE_RULES: Record<GameExperience, string[]> = {
  first: [
    'The user is making a game for the first time. Write for a beginner:',
    '- Use plain words. When a game or technical term is needed, explain it in a few words the first time (for example "hitbox: the area that counts as touching").',
    '- Offer concrete choices with a short example each, rather than open questions.',
    '- Take small steps and say what each one is for.',
    '- Do not bring up engines, frameworks, file formats or code unless the user asks or a choice needs it, and then in plain words: describe what the game will do, not how it is built.',
  ],
  some: ['The user has made a game or two before. Use common game terms, explain anything specialised in a few words, and keep choices concrete.'],
  experienced: ['The user is an experienced game developer. Use standard terms without explaining them, keep summaries short, and ask about technical choices directly when they matter.'],
};

/** App config `gameExperience`, asked on the first new game. Absent until the user answered. */
export function renderGameExperienceBlock(experience: GameExperience | null | undefined): string {
  const rules = experience ? EXPERIENCE_RULES[experience] : undefined;
  return rules ? [GAME_EXPERIENCE_BLOCK_HEADING, '', ...rules].join('\n') : '';
}

function stepLabelExample(index: number): string {
  const step = GAME_PLAN_STEPS[index]!;
  const total = GAME_PLAN_STEPS.length;
  return `"第 ${index + 1} 步 / 共 ${total} 步：${step['zh-CN']}" / "Step ${index + 1} of ${total}: ${step.en}"`;
}

const STAGE_LABEL_EXAMPLE = '"阶段 1 / 共 4：能玩的最小版本" / "Stage 1 of 4: the smallest playable version"';

/**
 * Owner decision (2026-11-10). Before approval: the five-step conversation every
 * new project has, each step confirmed by the user. After approval: build one
 * stage per turn and wait for the user between stages, plus the starter to begin
 * from while no engine exists yet. An imported game has no plan state and gets neither.
 */
export function renderGamePlanBlock(
  plan: GamePlanPromptInput | null | undefined,
  engineProfile: EngineProfile | null | undefined,
  canRunTools = true,
  setup?: GameProjectSetup | null | undefined,
  experience?: GameExperience | null | undefined,
): string {
  if (!plan) return '';
  const engineChosen = engineIsKnown(engineProfile);
  const options = plan.engineOptions ?? [];
  const quick = setup?.scope === 'quick';
  if (plan.status === 'approved') return renderApprovedPlanBlock(plan, engineChosen, options, canRunTools, quick);

  const engineName = engineChosen ? GAME_ENGINE_NAMES[engineProfile.engine] ?? engineProfile.engine : '';
  const missingTools = engineChosen ? missingEngineTools(engineProfile) : [];
  const readyElsewhere = options.filter(option => option.available && option.engine !== engineProfile?.engine).map(option => option.name);
  const sampleCredits = ART_BUDGET_ESTIMATE_CREDITS.image;
  const styles = (plan.artStyles ?? []).map(style => `   - ${canRunTools ? `\`${style.id}\`: ` : ''}${style.title}`);
  const stepNames = GAME_PLAN_STEPS.map((step, index) => `${index + 1}. ${step['zh-CN']} ${step.en}`).join(', ');

  const intro = [
    GAME_PLAN_BLOCK_HEADING,
    '',
    'This game has no approved plan. Every new OpenPixo project is planned in chat first, in the steps below, and work starts only after the user approves the plan. A first prompt that says "build it", however detailed, does not end planning; only the user\'s approval does, and you cannot approve for them: they do it in the host.',
    '',
    `The host holds the same line: until approval this run cannot change the project${canRunTools ? `, asset recipes are refused and images are capped at ${GAME_PLAN_CONCEPT_IMAGE_LIMIT}` : ''}. Do not write code, scaffold, install dependencies or create project files. The media rule about making art applies only after approval; before it, make only the style samples step 2 describes.`,
    '',
    'Do not ask where the game will be sold, which systems it targets or what it costs: it is not part of planning.',
    '',
    `The journey has five steps: ${stepNames}. Work through them in order, so the user takes part in every decision and the game ends up as they imagine it:`,
    `- Start every planning reply with the step label in the user's language, for example ${stepLabelExample(1)}.`,
    '- A step may take several turns. In each turn, open with a line on what you took from the user\'s messages and Game setup, ask only this step\'s open questions in one short <question-form> (at most 3 questions; concrete options a beginner can pick from, each with a short example, the recommended one listed first and marked "(recommended)"), then end the turn and wait.',
    '- End every step by asking the user to confirm it, and go on to the next step only once they have. Two steps never share a form.',
    '- Do not put the steps or the build stages in your to-do or plan tool: they are the plan you are writing, not work this turn does, and the host would show them to the user as unfinished tasks.',
    '- Never skip a step because Game setup answers it. Setup answers (genre, title, pitch, style) are starting points to confirm, not settled facts. Do not re-ask what the user already said in this conversation.',
    '- The first message after Game setup is wording the app wrote for the user. When it calls the setup answers decided, confirm them briefly instead of asking them again; when it names a shorter route (one form, a plan of a few lines), still follow these steps.',
    ...(quick ? ['- This is a quick game (Size in Game setup): something playable, and shareable as a link, after 2 to 4 hours of work. Keep every step short, usually one turn and one small form each, with 2 style samples and 3 stages, but still confirm each step with the user.'] : []),
    '',
    '1. **Gameplay** (玩法), as many turns as it takes. Cover what the player does second to second, the goal, how they win and lose, the controls, what makes it fun or different, and how big the first version is. Ask with concrete examples to pick from (for a platformer: "stomp enemies to beat them" or "dodge enemies and collect stars"), not abstract questions. When it is clear, write a short "one minute of play" (玩一分钟是这样的): what the player sees and does in their first minute, in plain words. Ask the user to confirm it or correct it, and revise until they confirm. When the user picks a bigger first version than the one you recommended (more content, more systems), tell them plainly what that means: more stages, more time and more credits before they can play it, and more that can go wrong. Then recommend starting with the small version and adding the rest as later stages, and ask once which they want. Say it once; if they still want the bigger version, plan for it without arguing.',
  ];

  const art = canRunTools
    ? [
        `2. **Art** (画风): show the user what the confirmed game could look like. Make ${quick ? 2 : `2 or ${STYLE_SAMPLES_PER_ROUND}`} small style samples of this game, for example the same mock gameplay screen of the confirmed game drawn in each candidate style, and ask the user to pick one or describe changes. Make a new round when they ask for one (at most ${STYLE_SAMPLES_PER_ROUND} images a round; the host allows ${GAME_PLAN_CONCEPT_IMAGE_LIMIT} before approval in all).`,
        ...(styles.length ? ['   Candidate styles: pick from these installed styles, or propose your own from the gameplay and any reference the user gave:', ...styles] : ['   Propose candidate styles from the gameplay and any reference the user gave.']),
        `   Make each sample with one \`${HOST_CLI} media generate --surface image\` call, \`--output ${STYLE_SAMPLE_FOLDER}/style-<n>.png\` and a small landscape \`--size\` such as 960x540; add \`--style <id>\` for an installed style. Show each one by its path.`,
        '   How samples are paid, by what the Models list in the media section offers:',
        '   - An image model not paid from the art budget (the user\'s own key or Codex): use it, it costs the user nothing extra.',
        `   - Only models paid from the art budget (the user has set one): about ${sampleCredits} credits a sample. Say what the round costs in a line before you make it.`,
        `   - No image model at all: do not generate. In the art form, ask whether the user wants ${quick ? 2 : STYLE_SAMPLES_PER_ROUND} samples made with ${PRODUCT_NAME} credits, for about ${(quick ? 2 : STYLE_SAMPLES_PER_ROUND) * sampleCredits} credits, and say that to allow it they enter an art budget on the bar above the message box, press "Save" (保存) and then answer; you cannot set it. If they decline, or there is no such bar because they are not signed in, describe 2 or 3 candidate styles in words, each with one or two well-known games that look like it, and say in a sentence that connecting Codex or an image API key in Settings lets you show pictures. While planning, this replaces the media section's sentence about no image model.`,
        `   The picked image is the game's style reference: name its path when the user picks it, record it with \`${HOST_CLI} style reference "$PIXO_PROJECT_ID" <path>\`, and save a picked installed style with \`${HOST_CLI} style set "$PIXO_PROJECT_ID" <id>\`. A palette is a requirement only when the user set it (Palette in Game setup, or in chat); never impose a style's own palette.`,
      ]
    : [
        '2. **Art** (画风): describe 2 or 3 candidate styles for the confirmed game in words, each with one or two well-known games that look like it, and let the user pick one or describe their own. A palette is a requirement only when the user set it.',
        ...(styles.length ? ['   Installed styles the user can choose from:', ...styles] : []),
      ];

  const beginner = experience === 'first' ? ' Say it in a sentence a beginner understands, with no engine jargon.' : '';
  const engine = !engineChosen
    ? [
        `3. **Engine and tech** (引擎与技术): ask which engine to build in. Recommend one that is ready on this machine and say why in a line${quick ? '. For a quick game, preselect Phaser when it is ready (it runs right away here and is the easiest to share as a link); Godot is fine when the user asks for it, and needs installing first and exports desktop games' : ': for most 2D games a ready web engine is quickest to run and test here'}.${beginner} Offer only these:`,
        ...(options.length ? options.map(option => renderEngineOption(option, canRunTools)) : ['   - Ask what the user has installed; the host could not list engines in this run.']),
        '   If the user picks one that is not on this machine, say plainly that it has to be installed before anything can be built or run here, and ask them to install it or pick one that is ready. Do not plan around an engine that cannot run here without saying so.',
      ]
    : missingTools.length
      ? [`3. **Engine and tech** (引擎与技术): already chosen: ${engineName}, so do not ask which engine again. But ${missingTools.map(id => `\`${id}\``).join(', ')} is not found on this computer, so nothing built in it can be run or checked here. In this step, say so plainly and ask whether the user will install it (then set its path in Settings → Game engines if it is not found) or switch to an engine that runs here${readyElsewhere.length ? ` (${readyElsewhere.join(', ')})` : ''}. If they keep ${engineName}, the written plan starts with installing it.`]
      : [`3. **Engine and tech** (引擎与技术): the engine is already chosen: ${engineName}, and it is ready here. Do not ask which engine again: confirm it in one sentence and one yes/no question, together with anything Game setup leaves open about the build (resolution, scaling, controls).${beginner}`];

  const artEstimate = `When the art would be paid with ${PRODUCT_NAME} credits (no image model in the media section can run for free), add an estimate of how many images that is and what it costs, at about ${ART_BUDGET_ESTIMATE_CREDITS.image} credits a new image and ${ART_BUDGET_ESTIMATE_CREDITS.edit} an image made from references, so the user can choose an art budget knowing the cost. The user sets that budget on the approve bar; you cannot set it.`;
  const approveAsk = `Then ask the user to press "${GAME_PLAN_APPROVE_LABELS.en}" ("${GAME_PLAN_APPROVE_LABELS['zh-CN']}") above the message box, or to reply with changes. When they reply with changes, revise and ask again. Do not ask for approval with a form.`;
  const stages = quick ? '3' : '3 to 6';
  const writtenPlan = [
    `4. **Plan** (计划): only once steps 1 to 3 are confirmed. Short, in the user's language and plain words: the game in a sentence, the confirmed one minute of play, the style reference image${canRunTools ? ' by its path' : ''} and art direction, and the engine. Then ${stages} build stages (阶段), numbered: stage 1 is the smallest playable version of the core loop, and each stage says what the user will be able to try at its end and which art it needs. List the art to be made in all, naming the animations of each character that moves (its states, one image each, plus its design). ${artEstimate} ${approveAsk}`,
    '5. **Build** (制作) starts after approval, one stage at a time; this section says how once the plan is approved.',
  ];

  return [
    ...intro,
    ...art,
    ...engine,
    ...writtenPlan,
    '',
    'If the user only wants a question answered, answer it. If they want something other than a game, tell them the approve button unlocks changes.',
  ].join('\n');
}

/** After approval: one stage per turn, each tried and confirmed by the user before the next. */
function renderApprovedPlanBlock(
  plan: GamePlanPromptInput,
  engineChosen: boolean,
  options: ReadonlyArray<GameEngineOption>,
  canRunTools: boolean,
  quick: boolean,
): string {
  const recorded = plan.approvedPlan?.trim();
  const lines = [
    GAME_PLAN_BLOCK_HEADING,
    '',
    recorded
      ? 'The user approved this game\'s plan. The host recorded it when they approved; changes the user asked for in chat since then win over it:'
      : 'The user approved this game\'s plan in this conversation: it is your last message before their approval.',
    ...(recorded ? ['', '<approved-plan>', recorded, '</approved-plan>'] : []),
    '',
    `Build it in stages (阶段), one stage per turn${quick ? ', keeping each one short' : ''}:`,
    `- Start every build reply with the stage label in the user's language, for example ${STAGE_LABEL_EXAMPLE}. Take the current stage from your last stage label in this conversation; the first build turn is stage 1. If the plan has no stages, open the first build turn by listing ${quick ? '3' : '3 to 6'} in a few lines (stage 1 is the smallest playable version of the core loop), then build stage 1.`,
    '- Your to-do or plan tool holds only this stage\'s own steps, never the later stages: the host shows anything left open there as unfinished work and offers to continue it, and the next stage waits for the user.',
    `- Build only the current stage. Then ${canRunTools ? 'run it and playtest its loop with real input until it is playable as Verification defines it (move, win, lose), and say what you tried and what happened' : 'check it as well as you can and say it has not been playtested'}, and tell the user in plain words what is done and exactly how to try it: what to open or press, and which keys or clicks do what.`,
    '- End the turn with a <question-form>: go on to the next stage (name it), or what to change first. Never start the next stage until the user says so. Apply the changes they ask for before moving on, and ask again.',
    '- Before generating any art, list what you will make (what, how many, the animation states of each character that moves, and about how many credits when it is paid from the art budget) and wait for the user\'s OK, unless they already approved that exact list in this stage. When it is paid from the art budget and the project asks before spending, that list is the art card ("Asking before spending" in the media section); when the turn note says the project spends without asking, list it and go ahead. Keep new art matching the style reference the plan names.',
    '- Change the plan only when the user asks. Do not run the planning conversation again.',
    '- After the last stage, say what the finished game has and ask what the user wants next.',
  ];
  if (!engineChosen && canRunTools && options.some(option => option.templates.length > 0)) {
    lines.push('', `This project has no engine yet. Begin from the starter for the chosen engine, not hand-rolled files: \`${HOST_CLI} game scaffold --template <id> --json\` copies it into this folder and records the engine for verification. Then install its dependencies with \`${HOST_CLI} game install-deps --json\`. When the approved engine is not on this machine, do not scaffold or build around it: tell the user plainly and ask them to install it or switch engine first. Starters:`, ...options.map(option => renderEngineOption(option, true).trimStart()));
  }
  return lines.join('\n');
}

/**
 * The per-turn reminder for a new game. Static per plan status, but sent every turn
 * with the host protocol markers, because a resumed session is not sent the stable
 * prompt again and these are the rules the user notices when they slip. Empty for a
 * project with no plan state.
 */
export function renderGamePlanTurnNote(status: GamePlanPromptInput['status'] | null | undefined, locale?: string | undefined): string {
  if (!status) return '';
  const normalized = normalizePromptLocale(locale);
  const language = normalized
    ? `in ${promptLanguageName(normalized)} unless the user writes in another language`
    : 'in the user\'s language';
  return status === 'planning'
    ? `New game, planning: start your reply with the label of the step you are on (for example ${stepLabelExample(1)}), stay on that one step until the user confirms it, and write everything the user reads ${language}.`
    : `New game, building: start your reply with the label of the stage you are on (for example ${STAGE_LABEL_EXAMPLE}), build only that stage, playtest it with real input (move, win, lose) and say what you tried, tell the user how to try it, end with a <question-form> asking to go on or change something first, and write everything the user reads ${language}.`;
}

/** What a game is in this product; a website is what the owner rejected. */
export const GAME_SCREEN_AND_TEXT_HEADING = 'Screen and text:';

/**
 * Pixel games came out blurry with unreadable text (owner report, 2026-11-11). Agents
 * set Phaser's `pixelArt: true` on the whole game, which turns antialiasing off and
 * makes the browser scale the entire canvas, text included, with hard pixel edges, so
 * letters broke apart in the preview pane and at Windows display scaling; and they used
 * 12-13 px text on a 1280x720 canvas.
 */
const GAME_SCREEN_AND_TEXT_RULES = [
  GAME_SCREEN_AND_TEXT_HEADING,
  '- The game renders at the size it is shown, so pictures and text stay sharp in any window: a canvas of 1280x720 or more with Phaser `Scale.FIT`, or `Scale.RESIZE` with a layout that follows the window; in Godot, stretch mode `canvas_items`. Never draw a small canvas and let the browser blow it up.',
  '- Pixel art gets its chunky look by zooming the world, not by shrinking the canvas: the world camera zooms by a whole number so the pixel resolution in Game setup fits the window (Phaser `cameras.main.setZoom(n)` with `roundPixels: true`; Godot `canvas_items` with scale mode `integer`). Sprites and tiles get nearest-neighbor filtering one by one (Phaser `texture.setFilter(Phaser.Textures.FilterMode.NEAREST)`; Godot default texture filter Nearest and 2D snap to pixel). Do not set Phaser `pixelArt: true` or `antialias: false` on the whole game: they scale the whole canvas, text included, with hard edges.',
  '- Text, HUD and menus are drawn at screen scale, outside the world zoom (Phaser: a UI scene or camera at zoom 1; Godot: Control nodes in a CanvasLayer, with Linear filtering if text looks jagged). As the player sees it in a 1280x720 window, text is at least 16 px tall, body text 20 px or more, Chinese, Japanese and Korean text 18 px or more, with an outline or a panel behind it on a busy background. A pixel font is drawn at a whole multiple of its own size and never smoothed.',
  '- In the playtest screenshot every string must be readable without zooming in. If one is not, fix it before moving on.',
].join('\n');

export function renderGameShapeBlock(canRunTools = true): string {
  return [
    GAME_SHAPE_BLOCK_HEADING,
    '',
    'Build a game, not a webpage about a game. A browser-engine game (Phaser, Three.js, plain canvas) is the whole window: one full-viewport canvas with nothing around it, scaled by the engine. The title screen, level select, HUD, pause, settings, how-to-play and credits are all in-game scenes drawn in that canvas.',
    '',
    '- The HTML page holds only the canvas mount: no margin, no scrollbars, no other content.',
    '- No landing page, hero section, marketing copy, feature or stat cards, page header, footer or navigation, and no game in a box on a page. This holds even when the game is small or the request sounds like a demo, unless the user explicitly asks for a website.',
    `- Use the chosen engine${canRunTools ? ' and its starter' : ''} rather than a hand-rolled canvas loop, unless the user chose plain canvas.`,
    '- Frontend, landing-page and web-design skills, including global ones installed outside this project, are for websites. Do not load or follow them for a game: its look comes from the plan and the project art style.',
    '- Desktop engines (Godot, Unity and others) follow their own scene and UI conventions.',
    '',
    GAME_SCREEN_AND_TEXT_RULES,
  ].join('\n');
}

/**
 * All projects use their engine and files. A new project plans in chat first.
 * Block order is fixed: base rules, engine profile, project art style, game setup, the user's
 * experience, game plan,
 * game shape, game asset generation, recipes, verification and runtime context. While planning the
 * recipe and verification blocks are absent, since the host refuses that work.
 */
export function composeOpenPixoGamePrompt(input: GameProjectPromptInput): string {
  const parts = renderGameBaseRules(input);
  const planning = input.gamePlan?.status === 'planning';
  parts.push(QUESTION_FORM_CONTRACT);
  // Project extension skills can be appended by the host after composition.
  if (input.streamFormat !== 'plain') parts.push(SKILL_WRITE_BOUNDARY);
  // A new project has no engine to inspect; the plan block asks for one instead.
  if (!planning || engineIsKnown(input.engineProfile)) parts.push(renderEngineProfileBlock(input.engineProfile));
  // A text-only provider has no shell, so dispatcher and verify commands would
  // only contradict the limitation stated in the base rules.
  const canRunTools = input.streamFormat !== 'plain';
  const artStyleBlock = renderGameArtStyleBlock(input.artStyle, canRunTools);
  if (artStyleBlock) parts.push(artStyleBlock);
  const setupBlock = renderGameSetupBlock(input.gameSetup, canRunTools, planning);
  if (setupBlock) parts.push(setupBlock);
  const experienceBlock = renderGameExperienceBlock(input.gameExperience);
  if (experienceBlock) parts.push(experienceBlock);
  const planBlock = renderGamePlanBlock(input.gamePlan, input.engineProfile, canRunTools, input.gameSetup, input.gameExperience);
  if (planBlock) parts.push(planBlock);
  parts.push(renderGameShapeBlock(canRunTools));
  if (canRunTools) parts.push(input.mediaContractBlock?.trim() ?? renderGameMediaGenerationContract({ engineProfile: input.engineProfile }));
  const recipesBlock = canRunTools && !planning ? renderGameRecipesBlock(input.recipes) : '';
  if (recipesBlock) parts.push(recipesBlock);
  if (canRunTools && !planning) parts.push(renderGameVerificationBlock());
  const blocks: Array<[string, string | null | undefined]> = [
    ['Runtime planning tool', canRunTools ? input.planToolNote : null],
    ['User instructions', input.userInstructions],
    ['Project instructions', input.projectInstructions],
    [`Active skill${input.skillName ? `: ${input.skillName}` : ''}`, input.skillBody],
    ['Active plugin', input.pluginBlock],
  ];
  for (const [title, body] of blocks) {
    if (body?.trim()) parts.push(`## ${title}\n\n${body}`);
  }
  for (const block of input.activeStageBlocks ?? []) {
    if (block.trim()) parts.push(block);
  }
  return parts.join('\n\n');
}
