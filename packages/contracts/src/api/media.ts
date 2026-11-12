import type { MediaImageSheetRequest, MediaSheetPiece, MediaSheetResult } from './media-sheet.js';
/** A provider voice choice used by the speech asset picker. */
export interface AudioVoiceOption {
  name: string;
  voiceId: string;
  category?: string | null;
  labels?: Record<string, string> | null;
}

export const MEDIA_EXECUTION_MODES = [
  'enabled',
  'disabled',
] as const;

export type MediaExecutionMode = (typeof MEDIA_EXECUTION_MODES)[number];

export const MEDIA_SURFACES = [
  'image',
  'video',
  'audio',
  'model3d',
] as const;

export type MediaSurface = (typeof MEDIA_SURFACES)[number];

/** Retired catalogue ids only map to an already registered sibling on the same provider. */
export const MEDIA_MODEL_SUCCESSORS: Readonly<Record<string, string>> = Object.freeze({
  'gpt-image-1': 'gpt-image-2',
  'gpt-image-1.5': 'gpt-image-2',
  'gpt-image-1-mini': 'gpt-image-2',
  'openai/gpt-image-1.5': 'openai/gpt-image-2',
  'dall-e-2': 'dall-e-3',
  'senseaudio-image-1.0-260319': 'senseaudio-image-2.0-260319',
  'flux-pro': 'flux-1.1-pro',
  'imagen-3': 'imagen-4',
  'doubao-seedance-1-0-pro-250528': 'doubao-seedance-2-0-260128',
  'doubao-seedance-1-0-lite-i2v-250428': 'doubao-seedance-2-0-260128',
  'doubao-seedance-1-0-lite-t2v-250428': 'doubao-seedance-2-0-260128',
  'kling-1.5': 'kling-2.0',
  'kling-1.6': 'kling-2.0',
  'veo-2': 'veo-3',
  'suno-v4-5': 'suno-v5',
});

/** Accept saved catalogue selections without changing unknown deployment or custom model ids. */
export function canonicalMediaModelId(id: string): string {
  return Object.hasOwn(MEDIA_MODEL_SUCCESSORS, id) ? MEDIA_MODEL_SUCCESSORS[id]! : id;
}

/** POST /api/projects/:projectId/media/generate, shared by Studio and pixo media. */
export interface MediaGenerationRequest {
  surface: string;
  model: string;
  provider?: string;
  /** Codex image count, from 1 to 4; other providers generate one task output. */
  count?: number;
  prompt?: string;
  negativePrompt?: string;
  /** Omission inherits the project default; null explicitly disables styling. */
  styleId?: string | null;
  /**
   * `transparent` returns a PNG with a real alpha channel on every image
   * provider: native alpha when the provider delivers it, otherwise the daemon
   * keys out a flat background. A style's default background only steers the
   * prompt; only an explicit request triggers the cutout.
   */
  background?: 'transparent' | 'scene';
  /**
   * Final image size in pixels (images only). One side alone keeps `aspect`.
   * The daemon resolves both through `resolveImageOutputSize`: the long edge is
   * capped at `IMAGE_OUTPUT_MAX_EDGE`, the provider renders at its native size,
   * and the result is resized to exactly this size.
   */
  width?: number;
  height?: number;
  /**
   * Make several pieces, or an animation's frames, as one render and cut it: the
   * file at `output` is the sheet and each piece is written next to it. `width` and
   * `height` are each piece's final size. See `api/media-sheet.ts`.
   */
  sheet?: MediaImageSheetRequest;
  resolution?: string;
  quality?: string;
  aspect?: string;
  output?: string;
  length?: number;
  duration?: number;
  voice?: string;
  audioKind?: string;
  language?: string;
  loop?: boolean;
  promptInfluence?: number;
  compositionDir?: string;
  image?: string;
  images?: string[];
}

