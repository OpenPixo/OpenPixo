// OpenPixo game projects: engine profile, verify loop, templates.
// Spec: specs/current/openpixo-phase1-game-harness.md
import type { GameProjectSetup } from './game-setup.js';
import type { GameEngineOption } from './game-plan.js';

export const GAME_ENGINE_IDS = [
  'godot',
  'unity',
  'unreal',
  'phaser',
  'threejs',
  'cocos-creator',
  'bevy',
  'rpg-maker',
  'web-generic',
  'unknown',
] as const;
export type GameEngineId = (typeof GAME_ENGINE_IDS)[number];

export interface EngineCommand {
  /** argv[0] is a logical tool id ('godot', 'unity', 'npm', 'cargo'); resolved at execution time. */
  argv: string[];
  /** Project-relative working directory. */
  cwd: string;
  timeoutMs: number;
  /** Engine-documented success codes. Omitted means [0]; retain the actual exit code. */
  successExitCodes?: number[];
}

export type EngineConfidence = 'certain' | 'likely' | 'unknown';

export interface EngineToolStatus {
  id: string;
  resolved: boolean;
  source?: 'settings' | 'path';
}

export interface EngineProfile {
  detectorVersion: number;
  engine: GameEngineId;
  engineVersion?: string;
  confidence: EngineConfidence;
  /** Project-relative files that justified the result. */
  evidence: string[];
  languages: string[];
  /** Project-relative asset roots in priority order. */
  assetRoots: string[];
  importMetadata: 'unity-meta' | 'godot-import' | 'none';
  commands: {
    /** Fastest static/headless check. */
    check?: EngineCommand;
    build?: EngineCommand;
    /** Used for screenshots. */
    run?: EngineCommand;
  };
  /** Logical tool ids the commands need, with resolution state. */
  tools: EngineToolStatus[];
  /** Why a safe command could not be inferred. */
  unavailableReasons?: Partial<Record<'check' | 'build' | 'run', string>>;
  detectedAt: number;
}

/** GET /api/projects/:id/engine and POST /api/projects/:id/engine/refresh */
export interface EngineProfileResponse {
  profile: EngineProfile;
}

export const GAME_VERIFY_STEPS = ['check', 'build', 'run'] as const;
export type GameVerifyStepName = (typeof GAME_VERIFY_STEPS)[number];

/** POST /api/projects/:id/game/verify */
export interface GameVerifyRequest {
  steps?: GameVerifyStepName[];
  screenshot?: boolean;
  runId?: string;
}

export interface GameVerifyStep {
  name: GameVerifyStepName;
  status?: 'passed' | 'failed' | 'unavailable' | 'skipped';
  message?: string;
  reasonCode?: 'SCREENSHOT_HOST_UNAVAILABLE';
  argv: string[];
  exitCode: number | null;
  durationMs: number;
  /** Opaque id; fetch via GET /api/projects/:id/game/verify/:ref. */
  logRef: string;
  timedOut: boolean;
}

export interface GameVerifyScreenshot {
  ref: string;
  width: number;
  height: number;
  /** Absolute path inside the daemon artifact area; set for CLI/agent consumers. */
  path?: string;
}

export interface GameVerifyToolGuidance {
  tool: string;
  name: string;
  /** Human-readable installation/configuration guidance for CLI consumers. */
  hint: string;
  installUrl?: string;
  configuration: 'engine-settings' | 'path';
}

/** POST / GET / DELETE /api/projects/:id/game/run. Process ids stay daemon-private. */
export interface GameRunStatus {
  status: 'idle' | 'starting' | 'running' | 'exited' | 'failed';
  engine?: GameEngineId;
  url?: string;
  startedAt?: number;
  exitedAt?: number;
  exitCode?: number | null;
  reasonCode?: 'UNSUPPORTED_ENGINE' | 'DEPENDENCIES_MISSING' | 'MISSING_TOOL'
    | 'START_FAILED' | 'START_TIMEOUT' | 'PROCESS_EXITED' | 'NODE_MISSING' | 'PACKAGE_MANAGER_MISSING' | 'INSTALL_BUSY';
  message?: string;
  installCommand?: string;
  packageManager?: GamePackageManager;
  requestedPackageManager?: GamePackageManager;
  fallback?: boolean;
  missingToolGuidance?: GameVerifyToolGuidance[];
  /** Opaque log id; fetch via GET /api/projects/:id/game/run/logs/:ref. */
  logRef?: string;
  /** Bounded recent output, also available after the process exits. */
  logTail?: string;
}

