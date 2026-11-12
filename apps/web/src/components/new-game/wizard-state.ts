// Pure state behind the new-game setup and the in-project "finish setup"
// dialog: the draft shape, which screens the dialog shows and what each one
// requires, what each screen suggests from the earlier answers, the draft that
// survives closing the dialog, and the GameProjectSetup the daemon stores.
import {
  GAME_PERSPECTIVES,
  GAME_SETUP_LIMITS,
  GAME_SETUP_SUGGESTED_FIELDS,
  gameFolderNameProblem,
  gamePlatformsForStores,
  type GameArtSource,
  type GameControlScheme,
  type GameEngineOption,
  type GameExperience,
  type GameLanguage,
  type GameMilestone,
  type GameOsTarget,
  type GamePerspective,
  type GamePlayerMode,
  type GamePlaytime,
  type GamePriceTier,
  type GameProjectSetup,
  type GameScalingMode,
  type GameScope,
  type GameSetupSuggestedField,
  type GameSteamFeature,
  type GameStore,
  type GameTargetPlatform,
  type GameTemplateSummary,
} from '@openpixo/contracts';
import type { Dict } from '../../i18n/types';
import { splitTemplateName } from '../new-game-target';

/**
 * Every screen the dialog can show, in order. One main question each:
 * - experience: asked once, on the first new game, then remembered in app config;
 * - size: how big this game is, asked every time with the last answer chosen;
 * - concept: name, genre and who plays (languages under "More settings");
 * - view: how the player sees the game;
 * - art: the look;
 * - setup: the engine (create) and the technical defaults under "More settings";
 * - review: a short summary, where it goes, and what happens next.
 * Where to sell, systems, Steam features, milestone, playtime and price are no
 * longer asked; older setups keep them (see `legacy` fields below).
 */
export const WIZARD_STEP_IDS = ['experience', 'size', 'concept', 'view', 'art', 'setup', 'review'] as const;
export type WizardStepId = (typeof WIZARD_STEP_IDS)[number];

/** The screens for this dialog: an existing project, or a user who already answered, is not asked about experience. */
export function wizardSteps(mode: WizardMode, askExperience = false): WizardStepId[] {
  return WIZARD_STEP_IDS.filter(id => id !== 'experience' || (mode === 'create' && askExperience));
}

export const SAMPLE_TEMPLATE_ID = 'phaser3-sample-platformer';

/** Grouped the way players browse a store. */
export const GENRE_GROUPS = [
  { id: 'action', genres: ['platformer', 'metroidvania', 'shooter', 'survivors', 'hack-slash', 'fighting'] },
  { id: 'rpg', genres: ['action-rpg', 'turn-based-rpg', 'roguelike', 'deckbuilder'] },
  { id: 'strategy', genres: ['tower-defense', 'tactics', 'rts', 'auto-battler'] },
  { id: 'sim', genres: ['life-sim', 'management', 'city-builder', 'survival-craft', 'automation', 'idle'] },
  { id: 'story', genres: ['visual-novel', 'point-and-click', 'puzzle', 'horror'] },
  { id: 'other', genres: ['racing', 'rhythm', 'sports'] },
] as const;
export type GenrePreset = (typeof GENRE_GROUPS)[number]['genres'][number];

/**
 * The genres everyone sees first, as picture cards in this order; each has an
 * image at `/new-game/genres/<id>.webp` (apps/web/public). Every other genre,
 * and "something else", sits under "More types".
 */
export const FEATURED_GENRES: readonly GenrePreset[] = [
  'platformer', 'metroidvania', 'survivors', 'roguelike', 'deckbuilder', 'puzzle',
  'tower-defense', 'life-sim', 'idle', 'shooter', 'turn-based-rpg', 'visual-novel',
];

/** Whether a genre is one of the picture cards rather than a chip under "More types". */
export function isFeaturedGenre(genre: WizardDraft['genre']): boolean {
  return (FEATURED_GENRES as readonly string[]).includes(genre);
}

