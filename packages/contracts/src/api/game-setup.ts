// OpenPixo game setup: the choices the new-project wizard collects before any
// code is written. Stored on `metadata.gameSetup`, edited through
// GET/PUT /api/projects/:id/game-setup and `pixo project game-setup`, and
// rendered into the shared game prompt as an explicit input.
import { z } from 'zod';

export const GAME_TARGET_PLATFORMS = ['desktop', 'web', 'mobile'] as const;
export type GameTargetPlatform = (typeof GAME_TARGET_PLATFORMS)[number];

export const GAME_CONTROL_SCHEMES = ['keyboard', 'mouse', 'gamepad', 'touch'] as const;
export type GameControlScheme = (typeof GAME_CONTROL_SCHEMES)[number];

export const GAME_SCALING_MODES = ['pixel-perfect', 'fit', 'stretch'] as const;
export type GameScalingMode = (typeof GAME_SCALING_MODES)[number];

/** How the player sees the game. Decides 2D or 3D, and so the styles and starters on offer. */
export const GAME_PERSPECTIVES = [
  'side-2d', 'top-down-2d', 'isometric-2d', 'ui-2d',
  'hd-2d', 'first-person-3d', 'third-person-3d', 'top-down-3d',
] as const;
export type GamePerspective = (typeof GAME_PERSPECTIVES)[number];

/** Where the game will be sold or played. `steam` and `itch` mean a desktop build. */
export const GAME_STORES = ['steam', 'itch', 'web', 'mobile'] as const;
export type GameStore = (typeof GAME_STORES)[number];

export const GAME_OS_TARGETS = ['windows', 'macos', 'linux', 'steam-deck'] as const;
export type GameOsTarget = (typeof GAME_OS_TARGETS)[number];

export const GAME_STEAM_FEATURES = ['achievements', 'cloud-saves', 'leaderboards', 'remote-play', 'workshop'] as const;
export type GameSteamFeature = (typeof GAME_STEAM_FEATURES)[number];

export const GAME_PLAYER_MODES = ['single', 'local-coop', 'online-coop', 'online-pvp'] as const;
export type GamePlayerMode = (typeof GAME_PLAYER_MODES)[number];

export const GAME_MILESTONES = ['prototype', 'demo', 'early-access', 'full-release'] as const;
export type GameMilestone = (typeof GAME_MILESTONES)[number];

export const GAME_PLAYTIMES = ['under-2h', '2-5h', '5-15h', '15-40h', '40h-plus'] as const;
export type GamePlaytime = (typeof GAME_PLAYTIMES)[number];

export const GAME_PRICE_TIERS = ['free', 'under-5', '5-10', '10-20', '20-plus'] as const;
export type GamePriceTier = (typeof GAME_PRICE_TIERS)[number];

/** Languages offered at setup, as BCP 47 tags. The UI and prompt give each its name. */
export const GAME_LANGUAGES = ['en', 'zh-Hans', 'zh-Hant', 'ja', 'ko', 'de', 'fr', 'es', 'pt-BR', 'ru'] as const;
export type GameLanguage = (typeof GAME_LANGUAGES)[number];

/**
 * How big this game is meant to be, asked for every new game: a quick game
 * playable and shareable as a link after a few hours, a crafted one made over
 * days, or a long project. It sets how planning runs (`renderGamePlanBlock`).
 */
export const GAME_SCOPES = ['quick', 'crafted', 'long'] as const;
export type GameScope = (typeof GAME_SCOPES)[number];

export const GAME_ART_SOURCES = ['ai', 'own', 'mixed'] as const;
export type GameArtSource = (typeof GAME_ART_SOURCES)[number];

/** The wizard steps whose answers a project keeps. Location and template are creation-only. */
export const GAME_SETUP_STEPS = ['basics', 'art', 'setup'] as const;
export type GameSetupStepId = (typeof GAME_SETUP_STEPS)[number];

export const GAME_SETUP_LIMITS = {
  title: 120, studio: 80, comparable: 60, comparables: 3,
  genre: 80, pitch: 400, direction: 600, notes: 2000,
  palette: 16, references: 6, referencePath: 260,
  pixelSize: 256, minDimension: 16, maxDimension: 7680,
} as const;

const text = (max: number) => z.string().trim().max(max);
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
/** Project-relative, forward-slash path with no `..` segment and no drive or root. */
const referencePath = z.string().max(GAME_SETUP_LIMITS.referencePath)
  .refine(value => /^[^\\/:][^\\:]*$/.test(value) && !value.split('/').includes('..') && !value.split('/').includes(''),
    'reference must be a project-relative path');