export interface GameVerifyResult {
  status: 'passed' | 'failed' | 'unavailable';
  steps: GameVerifyStep[];
  screenshots: GameVerifyScreenshot[];
  missingTools: string[];
  /** Authoritative tool guidance, also retained in registered CLI results. */
  missingToolGuidance?: GameVerifyToolGuidance[];
  /** Originating execution record, retained when the CLI registers its result. */
  runId?: string;
  /** playtests share verification artifacts and the CLI confinement boundary. */
  playtest?: GamePlaytestReport;
}

/** CLI preparation only: fetching this context never executes project commands. */
export interface GameVerifyContext {
  profile: EngineProfile;
  projectDir: string;
  artifactDir: string;
  /** Resolved daemon data root for CLI-owned dependency-install logs and child environment. */
  runtimeDataDir?: string;
  /** Configured executable overrides; other tools resolve on the CLI's PATH. */
  toolPaths: Partial<Record<'godot' | 'unity' | 'cocosCreator', string>>;
  webCaptureAvailable: boolean;
  runId?: string;
}

/** POST /api/projects/:id/game/verify/register; never executes commands. */
export interface GameVerifyRegisterRequest {
  result: GameVerifyResult;
  runId?: string;
}

/** Desktop host operation; it only loads a loopback URL, never starts commands. */
export interface GameWebCaptureRequest {
  url: string;
  timeoutMs: number;
  waitMs: number;
  playtest?: GamePlaytestRequest;
}

export type GameWebCaptureResult =
  | { status: 'passed'; pngBase64: string; width: number; height: number; playtest?: GameWebPlaytestCapture }
  | { status: 'failed' | 'unavailable'; message: string; reasonCode?: 'SCREENSHOT_HOST_UNAVAILABLE' };

/** Shared by direct verification, CLI registration and the desktop handoff. */
export const GAME_SCREENSHOT_HOST_UNAVAILABLE = {
  status: 'unavailable',
  reasonCode: 'SCREENSHOT_HOST_UNAVAILABLE',
  message: 'Game screenshots require the OpenPixo desktop app. Open the desktop app and retry Run + screenshot.',
} as const;

export interface GameTemplateSummary {
  id: string;
  name: string;
  /** Optional Simplified Chinese catalog copy; name remains the English fallback. */
  nameZhCN?: string;
  engine: GameEngineId;
  description: string;
  descriptionZhCN?: string;
  /**
   * Daemon-relative URL of the template's catalog cover, an in-game screenshot
   * (`GET /api/game-templates/:id/cover`). Absent when the template ships no
   * `cover.webp` / `cover.png`; clients then fall back to their own artwork.
   */
  coverUrl?: string;
}

/** GET /api/game-templates */
export interface GameTemplatesResponse {
  templates: GameTemplateSummary[];
  /** What this machine can run, by engine. Absent when the check failed. */
  engines?: GameEngineOption[];
  /** User workspace default, resolved by the host OS; not a daemon data path. */
  defaultParentDir?: string;
}

/** POST /api/projects/game-from-template */
export interface CreateGameFromTemplateRequest {
  templateId: string;
  /** Absolute path of the user-chosen parent directory. */
  parentDir: string;
  name: string;
  /** Explicit consent to create a missing parent directory recursively. */
  createParent?: boolean;
  /** Wizard answers stored as `metadata.gameSetup`; `art.styleId` also sets the project art style and `title` names the project. */
  setup?: GameProjectSetup;
}

/**
 * Why a game folder name cannot be used, or null when it can. The one rule
 * shared by the daemon (which enforces it before writing) and the web dialog
 * (which explains it inline): a single Windows-safe path segment.
 */
export type GameFolderNameProblem =
  | 'empty'
  | 'whitespace'
  | 'dots'
  | 'characters'
  | 'trailing'
  | 'reserved';