/** English genre words stored in the setup, so the agent reads the same value in every UI locale. */
export const GENRE_VALUES: Record<GenrePreset, string> = {
  platformer: 'platformer', metroidvania: 'metroidvania', shooter: 'shooter', survivors: 'survivors-like (bullet heaven)',
  'hack-slash': 'hack and slash', fighting: 'fighting',
  'action-rpg': 'action RPG', 'turn-based-rpg': 'turn-based RPG', roguelike: 'roguelike', deckbuilder: 'deckbuilder',
  'tower-defense': 'tower defense', tactics: 'turn-based tactics', rts: 'real-time strategy', 'auto-battler': 'auto battler',
  'life-sim': 'farming and life sim', management: 'management', 'city-builder': 'city builder',
  'survival-craft': 'survival and crafting', automation: 'automation', idle: 'idle / incremental clicker',
  'visual-novel': 'visual novel', 'point-and-click': 'point-and-click adventure', puzzle: 'puzzle', horror: 'horror',
  racing: 'racing', rhythm: 'rhythm', sports: 'sports',
};

export const PIXEL_SIZES = [8, 16, 32, 48, 64] as const;

export const RESOLUTION_PRESETS = [
  { id: '320x180', width: 320, height: 180 },
  { id: '384x216', width: 384, height: 216 },
  { id: '480x270', width: 480, height: 270 },
  { id: '640x360', width: 640, height: 360 },
  { id: '1280x720', width: 1280, height: 720 },
  { id: '1280x800', width: 1280, height: 800 },
  { id: '1920x1080', width: 1920, height: 1080 },
  { id: '2560x1440', width: 2560, height: 1440 },
  { id: '720x1280', width: 720, height: 1280 },
  { id: '1080x1920', width: 1080, height: 1920 },
] as const;

export interface WizardDraft {
  /** Chosen on the engine screen, suggested from the earlier answers when it opens. */
  templateId: string;
  title: string;
  studio: string;
  /** How big the game is meant to be; empty until chosen. */
  scope: GameScope | '';
  /** Long projects only: keep room for Steam later. */
  steamLater: boolean;
  /** Preset id, or 'custom' with `genreCustom`. Empty until chosen. */
  genre: GenrePreset | 'custom' | '';
  genreCustom: string;
  perspective: GamePerspective | '';
  pitch: string;
  /** Similar games as typed, split when the setup is stored. */
  comparables: string;
  players: GamePlayerMode[];
  languages: GameLanguage[];
  // Release answers from setups made before the dialog stopped asking them. They
  // are never shown, only carried through so editing an older project keeps them.
  stores: GameStore[];
  os: GameOsTarget[];
  steamAppId: string;
  steamFeatures: GameSteamFeature[];
  milestone: GameMilestone | '';
  playtime: GamePlaytime | '';
  price: GamePriceTier | '';
  /** Target platforms an older setup stored without stores. */
  platforms: GameTargetPlatform[];
  artSource: GameArtSource | '';
  /** Installed style id, 'custom' for a written direction only, or '' until chosen. */
  styleId: string;
  direction: string;
  /** Only colours the user added; picking a style does not fill it, so an empty palette leaves colour to the style and the chosen sample. */
  palette: string[];
  /** 0 means "not pixel art". */
  pixelSize: number;
  /**
   * The retired "generate a style sample first" toggle. Planning now always
   * shows style samples, so it is no longer asked; older setups keep the value.
   */
  sample: boolean;
  /** A preset id or 'custom'. */
  resolution: string;
  customWidth: string;
  customHeight: string;
  scaling: GameScalingMode;
  controls: GameControlScheme[];
  notes: string;
  /** The folder name when the user changed it; empty follows the title. */
  name: string;
  /** Start the first agent turn as soon as the project opens. */
  kickoff: boolean;
  /**
   * Which of languages, screen size and controls the user changed themselves. The
   * others were filled in for them and are stored as `suggested`, so the agent does
   * not treat them as the user's choice.
   */
  edited: GameSetupSuggestedField[];
}

/** In-memory reference images; the browser cannot persist File objects across reloads. */
export interface WizardReference { id: string; file: File; url: string }

export function emptyDraft(templateId = ''): WizardDraft {
  return {
    templateId, title: '', studio: '', scope: '', steamLater: false,
    genre: '', genreCustom: '', perspective: '', pitch: '', comparables: '',
    players: ['single'], languages: ['en'],
    stores: [], os: [], steamAppId: '', steamFeatures: [], milestone: '', playtime: '', price: '', platforms: [],
    artSource: '', styleId: '', direction: '', palette: [], pixelSize: 0, sample: false,
    resolution: '', customWidth: '', customHeight: '', scaling: 'fit', controls: [], notes: '',
    name: '', kickoff: true, edited: [],
  };
}

