/**
 * Animated characters whose gear can be changed, made by OpenPixo Cloud and paid with credits.
 * The daemon is the only one that talks to the cloud: UI and `pixo character` use `/api/characters/*`.
 * The cloud hands out finished packages (`pixo-hero`, read by `game-sdk/openpixo-character`), never anything they are made from.
 */
export const CHARACTER_KINDS = ['character', 'armor', 'gear', 'motion', 'fit'] as const;
/** `fit`: armour that the account has, drawn again for another character. */
export type CharacterKind = (typeof CHARACTER_KINDS)[number];
/** `pack` puts saved changes (tuning, outfits, other gear) into a new package, for free. */
export type CharacterJobKind = CharacterKind | 'pack';
export const CHARACTER_STATES = ['making', 'ready', 'failed'] as const;
export type CharacterState = (typeof CHARACTER_STATES)[number];
export const CHARACTER_JOB_STATES = ['waiting', 'drawing', 'checking', 'fitting', 'posing', 'packing', 'succeeded', 'failed'] as const;
export type CharacterJobState = (typeof CHARACTER_JOB_STATES)[number];
export const CHARACTER_PARTS = ['hero', 'armor', 'gear', 'motion', 'fit'] as const;
/** What an order can consist of. */
export type CharacterPart = (typeof CHARACTER_PARTS)[number];
export const CHARACTER_STYLES = ['ink', 'cute'] as const;
export type CharacterStyle = (typeof CHARACTER_STYLES)[number];
/** Sturdy, round, tall and small. */
export const CHARACTER_BODIES = ['angular', 'round', 'lanky', 'tiny'] as const;
export type CharacterBody = (typeof CHARACTER_BODIES)[number];
export const CHARACTER_SLOTS = ['head', 'body', 'arm', 'leg', 'weapon', 'cape'] as const;
export type CharacterSlot = (typeof CHARACTER_SLOTS)[number];
/** What the sliders of a motion may be; 1 is the motion as it was made. `stop` is the freeze on the blow. */
export const CHARACTER_TUNING = { speed: [0.9, 1.35], windup: [0.6, 1.8], power: [0.7, 1.3], jump: [0.45, 1.55], stop: [0.4, 2.2] } as const;
export type CharacterTuning = Partial<Record<keyof typeof CHARACTER_TUNING, number>>;
/** The weapon a character was drawn with. It belongs to that character alone. */
export const CHARACTER_OWN_WEAPON = 'weapon0';

export interface CharacterPricePart { part: CharacterPart; credits: number }
export interface CharacterService { paused: boolean; priceVersion: number; prices: Record<CharacterPart, number> }

/** What was understood from the user's sentence, and what it costs. Pays for one order until it expires. */
export interface CharacterBrief {
  briefId: string;
  kind: CharacterKind;
  characterId: string | null;
  name: string | null;
  /** Null for anything but a new character. */
  body: CharacterBody | null;
  style: CharacterStyle | null;
  /** In the language of the request; a field can be empty. */
  shown: { look: string; clothes: string; colours: string; gear: string; note: string };
  parts: CharacterPricePart[];
  credits: number;
  available: number;
  expiresAt: string;
}

export interface CharacterJob {
  id: string;
  characterId: string;
  kind: CharacterJobKind;
  state: CharacterJobState;
  creditsReserved: number;
  /** Null until it ended; can be less than reserved, because only what was delivered is charged. */
  creditsCharged: number | null;
  delivered: CharacterPart[] | null;
  errorCode: CharacterErrorCode | null;
  createdAt: string;
  updatedAt: string;
}

/** A piece that can be worn: its id in the package and what it is called. */
export interface CharacterItem { id: string; label: string }
export interface CharacterMotion { name: string; builtIn: boolean; shown: string; tuning: CharacterTuning }
export type CharacterWear = Partial<Record<CharacterSlot, string>>;
/** Goes into the package by its name. `start`: what the character wears when a game begins; at most one. */
export interface CharacterOutfit { name: string; wear: CharacterWear; start?: true }

export interface AnimatedCharacter {
  id: string;
  name: string;
  body: CharacterBody;
  style: CharacterStyle;
  state: CharacterState;
  /** Counts finished packages. */
  revision: number;
  /** What goes into its package. `weapon0` is the weapon it was drawn with; the rest belongs to the account, and an id means the same piece for all its characters. */
  items: { sets: CharacterItem[]; weapons: CharacterItem[]; capes: CharacterItem[] };
  /** The armour designs that were drawn for it. */
  fits: string[];
  outfits: CharacterOutfit[];
  motions: CharacterMotion[];
  /** Saved changes that the newest package does not hold yet. */
  changed: boolean;
  /** The newest job on it. */
  job: CharacterJob | null;
  createdAt: string;
  updatedAt: string;
}