// Codex CLI image generation and credential-free readiness.
export const CODEX_IMAGE_REASON_CODES = [
  'CODEX_CLI_NOT_FOUND', 'CODEX_CLI_AUTH_REQUIRED', 'CODEX_CLI_AUTH_UNKNOWN',
  'CODEX_IMAGE_RATE_LIMITED', 'CODEX_IMAGE_QUOTA_EXCEEDED', 'CODEX_IMAGE_NO_OUTPUT',
  'CODEX_IMAGE_TIMEOUT', 'CODEX_IMAGE_CANCELLED', 'CODEX_IMAGE_FAILED',
] as const;
export type CodexImageReasonCode = (typeof CODEX_IMAGE_REASON_CODES)[number];

/** Runtime availability, separate from the presence of a saved API credential. */
export interface MediaProviderAvailability {
  available: boolean;
  keyless: boolean;
  reasonCode?: CodexImageReasonCode;
  /** Diagnostic English copy. UI consumers localize reasonCode. */
  reason?: string;
}

/** Configured provider coverage, without credentials or endpoint details. */
export interface GetMediaCapabilitiesResponse {
  capabilities: Record<string, { configured: boolean; providers: string[] }>;
}

/**
 * Why the image model the user picked for the agent cannot run now:
 * `not-connected` its provider is not set up (or Codex is not signed in);
 * `needs-art-budget` a hosted model, which needs a sign-in and a project art budget
 * with credits left; `unknown-model` this version has no such text-to-image model.
 */
export const AGENT_IMAGE_MODEL_UNAVAILABLE_REASONS = ['not-connected', 'needs-art-budget', 'unknown-model'] as const;
export type AgentImageModelUnavailableReason = (typeof AGENT_IMAGE_MODEL_UNAVAILABLE_REASONS)[number];

/** The value that stands for "automatic" when writing `agentImageModel` from a shell. */
export const AGENT_IMAGE_MODEL_AUTOMATIC = 'auto';

export interface AgentImageModelOption {
  id: string;
  label: string;
  provider: string;
  /** Neutral provider name; never a hosted vendor. */
  providerLabel: string;
  /** Paid with credits from a project's art budget. */
  hosted: boolean;
  /** False only for the saved pick when it cannot run now. */
  available: boolean;
}

/** `GET /api/media/agent-image-models`: what the Settings select, the composer chip and `pixo media image-models` list. */
export interface AgentImageModelsResponse {
  /** The saved `agentImageModel`, or null for automatic. */
  selected: string | null;
  /** What automatic picks on this machine now; null when nothing can make images. */
  automatic: string | null;
  /** Set when `selected` cannot run now; runs then use automatic and the agent says so. */
  selectedUnavailable?: AgentImageModelUnavailableReason;
  /** Text-to-image models that can run here, plus the saved pick when it cannot. */
  options: AgentImageModelOption[];
}

/** Available supported Cloud video models for the authenticated project workspace. */
export interface CloudVideoModelsResponse {
  source: 'account_workspace_catalogue';
  video: Array<{ id: string; label: string; hint: string; provider: string; caps: string[]; default?: boolean }>;
}

export const MEDIA_TASK_STATUSES = [
  'queued',
  'running',
  'done',
  'failed',
  'interrupted',
] as const;

export type MediaTaskStatus = (typeof MEDIA_TASK_STATUSES)[number];

export interface ProjectMediaTaskFile {
  name: string;
  /** All outputs of a multi-image task, including the primary file. */
  files?: ProjectMediaTaskFile[];
  size?: number;
  /** Stable across an in-project rename/move and used to reconcile the final path. */
  mtime?: number;
  kind?: string;
  mime?: string;
  /** Pixel size of an image output, read from the written file. */
  width?: number;
  height?: number;
  /** True when an image output was requested transparent and carries alpha. */
  transparent?: boolean;
  /** Pixel size the provider rendered, before the daemon resized it. */
  renderedWidth?: number;
  renderedHeight?: number;
  /** Credits a hosted request was charged. */
  creditsCharged?: number;
  /** The pieces a sheet was cut into, written next to it (`MediaGenerationRequest.sheet`). */
  pieces?: MediaSheetPiece[];
  sheet?: MediaSheetResult;
  /**
   * One plain sentence of tool facts for the caller: the size rendered, what it was
   * resized or cut to, what it cost. Never names a vendor or carries a link.
   */
  note?: string;
}