/** A starter that is already a specific game answers its own setup; the user still confirms it. */
export function templateDraftDefaults(templateId: string): Partial<WizardDraft> {
  // What the sample ships with (its own 16-bit art, an 800x450 FIT canvas, keyboard), so its setup is complete.
  if (templateId === SAMPLE_TEMPLATE_ID) {
    return { title: 'Pixel Platformer', scope: 'quick', genre: 'platformer', perspective: 'side-2d', platforms: ['web'], styleId: 'pixel-16-bit',
      resolution: 'custom', customWidth: '800', customHeight: '450', scaling: 'fit', controls: ['keyboard'], kickoff: false,
      // The sample's own screen and controls are facts about that game, not defaults.
      edited: ['display', 'controls'] };
  }
  return {};
}

/** The screens the wizard shows; an existing project has no folder or starter to choose. */
export type WizardMode = 'create' | 'edit';

export interface StepContext {
  mode: WizardMode;
  /** Create mode: the daemon preflight and location rules block Create. */
  locationReady?: boolean;
  /** Create mode: the chosen starter's engine is not on this computer (`starterEngineMissing`). */
  engineMissing?: boolean;
  /** Create mode: the answer to "have you made a game before?", saved or just chosen. */
  experience?: GameExperience | null;
  /** Create mode: the starters a first-timer may pick (`startersFor`), to refuse one restored from an older draft. */
  allowedTemplateIds?: readonly string[];
}

/** A first-timer making a new game: only 2D, and only the Phaser and Godot starters. */
export function isBeginner(context: Pick<StepContext, 'mode' | 'experience'>): boolean {
  return context.mode === 'create' && context.experience === 'first';
}

export function genreValue(draft: WizardDraft): string {
  if (draft.genre === 'custom') return draft.genreCustom.trim();
  return draft.genre ? GENRE_VALUES[draft.genre] : '';
}

/** Steam and itch.io both mean a desktop build (older setups only). */
export function hasDesktopStore(draft: Pick<WizardDraft, 'stores'>): boolean {
  return draft.stores.includes('steam') || draft.stores.includes('itch');
}

export function perspectiveDimension(perspective: WizardDraft['perspective']): '2d' | '3d' | 'both' | null {
  if (!perspective) return null;
  if (perspective === 'hd-2d') return 'both';
  return perspective.endsWith('-3d') ? '3d' : '2d';
}

/** The views on offer: a first-timer sees only plain 2D ones (2.5D puts sprites in a 3D scene). */
export function perspectivesFor(beginner: boolean): readonly GamePerspective[] {
  return beginner ? GAME_PERSPECTIVES.filter(id => perspectiveDimension(id) === '2d') : GAME_PERSPECTIVES;
}

export function templateDimension(template: GameTemplateSummary): '2d' | '3d' {
  return splitTemplateName(template.name).dimension === '3D' || template.engine === 'threejs' ? '3d' : '2d';
}

/** Engines a first-timer is offered, each with a one-line plain explanation. */
export const BEGINNER_ENGINES = ['phaser', 'godot'] as const;

/**
 * The starters that fit the chosen perspective. The sample is a finished game,
 * not a place to start, so it only appears when it is the current choice. A
 * first-timer sees only the 2D Phaser and Godot starters.
 */
export function startersFor(
  draft: Pick<WizardDraft, 'perspective' | 'templateId'>,
  templates: readonly GameTemplateSummary[],
  beginner = false,
): GameTemplateSummary[] {
  const dimension = perspectiveDimension(draft.perspective);
  return templates.filter(template => {
    if (template.id === SAMPLE_TEMPLATE_ID) return template.id === draft.templateId;
    if (beginner) return (BEGINNER_ENGINES as readonly string[]).includes(template.engine) && templateDimension(template) === '2d';
    return !dimension || dimension === 'both' || templateDimension(template) === dimension;
  });
}

/** Whether this game should start on an engine with native desktop exports. */
function wantsNativeBuild(draft: Pick<WizardDraft, 'stores' | 'steamLater' | 'scope'>): boolean {
  return hasDesktopStore(draft) || (draft.scope === 'long' && draft.steamLater);
}

/**
 * The starter to recommend. A web engine (Phaser) runs here at once and is
 * the easiest to share as a link, so it comes first, unless a long project
 * means to reach Steam (or an older setup sells on a desktop store), which
 * favours native exports. Either way a starter this machine can run comes
 * before one it cannot.
 */