/** One drawn sheet that the account owns: three armour sets, or eight weapons and four capes. */
export interface CharacterDesign {
  /** armor3 or gear0. */
  id: string;
  kind: 'armor' | 'gear';
  style: CharacterStyle;
  /** The character it was made for; it may be gone. */
  madeFor: string;
  sets: CharacterItem[];
  weapons: CharacterItem[];
  capes: CharacterItem[];
  /** Armour: the characters that can wear it. Weapons and capes fit everyone. */
  fits: string[];
  createdAt: string;
}
/** What the account owns, whichever character it was made for. */
export interface CharacterGear {
  designs: CharacterDesign[];
  motions: { name: string; shown: string; /** Who has it. */ characters: string[] }[];
}

export const CHARACTER_ERROR_CODES = [
  'ACCOUNT_SIGNED_OUT', 'CLOUD_UNAVAILABLE', 'INSUFFICIENT_CREDITS', 'CHARACTER_PAUSED', 'CHARACTER_REQUEST_INVALID', 'CHARACTER_REQUEST_CONFLICT',
  'CHARACTER_BRIEF_INVALID', 'CHARACTER_BRIEF_EXPIRED', 'CHARACTER_TEXT_REFUSED', 'CHARACTER_NOT_FOUND', 'CHARACTER_BUSY', 'CHARACTER_FULL', 'CHARACTER_UNCHANGED', 'CHARACTER_NOT_FITTED', 'CHARACTER_FITS', 'CHARACTER_RATE_LIMITED',
  // why a job failed
  'CHARACTER_DRAWING_FAILED', 'CHARACTER_CONTENT_BLOCKED', 'CHARACTER_MOTION_FAILED', 'CHARACTER_TIMED_OUT', 'CHARACTER_PACKING_FAILED',
  // the daemon's own
  'CHARACTER_NOT_CONFIGURED', 'CHARACTER_USER_ONLY', 'CHARACTER_DOWNLOAD_FAILED', 'CHARACTER_INSTALL_FAILED', 'CHARACTER_PLAYER_EDITED',
] as const;
export type CharacterErrorCode = (typeof CHARACTER_ERROR_CODES)[number];
export interface CharacterErrorResponse { error: { code: CharacterErrorCode; message: string } }

// --- What the daemon adds ----------------------------------------------------

/** GET /api/characters/service. `available` is false in a build that has no character service. */
export interface CharactersStatus { available: boolean; signedIn: boolean; service: CharacterService | null }

/** A game that has a character in it, and which of its packages. */
export interface CharacterGame { projectId: string; projectName: string; slug: string; revision: number }
export interface LocalCharacter extends AnimatedCharacter { games: CharacterGame[] }

/** GET /api/characters */
export interface CharactersResponse { characters: LocalCharacter[]; suggestions: CharacterSuggestion[] }

/** An agent has no credits of its own to spend here: it proposes, and the user orders. */
export interface CharacterSuggestion { id: string; projectId: string; projectName: string; text: string; style: CharacterStyle | null; armor: boolean; gear: boolean; createdAt: string }
/** POST /api/projects/:id/characters/suggest */
export interface CharacterSuggestRequest { text: string; style?: CharacterStyle; armor?: boolean; gear?: boolean }

/** POST /api/characters/briefs */
export interface CharacterBriefRequest {
  kind: CharacterKind;
  /** Everything but `fit` needs words. */
  text?: string;
  characterId?: string;
  /** `fit`: the armour design to draw again. */
  design?: string;
  style?: CharacterStyle;
  body?: CharacterBody;
  /** For a new character: also draw armour, weapons and capes. */
  armor?: boolean;
  gear?: boolean;
}
/** POST /api/characters/orders. The same `requestId` again answers the same job. */
export interface CharacterOrderRequest { briefId: string; requestId: string }
/** PATCH /api/characters/:id */
export interface CharacterUpdate { name?: string; outfits?: CharacterOutfit[]; gear?: string[] }

/** POST /api/projects/:id/heroes */
export interface CharacterInstallRequest { characterId: string; /** Folder name in the game; from the character's name by default. */ slug?: string }
export const CHARACTER_PLAYERS = ['godot', 'unity', 'web'] as const;
export type CharacterPlayer = (typeof CHARACTER_PLAYERS)[number];
export interface InstalledCharacter {
  characterId: string;
  slug: string;
  name: string;
  revision: number;
  /** Project-relative folder of the package. */
  folder: string;
  /** Project-relative player script, and which engine it is for. */
  player: string;
  engine: CharacterPlayer;
}
export interface InstalledCharactersResponse { characters: InstalledCharacter[] }