/** Long-edge cap for a requested image size (about 1.5K). */
export const IMAGE_OUTPUT_MAX_EDGE = 1536;
/** Smallest edge a requested image size may have. */
export const IMAGE_OUTPUT_MIN_EDGE = 16;
/** Aspect ratios every image provider path understands. */
export const IMAGE_OUTPUT_ASPECTS = ['1:1', '16:9', '9:16', '4:3', '3:4'] as const;
export type ImageOutputAspect = (typeof IMAGE_OUTPUT_ASPECTS)[number];

export interface ImageOutputSizeInput {
  width?: unknown;
  height?: unknown;
  aspect?: unknown;
}

/** A validated final image size and the provider aspect that frames it best. */
export interface ImageOutputSize {
  width: number;
  height: number;
  aspect: ImageOutputAspect;
  /** Clamps and aspect replacements, in English, for the caller's trace. */
  warnings: string[];
}

export class ImageOutputSizeError extends Error {
  readonly code = 'BAD_REQUEST';
  constructor(message: string) {
    super(message);
    this.name = 'ImageOutputSizeError';
  }
}

function aspectRatio(aspect: string): number {
  const [w, h] = aspect.split(':').map(Number);
  return w! / h!;
}

function nearestImageAspect(width: number, height: number): ImageOutputAspect {
  const target = Math.log(width / height);
  let best: ImageOutputAspect = '1:1';
  for (const aspect of IMAGE_OUTPUT_ASPECTS) {
    if (Math.abs(Math.log(aspectRatio(aspect)) - target) < Math.abs(Math.log(aspectRatio(best)) - target)) best = aspect;
  }
  return best;
}

function sizeSide(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new ImageOutputSizeError(`${name} must be a positive integer number of pixels`);
  }
  return value;
}

/**
 * The single size rule shared by the daemon, the CLI and UI previews.
 *
 * Returns null when no size was requested, so the provider's own default size
 * stands. Otherwise the long edge never exceeds `IMAGE_OUTPUT_MAX_EDGE` and no
 * edge is below `IMAGE_OUTPUT_MIN_EDGE`; oversized requests shrink
 * proportionally instead of failing, and each adjustment is reported.
 */
export function resolveImageOutputSize(input: ImageOutputSizeInput): ImageOutputSize | null {
  let width = sizeSide(input.width, 'width');
  let height = sizeSide(input.height, 'height');
  if (width === undefined && height === undefined) return null;
  const requestedAspect = typeof input.aspect === 'string' && input.aspect.trim() ? input.aspect.trim() : undefined;
  if (requestedAspect && !(IMAGE_OUTPUT_ASPECTS as readonly string[]).includes(requestedAspect)) {
    throw new ImageOutputSizeError(`aspect must be one of ${IMAGE_OUTPUT_ASPECTS.join(', ')}`);
  }
  const warnings: string[] = [];
  const ratio = aspectRatio(requestedAspect ?? '1:1');
  if (width === undefined) width = Math.max(1, Math.round(height! * ratio));
  if (height === undefined) height = Math.max(1, Math.round(width / ratio));
  const requested = `${width}x${height}`;
  const longEdge = Math.max(width, height);
  if (longEdge > IMAGE_OUTPUT_MAX_EDGE) {
    const scale = IMAGE_OUTPUT_MAX_EDGE / longEdge;
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
  }
  width = Math.min(IMAGE_OUTPUT_MAX_EDGE, Math.max(IMAGE_OUTPUT_MIN_EDGE, width));
  height = Math.min(IMAGE_OUTPUT_MAX_EDGE, Math.max(IMAGE_OUTPUT_MIN_EDGE, height));
  if (`${width}x${height}` !== requested) {
    warnings.push(`size ${requested} clamped to ${width}x${height} (long edge ${IMAGE_OUTPUT_MIN_EDGE}-${IMAGE_OUTPUT_MAX_EDGE}px)`);
  }
  const aspect = nearestImageAspect(width, height);
  if (requestedAspect && requestedAspect !== aspect) {
    warnings.push(`aspect ${requestedAspect} replaced by ${aspect} to frame ${width}x${height}`);
  }
  return { width, height, aspect, warnings };
}