export function recommendedStarter(
  draft: Pick<WizardDraft, 'stores' | 'steamLater' | 'scope' | 'perspective' | 'templateId'>,
  templates: readonly GameTemplateSummary[],
  engines: readonly GameEngineOption[] | undefined,
  beginner = false,
): string {
  const starters = startersFor(draft, templates, beginner).filter(template => template.id !== SAMPLE_TEMPLATE_ID);
  const runnable = (template: GameTemplateSummary) => engines?.find(engine => engine.engine === template.engine)?.available !== false;
  const native = starters.find(template => template.engine === 'godot' && runnable(template));
  const web = starters.find(template => template.engine !== 'godot' && runnable(template));
  return (wantsNativeBuild(draft) ? native ?? web : web ?? native)?.id ?? starters[0]?.id ?? '';
}

/**
 * The engine a new game cannot be created on yet: the chosen starter's engine
 * as this computer reported it, when it is not available. An unknown machine
 * (an older daemon, a failed check) blocks nothing, and neither does the
 * finished sample, which stays one click.
 */
export function starterEngineMissing(
  templateId: string,
  templates: readonly GameTemplateSummary[],
  engines: readonly GameEngineOption[] | undefined,
): GameEngineOption | null {
  if (!templateId || templateId === SAMPLE_TEMPLATE_ID) return null;
  const template = templates.find(item => item.id === templateId);
  const machine = template ? engines?.find(engine => engine.engine === template.engine) : undefined;
  return machine && machine.available === false ? machine : null;
}

/** Where each missing tool comes from. npm ships with Node.js. */
const TOOL_DOWNLOADS: Readonly<Record<string, string>> = {
  godot: 'https://godotengine.org/download/windows/',
  npm: 'https://nodejs.org/en/download',
};
/** Tools whose location can be set in Settings → Game engines (`GameEnginePaths`). */
const CONFIGURABLE_TOOLS = new Set(['godot', 'unity', 'cocosCreator']);

/** How the user gets a missing engine onto this computer: an official download and, where it exists, the path setting. */
export function engineInstallHelp(option: Pick<GameEngineOption, 'missingTools'>): { tool: string; downloadUrl: string | null; configurable: boolean } {
  const tool = option.missingTools[0] ?? '';
  return { tool, downloadUrl: TOOL_DOWNLOADS[tool] ?? null, configurable: CONFIGURABLE_TOOLS.has(tool) };
}

/** The starter to offer instead of one this computer cannot run: the recommended one when it runs here. */
export function runnableAlternative(
  draft: Pick<WizardDraft, 'stores' | 'steamLater' | 'scope' | 'perspective' | 'templateId'>,
  templates: readonly GameTemplateSummary[],
  engines: readonly GameEngineOption[] | undefined,
  beginner = false,
): GameTemplateSummary | null {
  const runs = (template: GameTemplateSummary) => engines?.find(engine => engine.engine === template.engine)?.available === true;
  const candidates = startersFor(draft, templates, beginner)
    .filter(template => template.id !== SAMPLE_TEMPLATE_ID && template.id !== draft.templateId && runs(template));
  const recommended = recommendedStarter(draft, templates, engines, beginner);
  return candidates.find(template => template.id === recommended) ?? candidates[0] ?? null;
}

export function draftResolution(draft: WizardDraft): { width: number; height: number } | null {
  const preset = RESOLUTION_PRESETS.find(item => item.id === draft.resolution);
  if (preset) return { width: preset.width, height: preset.height };
  if (draft.resolution !== 'custom') return null;
  const width = Number(draft.customWidth), height = Number(draft.customHeight);
  const ok = (n: number) => Number.isInteger(n) && n >= GAME_SETUP_LIMITS.minDimension && n <= GAME_SETUP_LIMITS.maxDimension;
  return ok(width) && ok(height) ? { width, height } : null;
}

export type StepProblem =
  | 'experience' | 'scope' | 'title' | 'genre' | 'perspective' | 'players' | 'languages'
  | 'style' | 'direction' | 'template' | 'engine' | 'resolution' | 'controls' | 'name';

/**
 * The required answers a screen is still missing, in field order. Continue
 * (and Create) is enabled only when this is empty. It asks more of a new game
 * than the daemon's `gameSetupStepComplete` asks of a stored setup, which
 * keeps older projects and scripted setups from being called unfinished.
 */