export function gameFolderNameProblem(name: string): GameFolderNameProblem | null {
  if (typeof name !== 'string' || !name) return 'empty';
  if (name !== name.trim()) return 'whitespace';
  if (name === '.' || name.includes('..')) return 'dots';
  if (/[\\/\x00-\x1f<>:"|?*]/.test(name)) return 'characters';
  if (/[. ]$/.test(name)) return 'trailing';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) return 'reserved';
  return null;
}

/** POST /api/projects/game-from-template/check — never writes, never spends a picker token. */
export interface CheckGameTargetRequest {
  /** Absolute path of the parent directory, as it would be sent to create. */
  parentDir: string;
  name: string;
  /** Check a prospective parent without writing it. */
  createParent?: boolean;
}

export type GameTargetStatus =
  /** Nothing is in the way; create would write `target`. */
  | 'available'
  /** A file or folder named `name` already exists in the parent. */
  | 'exists'
  /** `name` breaks {@link gameFolderNameProblem}; `nameProblem` says how. */
  | 'invalid-name'
  /** The parent is not an absolute path to an existing directory. */
  | 'invalid-parent'
  /** The import policy refuses the target (data directory, credential folder, …). */
  | 'rejected'
  /** This daemon only accepts parents confirmed in the native folder picker,
   * and the request carried no valid, unexpired picker token for `parentDir`. */
  | 'picker-required';

export interface CheckGameTargetResponse {
  status: GameTargetStatus;
  /** Canonical folder the game would be created in, once the parent resolved. */
  target?: string;
  nameProblem?: GameFolderNameProblem;
  /** Daemon detail for `rejected`, `invalid-parent` and `picker-required`. */
  message?: string;
  reasonCode?: GameCreationReasonCode;
}

// project creation and dependency installation.
export type GameCreationReasonCode = 'INVALID_REQUEST' | 'INVALID_NAME' | 'PARENT_NOT_ABSOLUTE'
  | 'PARENT_NOT_FOUND' | 'PARENT_NOT_DIRECTORY' | 'PARENT_UNREADABLE' | 'TARGET_EXISTS'
  | 'TEMPLATE_NOT_FOUND' | 'TARGET_REJECTED' | 'PICKER_REQUIRED' | 'CREATE_FAILED';

export interface GameTemplateGitResult {
  status: 'initialized' | 'skipped' | 'failed';
  reasonCode?: 'GIT_MISSING' | 'GIT_INIT_FAILED';
  message?: string;
}

// bounded input scripts and measured playtest evidence.
export const GAME_PLAYTEST_LIMITS = {
  durationMs: 30_000, frames: 24, steps: 128, scriptBytes: 32_768,
  consoleMessages: 200, pageErrors: 100, messageLength: 2000, width: 1280, height: 720,
  /** Upper bound for one key hold or one drag gesture. */
  gestureMs: 5000,
  /** Seeds are unsigned 32-bit integers, so the number alone reproduces a preset's PRNG state. */
  seedMax: 0xffff_ffff,
} as const;
/** Viewport pixel coordinates inside the 1280x720 capture surface. */
export type GamePlaytestPoint = [number, number];
export type GamePlaytestStep = { wait: number } | { key: string; down: boolean }
  | { key: string; press: true; holdMs?: number } | { click: GamePlaytestPoint } | { capture: string }
  /** Pointer movement with no button change (hover, aim). */
  | { move: GamePlaytestPoint }
  /** Left-button press/release for hold gestures; the capture host releases a still-held button at the end. */
  | { mouseDown: GamePlaytestPoint } | { mouseUp: GamePlaytestPoint }
  /** Left-button drag: press at `from`, move smoothly for `durationMs`, release at `to`. */
  | { drag: { from: GamePlaytestPoint; to: GamePlaytestPoint; durationMs?: number } };
/** One-click scripts shared by the UI picker, the CLI `--preset` flag and the JSON editor. */
export const GAME_PLAYTEST_PRESET_IDS = ['observe', 'runJump', 'wasd', 'clickGrid', 'drag', 'random', 'monkey'] as const;
export type GamePlaytestPresetId = typeof GAME_PLAYTEST_PRESET_IDS[number];
/** Presets generated from a seed. The same preset and seed always produce the same script. */
export const GAME_PLAYTEST_SEEDED_PRESETS: readonly GamePlaytestPresetId[] = ['random', 'monkey'];
export function isGamePlaytestPresetId(value: unknown): value is GamePlaytestPresetId {
  return typeof value === 'string' && (GAME_PLAYTEST_PRESET_IDS as readonly string[]).includes(value);
}
export function isGamePlaytestSeed(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= GAME_PLAYTEST_LIMITS.seedMax;
}
/** POST /api/projects/:id/game/playtest. CLI --duration is seconds; the wire uses milliseconds.
 * `preset` and `seed` are provenance: the daemon checks that the script really is that preset's
 * output and records both in the report, so a run can be replayed exactly. */
export interface GamePlaytestRequest {
  script?: GamePlaytestStep[]; durationMs?: number; captureIntervalMs?: number;
  preset?: GamePlaytestPresetId; seed?: number;
}
export interface ParsedGamePlaytestRequest {
  script: GamePlaytestStep[]; durationMs: number; captureIntervalMs: number;
  preset?: GamePlaytestPresetId; seed?: number;
}
export interface GamePlaytestFps { min: number; avg: number; samples: number }
export interface GamePlaytestConsole { level: 'debug' | 'info' | 'log' | 'warning' | 'error'; text: string; atMs: number }
export interface GameWebPlaytestFrame { pngBase64: string; width: number; height: number; atMs: number; label?: string }
export interface GameWebPlaytestCapture {
  completed: boolean; durationMs: number; frames: GameWebPlaytestFrame[];
  console: GamePlaytestConsole[]; pageErrors: string[];
  /** Measured rAF timing. MovieMaker's fixed FPS is never a performance measurement. */
  fps: GamePlaytestFps | null;
}
export type GamePlaytestReason = 'UNSUPPORTED_ENGINE' | 'RUN_COMMAND_UNAVAILABLE' | 'SCRIPT_UNSUPPORTED'
  | 'SCREENSHOT_HOST_UNAVAILABLE' | 'CAPTURE_UNAVAILABLE' | 'GODOT_CAPTURE_UNAVAILABLE';
export interface GamePlaytestFrame extends GameVerifyScreenshot { atMs: number; label?: string }
export interface GamePlaytestReport extends Omit<GameWebPlaytestCapture, 'frames'> {
  frames: GamePlaytestFrame[]; inputSupported: boolean; reasonCode?: GamePlaytestReason;
  /** One image with every frame as a numbered, labelled tile: what an agent opens first. */
  overview?: GameVerifyScreenshot;
  /** Provenance copied from the request: replaying `preset` with `seed` reproduces the exact input script. */
  preset?: GamePlaytestPresetId; seed?: number;
}
export interface GamePlaytestResult extends GameVerifyResult { playtest: GamePlaytestReport }

export function gamePlaytestKeySupported(key: string): boolean {
  return /^(?:[a-zA-Z0-9]|Arrow(?:Left|Right|Up|Down)|Space|Enter|Escape|Tab|Backspace|Shift|Control|Alt)$/.test(key);
}

function gamePlaytestPoint(value: unknown): GamePlaytestPoint | null {
  if (!Array.isArray(value) || value.length !== 2 || !value.every(v => typeof v === 'number' && Number.isFinite(v))) return null;
  const [x, y] = value as [number, number];
  return x >= 0 && x < GAME_PLAYTEST_LIMITS.width && y >= 0 && y < GAME_PLAYTEST_LIMITS.height ? [x, y] : null;
}

/**
 * About six periodic frames across a playtest, never more than one a second. Every
 * frame an agent opens stays in its conversation, and a periodic frame every second
 * filled a 30-second playtest to the 24-frame cap with near-identical pictures.
 * Named `capture` steps are taken whatever the interval.
 */
export function gamePlaytestDefaultCaptureInterval(durationMs: unknown): number {
  return typeof durationMs === 'number' && Number.isFinite(durationMs) ? Math.max(1000, Math.ceil(durationMs / 6)) : 1000;
}

/** Pure validation shared by CLI, HTTP and the privileged capture host.
 * The pointer is one left button: mouseDown/mouseUp alternate, and click/drag need it released. */
export function parseGamePlaytestRequest(input: unknown): ParsedGamePlaytestRequest {
  const fail = (): never => { throw new Error('Invalid game playtest input script or limits'); };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail();
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => !['script', 'durationMs', 'captureIntervalMs', 'preset', 'seed'].includes(key))) return fail();
  const durationMs = value.durationMs ?? 5000;
  const captureIntervalMs = value.captureIntervalMs ?? gamePlaytestDefaultCaptureInterval(durationMs);
  if (!Number.isInteger(durationMs) || (durationMs as number) < 100 || (durationMs as number) > GAME_PLAYTEST_LIMITS.durationMs
    || !Number.isInteger(captureIntervalMs) || (captureIntervalMs as number) < 100 || (captureIntervalMs as number) > GAME_PLAYTEST_LIMITS.durationMs) return fail();
  const preset = value.preset, seed = value.seed;
  if (preset !== undefined && !isGamePlaytestPresetId(preset)) return fail();
  // A seed means something only for a seeded preset, and a seeded preset is not reproducible without one.
  const seeded = preset !== undefined && GAME_PLAYTEST_SEEDED_PRESETS.includes(preset);
  if (seeded ? !isGamePlaytestSeed(seed) : seed !== undefined) return fail();
  const raw = value.script ?? [];
  if (!Array.isArray(raw) || raw.length > GAME_PLAYTEST_LIMITS.steps || JSON.stringify(raw).length > GAME_PLAYTEST_LIMITS.scriptBytes) return fail();
  let elapsed = 0, captures = 0, pointerDown = false;
  const gesture = (ms: unknown, fallback: number): number => {
    const value = ms ?? fallback;
    if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > GAME_PLAYTEST_LIMITS.gestureMs) return fail();
    elapsed += value as number; return value as number;
  };
  const script: GamePlaytestStep[] = raw.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return fail();
    const keys = Object.keys(item);
    if ('wait' in item && keys.length === 1 && Number.isInteger(item.wait) && item.wait >= 0) { elapsed += item.wait; return { wait: item.wait }; }
    if ('capture' in item && keys.length === 1 && typeof item.capture === 'string' && /^[\w-]{1,64}$/.test(item.capture)) { captures++; return { capture: item.capture }; }
    if (keys.length === 1 && ['click', 'move', 'mouseDown', 'mouseUp'].includes(keys[0]!)) {
      const name = keys[0] as 'click' | 'move' | 'mouseDown' | 'mouseUp', point = gamePlaytestPoint(item[name]) ?? fail();
      if (name === 'move') return { move: point };
      if (name === 'mouseUp') { if (!pointerDown) return fail(); pointerDown = false; return { mouseUp: point }; }
      if (pointerDown) return fail();
      if (name === 'mouseDown') { pointerDown = true; return { mouseDown: point }; }
      return { click: point };
    }
    if ('drag' in item && keys.length === 1) {
      const drag: unknown = item.drag;
      if (pointerDown || !drag || typeof drag !== 'object' || Array.isArray(drag)
        || Object.keys(drag).some(key => !['from', 'to', 'durationMs'].includes(key))) return fail();
      const gestureInput = drag as Record<string, unknown>;
      const from = gamePlaytestPoint(gestureInput.from) ?? fail(), to = gamePlaytestPoint(gestureInput.to) ?? fail();
      return { drag: { from, to, durationMs: gesture(gestureInput.durationMs, 300) } };
    }
    if (typeof item.key !== 'string' || !gamePlaytestKeySupported(item.key)) return fail();
    if (keys.length === 2 && typeof item.down === 'boolean') return { key: item.key, down: item.down };
    if (item.press === true && keys.every(key => ['key', 'press', 'holdMs'].includes(key))) {
      return { key: item.key, press: true, holdMs: gesture(item.holdMs, 80) };
    }
    return fail();
  });
  if (elapsed > (durationMs as number) || captures >= GAME_PLAYTEST_LIMITS.frames) return fail();
  return { durationMs: durationMs as number, captureIntervalMs: captureIntervalMs as number, script,
    ...(preset !== undefined ? { preset } : {}), ...(seeded ? { seed: seed as number } : {}) };
}