/**
 * What to do next about a media generation that failed.
 *
 * This is the ONLY failure vocabulary a client — the agent that dispatched
 * the render, the chat host, a CLI caller — is meant to branch on. The
 * internal `code` stays for triage; it is not an answer to "so what now?",
 * and the moment it reached a user's screen it stopped being one at all
 * (「原因未分类(错误代码:MEDIA_DISPATCH_FAILED)」 is a support ticket, not a
 * next step).
 *
 * The values are the run-error ladder (`docs/design/run-errors/error-ux-design.md`
 * §3, mirrored in `apps/web/src/runtime/failure-guidance.ts`) applied to media, so
 * media failures do not grow a second, differently-shaped taxonomy:
 *
 * - rung 1 · the user can fix it right here — `revise-request`,
 *   `switch-model`, `open-settings`, `sign-in`
 * - rung 2 · nothing to fix, it may just work next time — `retry-later`
 * - rung 3 · this path cannot work; take a different one — `add-credit`,
 *   `confirm-in-app`, `raise-art-budget`, `approve-art`, `update-app`, `unsupported`
 * - rung 4 · retrying is futile and we have no other lever — `contact-support`
 *
 * Two failures that put the user in the same place get the SAME value on
 * purpose: a missing OpenAI key and a model with no configured renderer are
 * different bugs and one sentence ("fill it in under Settings").
 */
export const MEDIA_FAILURE_NEXT_STEPS = [
  /** The request itself was refused. Reword it / swap the reference image. */
  'revise-request',
  /** This model cannot serve the request; another one can. */
  'switch-model',
  /** A credential or endpoint is missing or wrong in Settings. */
  'open-settings',
  /** The OpenPixo session behind an OpenPixo-owned model expired. */
  'sign-in',
  /** Credit is spent. Retrying cannot bring it back. */
  'add-credit',
  /** Nothing failed: spending credits is the user's call, and an agent cannot make it. */
  'confirm-in-app',
  /** Nothing failed: the art budget the user set is used up, and only they can raise it. */
  'raise-art-budget',
  /** Nothing failed: the project asks before spending, and the user has not approved this art yet. */
  'approve-art',
  /** Transient: upstream wobble, throttling, timeout, local restart. */
  'retry-later',
  /** The installed app/runtime is too old to place the request at all. */
  'update-app',
  /** This run/project does not do this kind of generation, by policy. */
  'unsupported',
  /** We could not name a cause. Ours to fix, not the user's. */
  'contact-support',
] as const;

export type MediaFailureNextStep = (typeof MEDIA_FAILURE_NEXT_STEPS)[number];

export interface ProjectMediaTaskError {
  message: string;
  status?: number;
  code?: string;
  subject?: 'prompt' | 'input_image' | 'output_image';
  retryable?: boolean;
  /**
   * The classified next step. Always present on a failure the daemon
   * recorded: an absent value would push every consumer back to guessing from
   * `message`, which is the habit this field exists to end.
   */
  nextStep?: MediaFailureNextStep;
}

/**
 * A media generation the HOST itself watched fail, attributed to the run that
 * asked for it.
 *
 * The daemon has always known this: `routes/media.ts` writes a `[media]`
 * `event: "failed"` diagnostic carrying the very `run_id` that dispatched the
 * task. It just never handed the fact back to the run, so the run's terminal
 * frame was decided by the agent's exit code alone — the agent exits 0 after
 * apologising in prose, and the turn published `status: "succeeded"`,
 * `endedWithUnfinishedWork: false`, a green check, and an empty artifact rail.
 *
 * This is host-observed evidence, never a reading of the model's own words.
 * The apology sentence the media contract asks the model to copy verbatim
 * (`prompts/media-contract.ts`, design S22) is COPY: it can be rewritten in any
 * release, and no completeness verdict may depend on what it says.
 */