export function stepProblems(draft: WizardDraft, step: WizardStepId, context: StepContext): StepProblem[] {
  const problems: StepProblem[] = [];
  const create = context.mode === 'create';
  switch (step) {
    case 'experience':
      if (!context.experience) problems.push('experience');
      break;
    case 'size':
      // An older project that already names its platforms was complete without a size, and stays so.
      if (!draft.scope && (create || (!draft.stores.length && !draft.platforms.length))) problems.push('scope');
      break;
    case 'concept':
      if (create && !draft.title.trim()) problems.push('title');
      if (!genreValue(draft)) problems.push('genre');
      if (!draft.players.length) problems.push('players');
      if (!draft.languages.length) problems.push('languages');
      break;
    case 'view':
      // A first-timer's view must be one they were offered; an older draft may hold a 3D one.
      if (create && (!draft.perspective || (draft.perspective && !perspectivesFor(isBeginner(context)).includes(draft.perspective)))) problems.push('perspective');
      break;
    case 'art':
      if (!draft.styleId) problems.push('style');
      else if (draft.styleId === 'custom' && !draft.direction.trim()) problems.push('direction');
      break;
    case 'setup':
      if (create && (!draft.templateId || (context.allowedTemplateIds && !context.allowedTemplateIds.includes(draft.templateId)))) problems.push('template');
      // A starter the agent could not run or check on this computer would be built blind.
      else if (create && context.engineMissing) problems.push('engine');
      if (!draftResolution(draft)) problems.push('resolution');
      if (!draft.controls.length) problems.push('controls');
      break;
    case 'review':
      for (const earlier of WIZARD_STEP_IDS) {
        // The experience question is not about this game, and its own screen already gates it.
        if (earlier === 'review' || earlier === 'experience') continue;
        problems.push(...stepProblems(draft, earlier, context));
      }
      if (create && gameFolderNameProblem(gameFolderName(draft))) problems.push('name');
      break;
  }
  return problems;
}

export function stepComplete(draft: WizardDraft, step: WizardStepId, context: StepContext): boolean {
  return stepProblems(draft, step, context).length === 0 && (step !== 'review' || context.mode === 'edit' || context.locationReady === true);
}

/** The furthest screen a user may open: every screen before it must be complete. */
export function furthestReachableStep(draft: WizardDraft, context: StepContext, steps: readonly WizardStepId[] = wizardSteps(context.mode)): number {
  let index = 0;
  while (index < steps.length - 1 && stepComplete(draft, steps[index]!, context)) index++;
  return index;
}

/** A title as a folder name. A title that leaves nothing usable falls back rather than blocking. */
export function folderNameFromTitle(title: string): string {
  const name = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').replace(/\.{2,}/g, '.').trim().replace(/[. ]+$/, '');
  return name && !gameFolderNameProblem(name) ? name : 'my-game';
}

/** The folder the game is created in: the user's own name, or one made from the title. */
export function gameFolderName(draft: Pick<WizardDraft, 'name' | 'title'>): string {
  return draft.name.trim() || folderNameFromTitle(draft.title);
}

export function parseComparables(value: string): string[] {
  return value.split(/[,，、;；\n]/).map(item => item.trim().slice(0, GAME_SETUP_LIMITS.comparable)).filter(Boolean).slice(0, GAME_SETUP_LIMITS.comparables);
}