const dimension = z.number().int().min(GAME_SETUP_LIMITS.minDimension).max(GAME_SETUP_LIMITS.maxDimension);

export const GameArtDirectionSchema = z.object({
  /** Installed art style; also becomes the project default (`metadata.artStyleId`). */
  styleId: z.string().min(1).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  /** Free-text look in the user's words, alone or on top of the style. */
  direction: text(GAME_SETUP_LIMITS.direction).optional(),
  palette: z.array(hexColor).max(GAME_SETUP_LIMITS.palette).optional(),
  /** Tile or sprite grid unit in pixels, for pixel-art games. */
  pixelSize: z.number().int().min(1).max(GAME_SETUP_LIMITS.pixelSize).optional(),
  /** Reference images already written into the project. */
  references: z.array(referencePath).max(GAME_SETUP_LIMITS.references).optional(),
  /** Ask the first agent turn to generate one style sample with the project style. */
  sample: z.boolean().optional(),
  /** Who makes the art that ships: generated, the user's own, or both. */
  source: z.enum(GAME_ART_SOURCES).optional(),
}).strict();
export type GameArtDirection = z.infer<typeof GameArtDirectionSchema>;

export const GameDisplaySetupSchema = z.object({
  width: dimension,
  height: dimension,
  scaling: z.enum(GAME_SCALING_MODES).optional(),
}).strict();
export type GameDisplaySetup = z.infer<typeof GameDisplaySetupSchema>;

/**
 * Release answers. The new-game dialog no longer asks where a game is sold: it
 * stores only `languages` and, for a long project, `steamLater`. The other
 * fields come from setups made before that, the CLI or a setup file, and keep
 * working.
 */
export const GameReleaseSetupSchema = z.object({
  stores: z.array(z.enum(GAME_STORES)).max(GAME_STORES.length).optional(),
  os: z.array(z.enum(GAME_OS_TARGETS)).max(GAME_OS_TARGETS.length).optional(),
  /** The real Steam App ID once the user has one. */
  steamAppId: z.string().regex(/^\d{1,10}$/, 'Steam App ID must be digits').optional(),
  steamFeatures: z.array(z.enum(GAME_STEAM_FEATURES)).max(GAME_STEAM_FEATURES.length).optional(),
  milestone: z.enum(GAME_MILESTONES).optional(),
  playtime: z.enum(GAME_PLAYTIMES).optional(),
  price: z.enum(GAME_PRICE_TIERS).optional(),
  languages: z.array(z.enum(GAME_LANGUAGES)).max(GAME_LANGUAGES.length).optional(),
  /** A long project the user means to put on Steam one day: the build keeps room for it. */
  steamLater: z.boolean().optional(),
}).strict();
export type GameReleaseSetup = z.infer<typeof GameReleaseSetupSchema>;

/**
 * Answers the new-game dialog can fill in itself, from the UI language and the earlier
 * answers, without the user ever seeing or changing them (a first-timer is not shown
 * languages or screen size at all, and controls sit under "More settings").
 */
export const GAME_SETUP_SUGGESTED_FIELDS = ['languages', 'display', 'controls'] as const;
export type GameSetupSuggestedField = (typeof GAME_SETUP_SUGGESTED_FIELDS)[number];

export const GameProjectSetupSchema = z.object({
  /** The game's public title; the folder name is a separate, file-safe thing. */
  title: text(GAME_SETUP_LIMITS.title).optional(),
  studio: text(GAME_SETUP_LIMITS.studio).optional(),
  genre: text(GAME_SETUP_LIMITS.genre).optional(),
  pitch: text(GAME_SETUP_LIMITS.pitch).optional(),
  perspective: z.enum(GAME_PERSPECTIVES).optional(),
  /** Existing games this one should feel like, in the user's words. */
  comparables: z.array(text(GAME_SETUP_LIMITS.comparable)).max(GAME_SETUP_LIMITS.comparables).optional(),
  players: z.array(z.enum(GAME_PLAYER_MODES)).max(GAME_PLAYER_MODES.length).optional(),
  /** How big the game is meant to be; see {@link GAME_SCOPES}. */
  scope: z.enum(GAME_SCOPES).optional(),
  release: GameReleaseSetupSchema.optional(),
  platforms: z.array(z.enum(GAME_TARGET_PLATFORMS)).max(GAME_TARGET_PLATFORMS.length).optional(),
  art: GameArtDirectionSchema.optional(),
  display: GameDisplaySetupSchema.optional(),
  controls: z.array(z.enum(GAME_CONTROL_SCHEMES)).max(GAME_CONTROL_SCHEMES.length).optional(),
  notes: text(GAME_SETUP_LIMITS.notes).optional(),
  /**
   * Which of those answers OpenPixo filled in and the user never changed. Absent on
   * setups from before it existed and from the CLI: then every answer is the user's.
   */
  suggested: z.array(z.enum(GAME_SETUP_SUGGESTED_FIELDS)).max(GAME_SETUP_SUGGESTED_FIELDS.length).optional(),
}).strict();
export type GameProjectSetup = z.infer<typeof GameProjectSetupSchema>;

