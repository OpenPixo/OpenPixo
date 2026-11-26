/**
 * Pixo Motion: one moving 2D character made from one portrait, delivered as a `.pxmo` file.
 * The first part is the app's copy of what the cloud's character service and the app say to each other
 * (`<characterUrl>/v1/motion/...`); a test holds its codes and states. The second part is what the daemon adds
 * for `/api/motion/*`, which the web page and `pixo motion` share. Pure types and values. Nothing here says how a
 * character is made: steps are neutral words, progress is a share, and no answer holds anything of the making.
 */

export const MOTION_PORTRAIT_STATES = ['painting', 'ready', 'failed'] as const;
/** The portrait is painted first and shown; the user takes it, or asks for another. Free while choosing, within a daily limit. */
export type MotionPortraitState = (typeof MOTION_PORTRAIT_STATES)[number];
export const MOTION_JOB_STATES = ['waiting', 'painting', 'checking', 'building', 'baking', 'succeeded', 'failed'] as const;
/** An order, after the user took a portrait and confirmed the price. */
export type MotionJobState = (typeof MOTION_JOB_STATES)[number];
export const MOTION_CHARACTER_STATES = ['making', 'ready', 'failed'] as const;
export type MotionCharacterState = (typeof MOTION_CHARACTER_STATES)[number];

/** Longest description, in characters. */
export const MOTION_TEXT_MAX = 600;
/** Longest name of a character. */
export const MOTION_NAME_MAX = 40;
/** Biggest picture a user can start from, before base64. */
export const MOTION_PICTURE_MAX_BYTES = 8 * 1024 * 1024;
export const MOTION_PICTURE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type MotionPictureType = (typeof MOTION_PICTURE_TYPES)[number];

/** What the app needs to know before anything is asked. */
export interface MotionService {
  paused: boolean;
  priceVersion: number;
  /** Credits for one finished character. Charged only when the file is delivered. */
  price: number;
  /** Portraits a day for each account, and how many are left today. */
  portraitsPerDay: number;
  portraitsLeft: number;
}

export interface MotionPortraitRequest {
  /** The user's description, in any language. */
  text: string;
  /** A picture of the character to start from, as base64. */
  picture?: { type: MotionPictureType; data: string };
  /** Asking again with the same id answers the same portrait. */
  requestId: string;
}

export interface MotionPortrait {
  id: string;
  state: MotionPortraitState;
  /** The words it was painted from. */
  text: string;
  fromPicture: boolean;
  /** An order was placed with it; it cannot be ordered again. */
  used: boolean;
  errorCode: MotionErrorCode | null;
  createdAt: string;
  /** After this it can no longer be ordered, and it is deleted. */
  expiresAt: string;
}

export interface MotionOrderRequest { portraitId: string; name: string; requestId: string }

export interface MotionJob {
  id: string;
  characterId: string;
  state: MotionJobState;
  /** 0 to 1, for a progress bar. */
  progress: number;
  creditsReserved: number;
  /** Null until it ended. A failed job is charged nothing. */
  creditsCharged: number | null;
  errorCode: MotionErrorCode | null;
  createdAt: string;
  updatedAt: string;
}

export interface MotionCharacter {
  id: string;
  name: string;
  state: MotionCharacterState;
  portraitId: string;
  /** The finished file, once there is one. */
  file: { bytes: number; sha256: string } | null;
  job: MotionJob | null;
  createdAt: string;
  updatedAt: string;
}

/** Files with a token for 15 minutes: `portrait.png` for a portrait; `character.pxmo` and `poster.png` for a character. */
export interface MotionDownload {
  id: string;
  baseUrl: string;
  token: string;
  expiresAt: string;
  files: { name: string; bytes: number; sha256: string }[];
}

export const MOTION_ERROR_CODES = [
  'ACCOUNT_SIGNED_OUT', 'CLOUD_UNAVAILABLE', 'INSUFFICIENT_CREDITS', 'MOTION_PAUSED', 'MOTION_REQUEST_INVALID', 'MOTION_REQUEST_CONFLICT',
  'MOTION_PICTURE_INVALID', 'MOTION_NOT_FOUND', 'MOTION_PORTRAIT_LIMIT', 'MOTION_PORTRAIT_NOT_READY', 'MOTION_PORTRAIT_USED', 'MOTION_PORTRAIT_EXPIRED',
  'MOTION_BUSY', 'MOTION_RATE_LIMITED',
  // why a portrait or a job failed
  'MOTION_CONTENT_BLOCKED', 'MOTION_PAINTING_FAILED', 'MOTION_BUILD_FAILED', 'MOTION_TIMED_OUT',
] as const;
export type MotionErrorCode = (typeof MOTION_ERROR_CODES)[number];

// --- What the daemon adds: /api/motion/* --------------------------------------

/** The daemon's own codes, beside the cloud's. */
export const MOTION_LOCAL_ERROR_CODES = ['MOTION_NOT_CONFIGURED', 'MOTION_USER_ONLY', 'MOTION_DOWNLOAD_FAILED', 'MOTION_INSTALL_FAILED'] as const;
export const MOTION_API_ERROR_CODES = [...MOTION_ERROR_CODES, ...MOTION_LOCAL_ERROR_CODES] as const;
export type MotionApiErrorCode = (typeof MOTION_API_ERROR_CODES)[number];
export interface MotionErrorResponse { error: { code: MotionApiErrorCode; message: string } }

/** GET /api/motion/service. `available` is false in a build that has no character service. */
export interface MotionStatus { available: boolean; signedIn: boolean; service: MotionService | null }

/**
 * POST /api/motion/portraits. JSON `{ text, picture?, requestId? }` with the picture as base64, or multipart with the
 * fields `text` and `requestId` and the file `picture` (the web page and the CLI send that, so a big picture fits).
 * Without a request id the daemon makes one.
 */
export interface MotionPortraitCreateRequest { text: string; picture?: { type: MotionPictureType; data: string }; requestId?: string }

/** POST /api/motion/jobs: spends credits. The same `requestId` again answers the same job. */
export type MotionOrderCreateRequest = MotionOrderRequest;
/** PATCH /api/motion/characters/:id */
export interface MotionCharacterUpdate { name: string }

/** An agent has no credits of its own to spend here: it proposes, and the user orders on the page. */
export interface MotionSuggestion { id: string; projectId: string; projectName: string; text: string; createdAt: string }
/** POST /api/motion/suggestions */
export interface MotionSuggestRequest { projectId: string; text: string }

/** GET /api/motion/characters */
export interface MotionCharactersResponse { characters: MotionCharacter[]; suggestions: MotionSuggestion[] }

/** POST /api/motion/characters/:id/install */
export interface MotionInstallRequest { projectId: string; /** File name in the game, without `.pxmo`; from the character's name by default. */ slug?: string }
export const MOTION_PLAYERS = ['web', 'phaser', 'godot'] as const;
export type MotionPlayer = (typeof MOTION_PLAYERS)[number];
export interface InstalledMotionCharacter {
  characterId: string;
  slug: string;
  name: string;
  /** Project-relative `.pxmo` file. */
  file: string;
  engine: MotionPlayer;
  /** Project-relative player files. */
  player: string[];
  /** `edited`: a player file was changed by hand, so it was left alone. */
  playerState: 'written' | 'same' | 'edited';
  /** A few lines of code that show the character in this game. */
  usage: string;
}