/** The stored setup. References are added once their files are in the project. */
export function draftToSetup(draft: WizardDraft, references: readonly string[] = []): GameProjectSetup {
  const display = draftResolution(draft);
  const styleId = draft.styleId && draft.styleId !== 'custom' ? draft.styleId : undefined;
  const art: NonNullable<GameProjectSetup['art']> = {
    ...(draft.artSource ? { source: draft.artSource } : {}),
    ...(styleId ? { styleId } : {}),
    ...(draft.direction.trim() ? { direction: draft.direction.trim() } : {}),
    ...(draft.palette.length ? { palette: draft.palette } : {}),
    ...(draft.pixelSize > 0 ? { pixelSize: draft.pixelSize } : {}),
    ...(references.length ? { references: [...references] } : {}),
    ...(draft.sample ? { sample: true } : {}),
  };
  const steam = draft.stores.includes('steam');
  // Answers that belong to a store the user turned off are not requirements any more.
  const os = hasDesktopStore(draft) ? draft.os.filter(target => steam || target !== 'steam-deck') : [];
  const release: NonNullable<GameProjectSetup['release']> = {
    ...(draft.stores.length ? { stores: draft.stores } : {}),
    ...(os.length ? { os } : {}),
    ...(steam && draft.steamAppId.trim() ? { steamAppId: draft.steamAppId.trim() } : {}),
    ...(steam && draft.steamFeatures.length ? { steamFeatures: draft.steamFeatures } : {}),
    ...(draft.milestone ? { milestone: draft.milestone } : {}),
    ...(draft.playtime ? { playtime: draft.playtime } : {}),
    ...(draft.price ? { price: draft.price } : {}),
    ...(draft.languages.length ? { languages: draft.languages } : {}),
    // Only a long project asks; switching to a smaller size takes the answer back.
    ...(draft.scope === 'long' && draft.steamLater ? { steamLater: true } : {}),
  };
  const platforms = draft.stores.length ? gamePlatformsForStores(draft.stores) : draft.platforms;
  const comparables = parseComparables(draft.comparables);
  return {
    ...(draft.title.trim() ? { title: draft.title.trim() } : {}),
    ...(draft.studio.trim() ? { studio: draft.studio.trim() } : {}),
    ...(genreValue(draft) ? { genre: genreValue(draft) } : {}),
    ...(draft.perspective ? { perspective: draft.perspective } : {}),
    ...(draft.pitch.trim() ? { pitch: draft.pitch.trim() } : {}),
    ...(comparables.length ? { comparables } : {}),
    ...(draft.players.length ? { players: draft.players } : {}),
    ...(draft.scope ? { scope: draft.scope } : {}),
    ...(Object.keys(release).length ? { release } : {}),
    ...(platforms.length ? { platforms } : {}),
    ...(Object.keys(art).length ? { art } : {}),
    ...(display ? { display: { ...display, scaling: draft.scaling } } : {}),
    ...(draft.controls.length ? { controls: draft.controls } : {}),
    ...(draft.notes.trim() ? { notes: draft.notes.trim() } : {}),
    ...suggestedFields(draft, { languages: draft.languages.length > 0, display: Boolean(display), controls: draft.controls.length > 0 }),
  };
}

/** The draft fields each suggestable answer is made of. */
const SUGGESTED_FIELD_KEYS: Record<GameSetupSuggestedField, readonly (keyof WizardDraft)[]> = {
  languages: ['languages'],
  display: ['resolution', 'customWidth', 'customHeight', 'scaling'],
  controls: ['controls'],
};

/** Record which suggestable answers a user's own edit touched. */
export function markEdited(draft: WizardDraft, patch: Partial<WizardDraft>): WizardDraft {
  const touched = GAME_SETUP_SUGGESTED_FIELDS.filter(field => !draft.edited.includes(field)
    && SUGGESTED_FIELD_KEYS[field].some(key => key in patch));
  return touched.length ? { ...draft, ...patch, edited: [...draft.edited, ...touched] } : { ...draft, ...patch };
}

function suggestedFields(draft: WizardDraft, present: Record<GameSetupSuggestedField, boolean>): Pick<GameProjectSetup, 'suggested'> {
  const suggested = GAME_SETUP_SUGGESTED_FIELDS.filter(field => present[field] && !draft.edited.includes(field));
  return suggested.length ? { suggested } : {};
}

/**
 * Open an existing project's setup in the wizard; unknown genre words become
 * custom text. Release answers an older setup has are carried through unseen.
 */
export function setupToDraft(setup: GameProjectSetup | null | undefined): WizardDraft {
  const draft = emptyDraft();
  if (!setup) return draft;
  const preset = (Object.keys(GENRE_VALUES) as GenrePreset[]).find(id => GENRE_VALUES[id] === setup.genre);
  const resolution = setup.display
    ? RESOLUTION_PRESETS.find(item => item.width === setup.display!.width && item.height === setup.display!.height)?.id ?? 'custom'
    : '';
  const release = setup.release;
  return {
    ...draft,
    title: setup.title ?? '',
    studio: setup.studio ?? '',
    scope: setup.scope ?? '',
    steamLater: release?.steamLater === true,
    genre: preset ?? (setup.genre ? 'custom' : ''),
    genreCustom: preset ? '' : setup.genre ?? '',
    perspective: setup.perspective ?? '',
    pitch: setup.pitch ?? '',
    comparables: setup.comparables?.join(', ') ?? '',
    stores: release?.stores ?? [],
    os: release?.os ?? [],
    steamAppId: release?.steamAppId ?? '',
    steamFeatures: release?.steamFeatures ?? [],
    players: setup.players ?? draft.players,
    milestone: release?.milestone ?? '',
    playtime: release?.playtime ?? '',
    price: release?.price ?? '',
    languages: release?.languages ?? draft.languages,
    platforms: release?.stores?.length ? [] : setup.platforms ?? [],
    artSource: setup.art?.source ?? '',
    styleId: setup.art?.styleId ?? (setup.art?.direction ? 'custom' : ''),
    direction: setup.art?.direction ?? '',
    palette: setup.art?.palette ?? [],
    pixelSize: setup.art?.pixelSize ?? 0,
    sample: setup.art?.sample === true,
    resolution,
    customWidth: resolution === 'custom' ? String(setup.display!.width) : '',
    customHeight: resolution === 'custom' ? String(setup.display!.height) : '',
    scaling: setup.display?.scaling ?? 'fit',
    controls: setup.controls ?? [],
    notes: setup.notes ?? '',
    // A setup without the list (older ones, the CLI) is all the user's own answers.
    edited: GAME_SETUP_SUGGESTED_FIELDS.filter(field => !setup.suggested?.includes(field)),
  };
}