export interface RunMediaTaskFailure {
  /** The media task's id, so a consumer can fetch its full record. */
  taskId: string;
  /** `image` | `video` | `audio`, as requested. Absent if the request never named one. */
  surface?: string;
  /** The requested media model id. */
  model?: string;
  /** When the host recorded the failure. */
  failedAt: number;
  /** The task's own classified error, verbatim — same shape the media task
   *  endpoints publish, so an error card needs no second vocabulary. */
  error: ProjectMediaTaskError;
}

/** Everything a media failure can be classified from. All fields optional. */
export interface MediaFailureSignal {
  /**
   * The producer's stable code, when it published one. Never invent it: an
   * unrecognised code must NOT be promoted to a content refusal, or a user
   * gets sent off to rewrite a prompt that was never the problem.
   */
  code?: string | null | undefined;
  /** A real upstream HTTP status. Omit rather than defaulting it. */
  status?: number | null | undefined;
  /** The producer's diagnostic sentence. Read, never shown to a user. */
  message?: string | null | undefined;
  /** Only an explicit boolean counts; undefined means "the producer did not say". */
  retryable?: boolean | null | undefined;
  /** Selected model id for diagnostics. */
  model?: string | null | undefined;
}

const MEDIA_FAILURE_NEXT_STEP_BY_CODE: Readonly<Record<string, MediaFailureNextStep>> = {
  // sign-in uses the local CLI; no media API key is involved.
  CODEX_CLI_NOT_FOUND: 'open-settings',
  CODEX_CLI_AUTH_REQUIRED: 'sign-in',
  CODEX_CLI_AUTH_UNKNOWN: 'open-settings',
  CODEX_IMAGE_RATE_LIMITED: 'retry-later',
  CODEX_IMAGE_QUOTA_EXCEEDED: 'retry-later',
  CODEX_IMAGE_NO_OUTPUT: 'switch-model',
  CODEX_IMAGE_TIMEOUT: 'retry-later',
  CODEX_IMAGE_CANCELLED: 'retry-later',
  CODEX_IMAGE_FAILED: 'retry-later',
  // Content policy. The one code that licenses "reword it".
  safety_rejection: 'revise-request',
  // Resend with the game's style reference, or with --no-reference. Nothing was spent.
  STYLE_REFERENCE_CHOICE_REQUIRED: 'revise-request',
  // Daemon/dispatcher policy for this run.
  MEDIA_EXECUTION_DISABLED: 'unsupported',
  MEDIA_SURFACE_DENIED: 'unsupported',
  // The run allows media but not THIS model — another allowed one exists.
  MEDIA_MODEL_DENIED: 'switch-model',
  MEDIA_MODEL_UNAVAILABLE: 'switch-model',
  // No renderer is wired for the selected model: a Settings problem, whether
  // the fix is a key or a different provider entry.
  STUB_PROVIDER_DISABLED: 'open-settings',
  // Local plumbing. Nothing upstream is wrong and nothing is spent.
  MEDIA_DISPATCHER_UNREACHABLE: 'retry-later',
  DAEMON_RESTART: 'retry-later',
  RATE_LIMITED: 'retry-later',
  UPSTREAM_UNAVAILABLE: 'retry-later',
  // The installed runtime cannot place the call at all.
  MEDIA_CLI_INCOMPATIBLE: 'update-app',
  AGENT_AUTH_REQUIRED: 'sign-in',
  // Hosted models spend credits; only the user can confirm a quote.
  GENERATION_CONFIRMATION_REQUIRED: 'confirm-in-app',
  ART_BUDGET_EXHAUSTED: 'raise-art-budget',
  ART_APPROVAL_REQUIRED: 'approve-art',
  // What an agent's hosted request can meet in the cloud. Retrying these is safe:
  // the daemon re-sends an open request only under the id already charged.
  ACCOUNT_SIGNED_OUT: 'sign-in',
  INSUFFICIENT_CREDITS: 'add-credit',
  CLOUD_UNAVAILABLE: 'retry-later',
  GENERATION_PAUSED: 'retry-later',
  GENERATION_RATE_LIMITED: 'retry-later',
  GENERATION_QUOTE_INVALID: 'retry-later',
  GENERATION_QUOTE_EXPIRED: 'retry-later',
  GENERATION_PARAMS_INVALID: 'switch-model',
  GENERATION_SERVICE_UNKNOWN: 'switch-model',
  OPENPIXO_CONTENT_BLOCKED: 'revise-request',
  OPENPIXO_VENDOR_INPUT_REJECTED: 'revise-request',
};