/** GET /api/projects/:id/game-setup and the PUT response. */
export interface GameProjectSetupResponse {
  setup: GameProjectSetup | null;
  /** Steps whose required answers are still missing, in wizard order. */
  missingSteps: GameSetupStepId[];
}

/** PUT /api/projects/:id/game-setup replaces the whole setup; null clears it. */
export const SetGameProjectSetupRequestSchema = z.object({ setup: GameProjectSetupSchema.nullable() }).strict();
export type SetGameProjectSetupRequest = z.infer<typeof SetGameProjectSetupRequestSchema>;

/** Validate and normalize: trimmed text, empty strings and lists dropped, duplicates removed. */
export function parseGameProjectSetup(input: unknown): { ok: true; setup: GameProjectSetup } | { ok: false; message: string } {
  const parsed = GameProjectSetupSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, message: `Invalid game setup${issue ? ` at ${issue.path.join('.') || 'root'}: ${issue.message}` : ''}` };
  }
  return { ok: true, setup: normalizeGameProjectSetup(parsed.data) };
}

function compact<T extends object>(value: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined || item === '' || (Array.isArray(item) && !item.length)) continue;
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const nested = compact(item as object);
      if (Object.keys(nested).length) out[key] = nested;
      continue;
    }
    out[key] = Array.isArray(item) ? [...new Set(item)] : item;
  }
  return out as T;
}

export function normalizeGameProjectSetup(setup: GameProjectSetup): GameProjectSetup {
  const normalized = compact(setup);
  if (normalized.art?.palette) normalized.art.palette = [...new Set(normalized.art.palette.map(color => color.toUpperCase()))];
  return normalized;
}

/**
 * Whether each step has its required answers. One rule shared by the wizard's
 * Next button, the in-project "finish setup" card and the CLI:
 * - basics: a genre, and a size or (setups from before the size question) a target platform;
 * - art: an installed style or a written direction;
 * - setup: a base resolution and at least one control scheme.
 */
export function gameSetupStepComplete(setup: GameProjectSetup | null | undefined, step: GameSetupStepId): boolean {
  if (!setup) return false;
  switch (step) {
    case 'basics': return Boolean(setup.genre?.trim()) && (Boolean(setup.scope) || Boolean(setup.platforms?.length));
    case 'art': return Boolean(setup.art?.styleId) || Boolean(setup.art?.direction?.trim());
    case 'setup': return Boolean(setup.display) && Boolean(setup.controls?.length);
  }
}

export function gameSetupMissingSteps(setup: GameProjectSetup | null | undefined): GameSetupStepId[] {
  return GAME_SETUP_STEPS.filter(step => !gameSetupStepComplete(setup, step));
}

/** The build each store needs. Stored as `platforms`, which the setup rule above reads. */
export function gamePlatformsForStores(stores: readonly GameStore[]): GameTargetPlatform[] {
  const platforms: GameTargetPlatform[] = [];
  if (stores.includes('steam') || stores.includes('itch')) platforms.push('desktop');
  if (stores.includes('web')) platforms.push('web');
  if (stores.includes('mobile')) platforms.push('mobile');
  return platforms;
}

/** "640x360" / "640×360" → { width, height }, or null when outside the setup limits. */
export function parseGameResolution(value: string): { width: number; height: number } | null {
  const match = /^\s*(\d{1,5})\s*[x×*]\s*(\d{1,5})\s*$/i.exec(value);
  if (!match) return null;
  const width = Number(match[1]), height = Number(match[2]);
  const ok = (n: number) => n >= GAME_SETUP_LIMITS.minDimension && n <= GAME_SETUP_LIMITS.maxDimension;
  return ok(width) && ok(height) ? { width, height } : null;
}