function mobileOnly(draft: Pick<WizardDraft, 'stores' | 'platforms'>): boolean {
  if (draft.stores.length) return draft.stores.every(store => store === 'mobile');
  return draft.platforms.length > 0 && draft.platforms.every(platform => platform === 'mobile');
}

/** Sizes worth offering for this game: low integer-scaled sizes for pixel art, display sizes otherwise. */
export function resolutionChoices(draft: WizardDraft): string[] {
  const deck = draft.stores.includes('steam') && draft.os.includes('steam-deck');
  let choices: string[];
  if (mobileOnly(draft)) choices = ['720x1280', '1080x1920', '1280x720'];
  else if (draft.pixelSize > 0 && perspectiveDimension(draft.perspective) !== '3d') choices = ['320x180', '384x216', '480x270', '640x360'];
  else choices = ['1280x720', ...(deck ? ['1280x800'] : []), '1920x1080', '2560x1440'];
  // A size chosen earlier stays visible when later answers would hide it.
  if (draft.resolution && draft.resolution !== 'custom' && !choices.includes(draft.resolution)) choices = [...choices, draft.resolution];
  return choices;
}

/** A low-resolution size that fills 1080p by a whole number: the scale pixel art stays sharp at. */
export function integerScaleTo1080p(id: string): number | null {
  const preset = RESOLUTION_PRESETS.find(item => item.id === id);
  if (!preset || preset.width >= 1280 || preset.height > preset.width) return null;
  const scale = 1920 / preset.width;
  return Number.isInteger(scale) && Number.isInteger(1080 / preset.height) ? scale : null;
}

/**
 * Suggestions for the engine screen, derived from earlier answers. They are
 * only applied to fields the user has not answered yet. A new game plays on a
 * computer: keyboard, plus mouse where the view needs pointing, plus a gamepad
 * when a long project means to reach Steam. Older setups' stores still count.
 */
export function suggestedSetup(draft: WizardDraft): Pick<WizardDraft, 'resolution' | 'scaling' | 'controls'> {
  const pixel = draft.pixelSize > 0 && perspectiveDimension(draft.perspective) !== '3d';
  const controls: GameControlScheme[] = [];
  if (!mobileOnly(draft)) {
    controls.push('keyboard');
    if (['ui-2d', 'isometric-2d', 'first-person-3d', 'top-down-3d'].includes(draft.perspective)) controls.push('mouse');
  }
  const steam = draft.stores.includes('steam') || (draft.scope === 'long' && draft.steamLater);
  if (steam && draft.perspective !== 'ui-2d') controls.push('gamepad');
  if (draft.os.includes('steam-deck') && !controls.includes('gamepad')) controls.push('gamepad');
  if (draft.stores.includes('mobile') || mobileOnly(draft)) controls.push('touch');
  const pixelResolution = draft.pixelSize <= 8 ? '320x180' : draft.pixelSize <= 16 ? '480x270' : '640x360';
  return {
    resolution: mobileOnly(draft) ? '720x1280' : pixel ? pixelResolution : '1920x1080',
    scaling: pixel ? 'pixel-perfect' : 'fit',
    controls: controls.length ? controls : ['keyboard'],
  };
}

export function withSuggestedSetup(draft: WizardDraft, templateId?: string): WizardDraft {
  const suggestion = suggestedSetup(draft);
  return {
    ...draft,
    ...(templateId !== undefined ? { templateId } : {}),
    resolution: draft.resolution || suggestion.resolution,
    scaling: draft.resolution ? draft.scaling : suggestion.scaling,
    controls: draft.controls.length ? draft.controls : suggestion.controls,
  };
}

// ---------- draft persistence ----------