/**
 * Provider adapters throw a uniform `"<tag> <status>: <body>"` sentence
 * (`openai image 429: …`, `senseaudio tts 401: unauthorized`), and a few
 * throw the bare `"<verb> <status>"` form (`openai image fetch 404`). Those
 * two shapes are the only places an upstream status survives into a plain
 * `Error`, so they are the only ones read here. Both are anchored to the
 * short tag that opens the sentence, so a three-digit number inside the
 * truncated response body that follows cannot be mistaken for a status.
 */
const TAGGED_STATUS_RE = /^[A-Za-z][\w .\/-]{0,32}?\s([1-5]\d\d):\s/;
const BARE_STATUS_RE =
  /^[A-Za-z][\w .\/-]{0,32}?\b(?:fetch|download|submit|poll|content)\s+([1-5]\d\d)\b/i;

/** `no media gateway API key — configure it in …`, `no OpenAI credential — …`. */
const MISSING_CREDENTIAL_RE = /\bno\s+(?:[\w.-]+\s+){0,3}(?:api key|credential)\b/i;
/** Every long-poll adapter gives up with this exact phrase. */
const RENDER_TIMED_OUT_RE = /\bdid not finish in time\b/i;

function nextStepForStatus(
  status: number,
): MediaFailureNextStep | undefined {
  if (status === 401 || status === 403) return 'open-settings';
  if (status === 402) return 'add-credit';
  if (status === 404) return 'switch-model';
  if (status === 408 || status === 425 || status === 429) return 'retry-later';
  if (status >= 500 && status <= 599) return 'retry-later';
  return undefined;
}

function statusFromMessage(message: string): number | undefined {
  const tagged = TAGGED_STATUS_RE.exec(message);
  if (tagged?.[1]) return Number(tagged[1]);
  const bare = BARE_STATUS_RE.exec(message);
  if (bare?.[1]) return Number(bare[1]);
  return undefined;
}

/**
 * Classify a media failure into the one thing its reader should do next.
 *
 * Precedence is deliberate and narrows outward from proof to guess: a code the
 * producer published, then a real HTTP status, then the two message shapes
 * that provably carry a status, then a two-entry message allowlist, then the
 * producer's own retry verdict. Anything left is `contact-support` — "we could
 * not name it" is an honest answer and its copy still offers a retry, whereas
 * guessing `revise-request` would blame the user for our outage.
 */
export function mediaFailureNextStep(signal: MediaFailureSignal): MediaFailureNextStep {
  const code = typeof signal.code === 'string' ? signal.code.trim() : '';
  const byCode = code ? MEDIA_FAILURE_NEXT_STEP_BY_CODE[code] : undefined;
  if (byCode) return byCode;

  if (typeof signal.status === 'number' && Number.isFinite(signal.status)) {
    const byStatus = nextStepForStatus(signal.status);
    if (byStatus) return byStatus;
  }

  const message = typeof signal.message === 'string' ? signal.message : '';
  if (message) {
    const embedded = statusFromMessage(message);
    if (embedded !== undefined) {
      const byEmbedded = nextStepForStatus(embedded);
      if (byEmbedded) return byEmbedded;
    }
    if (MISSING_CREDENTIAL_RE.test(message)) return 'open-settings';
    if (RENDER_TIMED_OUT_RE.test(message)) return 'retry-later';
  }

  if (signal.retryable === true) return 'retry-later';
  return 'contact-support';
}

