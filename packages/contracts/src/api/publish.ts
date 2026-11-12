/** Public game links (`pixo publish`) and live rooms (`pixo rooms`). See specs/current/publish-and-rooms.md. */

export type PublishedGameState = 'live' | 'under_review' | 'removed';

export interface PublishedGame {
  shareId: string;
  /** The public link: the wrapper page with the game and its Report button. */
  url: string;
  title: string;
  version: number;
  state: PublishedGameState;
  publishedAt: string;
  updatedAt: string;
  playsThisMonth: number;
  /** Shown to the creator when the operator removed the game. */
  removedReason?: string;
  /** Published beyond the plan's game count for a one-time credit charge; it does not count against the plan. */
  extraPaid?: boolean;
}

/**
 * Codes the cloud answers publish and share calls with, on top of the `ACCOUNT_*`
 * family. They are kept apart from `OPENPIXO_ACCOUNT_ERROR_CODES` because they carry
 * extra fields (`refusedFiles`) and are not account problems.
 */
export const PUBLISH_ERROR_CODES = ['PUBLISH_PAUSED', 'PUBLISH_REFUSED', 'PUBLISH_QUOTA', 'SHARE_TERMS_REQUIRED', 'SHARE_NOT_FOUND', 'PUBLISH_PLAN_REQUIRED', 'PUBLISH_EXTRA_GAME_REQUIRED'] as const;
export type PublishErrorCode = (typeof PUBLISH_ERROR_CODES)[number];

export interface PublishErrorResponse {
  /** `credits` is the one-time price, with PUBLISH_EXTRA_GAME_REQUIRED. */
  error: { code: PublishErrorCode; message: string; refusedFiles?: string[]; credits?: number };
}

export type PublishPhase = 'building' | 'checking' | 'uploading' | 'activating' | 'done' | 'failed';

export interface PublishJob {
  id: string;
  phase: PublishPhase;
  filesDone: number;
  filesTotal: number;
  startedAt: string;
  /** `credits` is the one-time price, with PUBLISH_EXTRA_GAME_REQUIRED. */
  error?: { code: string; message: string; credits?: number };
  /** The named offending paths for a refused upload, at most 20. */
  refusedFiles?: string[];
}

export type PublishUnavailableReason = 'no_cloud' | 'signed_out' | 'paused' | 'engine_unsupported';

/** What this account's plan allows for public links. A link never goes offline because of the plan. */
export interface PublishPlan {
  /** No active subscription: new links and updates are refused, existing links keep working. */
  planRequired: boolean;
  sku: string | null;
  maxLiveGames: number;
  maxGameBytes: number;
  /** Live games counted against `maxLiveGames` (extra paid games are not). */
  liveGames: number;
  /** One-time price of publishing a game beyond `maxLiveGames`. Absent from a cloud without extra games. */
  extraGameCredits?: number;
  /** Live games published as extras. */
  extraGames?: number;
}

export interface PublishStatusResponse {
  available: boolean;
  unavailableReason?: PublishUnavailableReason;
  game: PublishedGame | null;
  /** The running or most recent publish in this daemon session. */
  job: PublishJob | null;
  /** The account has accepted the sharing rules, so the checkbox can be skipped. */
  termsAccepted: boolean;
  termsUrl: string;
  /** Absent while the cloud has not said, including from a cloud without plan limits. */
  publishPlan?: PublishPlan;
}

export interface PublishRequest {
  title?: string;
  acceptTerms?: boolean;
  /** Upload the existing build output without rebuilding. */
  skipBuild?: boolean;
  /**
   * The creator agreed to the one-time extra-game charge (`PublishPlan.extraGameCredits`).
   * Refused from an agent token: only the creator can spend credits on this.
   */
  payExtraGame?: boolean;
}

export interface PublishStartResponse {
  job: PublishJob;
}

export interface RoomsUsage {
  /** Calendar month, UTC, `YYYY-MM`. */
  month: string;
  /** Account-wide free allowance. */
  freeMinutesTotal: number;
  freeMinutesUsed: number;
  /** This game, this month. */
  playerMinutes: number;
  creditsCharged: number;
  monthlyCreditLimit: number;
  openRooms: number;
}

export interface RoomsStatusResponse {
  sdkInstalled: boolean;
  /** Where the SDK file lives in the project, relative to its root, when installed. */
  sdkPath?: string;
  /** Null until the game is published and the account can be read. */
  usage: RoomsUsage | null;
  paused: boolean;
  /** True when signed out or offline: the cloud could not be asked, so `paused` and the numbers are placeholders. */
  cloudUnknown?: boolean;
  maxPlayers: number;
  creditsPerPlayerHour: number;
}

export interface RoomsInstallResponse {
  sdkPath: string;
  /** False when the same SDK version was already present. */
  changed: boolean;
}

export interface RoomsLimitRequest {
  monthlyCreditLimit: number;
}

export interface RoomsTestRequest {
  /**
   * A loopback URL of a dev server the caller already started. Agents pass this:
   * the daemon never starts project commands for an agent token, because that
   * would run them outside the agent's sandbox.
   */
  gameUrl?: string;
}

export interface RoomsTestResponse {
  /** Two URLs of the running game wired to the local relay; open each in its own window. */
  urls: [string, string];
  relayUrl: string;
}

// Room wire protocol. The local relay and the hosted Room speak the same messages.

export const ROOM_PROTOCOL_VERSION = 1;
export const ROOM_MAX_MESSAGE_BYTES = 16_384;

export type RoomCloseReason =
  | 'host-left'
  | 'idle'
  | 'max-duration'
  | 'out-of-credits'
  | 'limit-reached'
  | 'removed'
  | 'closed-by-host';

export type RoomJoinRefusal = 'room-not-found' | 'room-full' | 'room-closed' | 'protocol-mismatch';

export type RoomClientMessage =
  /** `to` is `all` (everyone else), `host`, or a player id. */
  | { t: 'send'; to: string; d: unknown }
  /** Host only. */
  | { t: 'close' };

export type RoomServerMessage =
  | { t: 'welcome'; v: number; you: string; host: string; players: string[]; code: string; maxPlayers: number }
  | { t: 'join'; id: string }
  | { t: 'leave'; id: string }
  | { t: 'host'; id: string }
  | { t: 'msg'; from: string; d: unknown }
  | { t: 'closing'; reason: RoomCloseReason }
  | { t: 'refused'; reason: RoomJoinRefusal }
  /** A message was dropped: too large or too fast. */
  | { t: 'warn'; code: 'too-large' | 'too-fast' | 'not-host' | 'bad-message' };

export interface RoomCreateRequest {
  v: number;
  hostMigration?: boolean;
}

export type RoomCreateRefusal = 'paused' | 'game-unavailable' | 'out-of-credits' | 'limit-reached' | 'too-many-rooms' | 'protocol-mismatch' | 'unavailable';

export type RoomCreateResponse =
  | { ok: true; code: string; maxPlayers: number }
  | { ok: false; reason: RoomCreateRefusal };