// v3: the release screen is gone, so a v2 draft's Steam defaults must not become answers.
const DRAFT_KEY = 'pixo:new-game-draft.v3';
const STEP_KEY = 'pixo:new-game-draft-step.v3';
const RETIRED_KEYS = ['pixo:new-game-draft', 'pixo:new-game-draft-step', 'pixo:new-game-draft.v2', 'pixo:new-game-draft-step.v2'];
const STUDIO_KEY = 'pixo:new-game-studio';
const SCOPE_KEY = 'pixo:new-game-last-scope';
let memoryReferences: WizardReference[] = [];

/** The draft survives closing the dialog and reloading; a broken or foreign value starts fresh. */
export interface StoredDraft { draft: WizardDraft; step: WizardStepId }

export function loadDraft(): StoredDraft | null {
  try {
    for (const key of RETIRED_KEYS) localStorage.removeItem(key);
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WizardDraft>;
    if (!parsed || typeof parsed !== 'object') return null;
    const draft = { ...emptyDraft(), ...parsed };
    const step = localStorage.getItem(STEP_KEY) ?? '';
    return { draft, step: (WIZARD_STEP_IDS as readonly string[]).includes(step) ? step as WizardStepId : 'size' };
  } catch {
    return null;
  }
}

export function saveDraft(draft: WizardDraft, step: WizardStepId): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    localStorage.setItem(STEP_KEY, step);
  } catch { /* The wizard works without browser storage; the draft is then lost on close. */ }
}

export function clearDraft(): void {
  try { localStorage.removeItem(DRAFT_KEY); localStorage.removeItem(STEP_KEY); } catch { /* nothing stored */ }
  for (const reference of memoryReferences) URL.revokeObjectURL(reference.url);
  memoryReferences = [];
}

/** A developer's name is the same on their next game. */
export function rememberedStudio(): string {
  try { return localStorage.getItem(STUDIO_KEY) ?? ''; } catch { return ''; }
}

export function rememberStudio(studio: string): void {
  try { if (studio.trim()) localStorage.setItem(STUDIO_KEY, studio.trim()); } catch { /* the next draft starts empty */ }
}

/** The size chosen for the last game, preselected for the next one. */
export function rememberedScope(): GameScope | '' {
  try {
    const value = localStorage.getItem(SCOPE_KEY);
    return value === 'quick' || value === 'crafted' || value === 'long' ? value : '';
  } catch { return ''; }
}

export function rememberScope(scope: WizardDraft['scope']): void {
  try { if (scope) localStorage.setItem(SCOPE_KEY, scope); } catch { /* the next game asks without a preselection */ }
}

export function draftReferences(): WizardReference[] { return memoryReferences; }
export function setDraftReferences(references: WizardReference[]): void { memoryReferences = references; }

/** A Windows- and engine-safe file name under `art/references/`. */
export function referencePath(file: File, index: number): string {
  const dot = file.name.lastIndexOf('.');
  const ext = (dot > 0 ? file.name.slice(dot + 1) : 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  const stem = (dot > 0 ? file.name.slice(0, dot) : file.name).toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'reference';
  return `art/references/${String(index + 1).padStart(2, '0')}-${stem}.${ext}`;
}

export const REFERENCE_MAX_BYTES = 8 * 1024 * 1024;

/** Home composer files that can become references; anything else needs the normal project path. */
export function referencesFromFiles(files: readonly File[]): WizardReference[] {
  return files.slice(0, GAME_SETUP_LIMITS.references).map((file, index) => ({
    id: `${Date.now()}-${index}`, file, url: URL.createObjectURL(file),
  }));
}

export function canBecomeReference(file: File): boolean {
  return file.type.startsWith('image/') && file.size <= REFERENCE_MAX_BYTES;
}

// ---------- first agent turn ----------

type Translate = (key: keyof Dict, vars?: Record<string, string>) => string;

/**
 * The first user message, shown in chat as the user's own words, so it stays
 * plain: the game's name and type, and that the rest is still open. The setup
 * itself (screen size, controls, style) reaches the agent as the prompt's Game
 * setup block, and the planning steps are the prompt's, not this message's.
 */
export function kickoffPrompt(t: Translate, draft: WizardDraft): string {
  const genre = draft.genre === 'custom' ? draft.genreCustom.trim() : draft.genre ? t(`game.wizard.genre.${draft.genre}` as keyof Dict) : '';
  return t(draft.scope === 'quick' ? 'game.wizard.kickoffPromptQuick' : 'game.wizard.kickoffPrompt', {
    title: draft.title.trim(),
    genre,
  }).replace(/\s{2,}/g, ' ').trim();
}