/** A project media task snapshot consumed by ChatPanel's per-output progress row. */
export interface ProjectMediaTask {
  taskId: string;
  /**
   * Creation order within the daemon's media task store. Compare it, never
   * persist or display it. `startedAt` ties on every parallel fan-out, so this
   * is the only field that keeps a batch's cells in their real positions
   * across polls. Absent from a producer that does not report it — fall back
   * to `startedAt` then.
   */
  sequence?: number;
  /**
   * Identity of the generation batch this task belongs to: same-run,
   * same-surface tasks whose lifetimes overlap, which is what a user perceives
   * as one "generate the illustrations" action. Absent means the producer did
   * not group; treat the task as a batch of one rather than guessing a total.
   */
  batchId?: string;
  /** 1-based position within `batchId`. The N in "N/M". */
  batchIndex?: number;
  /**
   * Tasks known in `batchId`. The M in "N/M". It grows while the batch is open
   * and freezes once its last member ends, so a progress row's denominator
   * never walks backwards. A one-at-a-time generation reports 1 here: the
   * product ruling is a single spinner, not a fabricated total.
   */
  batchSize?: number;
  runId?: string;
  status: MediaTaskStatus;
  startedAt: number;
  endedAt: number | null;
  elapsed: number;
  surface?: string;
  model?: string;
  progress: string[];
  progressCount: number;
  file?: ProjectMediaTaskFile;
  error?: ProjectMediaTaskError;
}

export interface ProjectMediaTasksResponse {
  tasks: ProjectMediaTask[];
}

export const MEDIA_POLICY_DENIAL_CODES = [
  'MEDIA_EXECUTION_DISABLED',
  'MEDIA_SURFACE_DENIED',
  'MEDIA_MODEL_DENIED',
] as const;

export type MediaPolicyDenialCode = (typeof MEDIA_POLICY_DENIAL_CODES)[number];

/**
 * Run-scoped policy controlling OpenPixo-owned media generation only.
 *
 * `allowedSurfaces` and `allowedModels` apply solely to `/api/tools/media/generate`
 * and in-run `pixo media generate`. External MCP media tools are intentionally
 * unaffected: provider policy for those belongs to the MCP server / orchestrator.
 */
export interface MediaExecutionPolicy {
  mode: MediaExecutionMode;
  allowedSurfaces?: MediaSurface[];
  allowedModels?: string[];
}

export const DEFAULT_MEDIA_EXECUTION_POLICY: MediaExecutionPolicy = {
  mode: 'enabled',
};

export interface MediaPolicyTarget {
  surface: MediaSurface;
  model?: string;
}

export interface MediaPolicyDenial {
  code: MediaPolicyDenialCode;
  message: string;
}

export function mediaExecutionPolicyDenial(
  policy: MediaExecutionPolicy,
  target: MediaPolicyTarget,
): MediaPolicyDenial | null {
  if (policy.mode === 'disabled') {
    return {
      code: 'MEDIA_EXECUTION_DISABLED',
      message: 'media generation is disabled for this run',
    };
  }
  if (
    Array.isArray(policy.allowedSurfaces) &&
    policy.allowedSurfaces.length > 0 &&
    !policy.allowedSurfaces.includes(target.surface)
  ) {
    return {
      code: 'MEDIA_SURFACE_DENIED',
      message: `media surface "${target.surface}" is not allowed for this run`,
    };
  }
  if (
    target.model &&
    Array.isArray(policy.allowedModels) &&
    policy.allowedModels.length > 0 &&
    !policy.allowedModels.includes(target.model)
  ) {
    return {
      code: 'MEDIA_MODEL_DENIED',
      message: `media model "${target.model}" is not allowed for this run`,
    };
  }
  return null;
}

/** Request for OpenPixo's deterministic local HyperFrames scaffold. */
export interface HyperFramesScaffoldRequest {
  /** Project-relative path in the form `.hyperframes-cache/<id>` or visible `motion-source/<id>`. */
  compositionDir: string;
}

/** Files created before the agent authors the composition HTML. */
export interface HyperFramesScaffoldResponse {
  compositionDir: string;
  files: ['hyperframes.json', 'meta.json', 'index.html', ...string[]];
}