export * from './game-playtest-presets.js';

/** Use total measured time rather than averaging reciprocal frame intervals. */
export function gamePlaytestFps(timestamps: number[]): GamePlaytestFps | null {
  const deltas = timestamps.slice(1).map((time, i) => time - timestamps[i]!).filter(ms => Number.isFinite(ms) && ms > 0);
  if (!deltas.length) return null;
  return { min: 1000 / Math.max(...deltas), avg: deltas.length * 1000 / deltas.reduce((sum, ms) => sum + ms, 0), samples: deltas.length };
}

export type CreateGameFromTemplateResponse = import('./projects.js').ImportFolderResponse & { git: GameTemplateGitResult };
export type GamePackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

/** GET/POST /api/projects/:id/game/install-deps. Commands are always daemon-owned. */
export interface GameInstallDepsResult {
  status: 'ready' | 'installing' | 'installed' | 'failed';
  packageManager?: GamePackageManager;
  requestedPackageManager?: GamePackageManager;
  fallback?: boolean;
  installCommand?: string;
  reasonCode?: 'NODE_MISSING' | 'PACKAGE_MANAGER_MISSING' | 'UNSUPPORTED_ENGINE'
    | 'INSTALL_FAILED' | 'INSTALL_TIMEOUT' | 'INSTALL_CANCELLED' | 'INSTALL_BUSY';
  message?: string;
  exitCode?: number | null;
  logRef?: string;
  logTail?: string;
}
