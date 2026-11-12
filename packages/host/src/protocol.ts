import type { ReleaseChannel } from "@openpixo/release";

/**
 * @module protocol
 *
 * The OpenPixo renderer host-bridge wire contract: the injected-global name
 * and version, client/updater constant registries, and every request/result
 * type that crosses the host bridge — including the {@link OpenPixoHostBridge}
 * shape itself. Pure declarations only; depends on nothing else in the package.
 */

export const OPENPIXO_HOST_GLOBAL = "__pixo__";
export const OPENPIXO_HOST_VERSION = 2;

export const OPENPIXO_HOST_CLIENT_TYPES = Object.freeze({
  DESKTOP: "desktop",
} as const);

export type OpenPixoHostClientType =
  (typeof OPENPIXO_HOST_CLIENT_TYPES)[keyof typeof OPENPIXO_HOST_CLIENT_TYPES];

export type OpenPixoHostClient = {
  // BCP-47 locale string (e.g. "zh-CN", "pt-BR") the host process read from
  // the OS at startup. The renderer uses this so the packaged desktop app
  // can follow the OS language even when Chromium's built-in
  // `navigator.language` would have defaulted to en-US.
  osLocale?: string;
  platform?: string;
  type: OpenPixoHostClientType;
};

export type OpenPixoHostFailure = {
  details?: unknown;
  ok: false;
  reason: string;
};

export type OpenPixoHostActionResult =
  | { ok: true }
  | OpenPixoHostFailure;

export type OpenPixoHostProjectImportInit = {
  name?: string;
  skillId?: string | null;
};

export type OpenPixoHostProjectImportSuccess = {
  conversationId: string;
  entryFile: string | null;
  ok: true;
  projectId: string;
};

export type OpenPixoHostProjectImportResult =
  | OpenPixoHostProjectImportSuccess
  | {
      canceled: true;
      ok: false;
    }
  | OpenPixoHostFailure;

export type OpenPixoHostProjectReplaceWorkingDirSuccess = {
  baseDir: string;
  entryFile: string | null;
  ok: true;
};

export type OpenPixoHostProjectReplaceWorkingDirResult =
  | OpenPixoHostProjectReplaceWorkingDirSuccess
  | {
      canceled: true;
      ok: false;
    }
  | OpenPixoHostFailure;

export type OpenPixoHostPickWorkingDirSuccess = {
  baseDir: string;
  ok: true;
  // Single-use HMAC token (minted by the host main process for `baseDir`)
  // that the renderer threads into POST /api/projects/:id/working-dir once
  // the project exists. Lets the Home flow pick a folder before the project
  // is created without exposing the daemon's desktop-auth gate.
  token: string;
};

export type OpenPixoHostPickWorkingDirResult =
  | OpenPixoHostPickWorkingDirSuccess
  | {
      canceled: true;
      ok: false;
    }
  | OpenPixoHostFailure;

export type OpenPixoHostPdfPrintOptions = {
  deck?: boolean;
};

export type OpenPixoHostCaptureClip = { x: number; y: number; width: number; height: number };
export type OpenPixoHostCaptureOptions = { clip?: OpenPixoHostCaptureClip };
export type OpenPixoHostCaptureSuccess = { dataUrl: string; h: number; ok: true; w: number };
export type OpenPixoHostCaptureResult = OpenPixoHostCaptureSuccess | OpenPixoHostFailure;

export type OpenPixoHostPreviewNavigationFailure = {
  errorCode: number;
  eventId: number;
  frameName?: string;
  occurredAtMs: number;
  validatedUrl: string;
};

export type OpenPixoHostPreviewNavigationFailureListener = (
  failure: OpenPixoHostPreviewNavigationFailure,
) => void;

export type OpenPixoHostBrowserClearDataOptions = {
  cookies?: boolean;
  storage?: boolean;
};

/**
 * App theme values the renderer may pin the host window appearance to.
 * `light`/`dark` force the native window material (macOS under-window
 * vibrancy glass follows the OS appearance by default, which reads as a
 * muddy gray when the OS is dark but the app theme is explicitly light);
 * `system` restores following the OS.
 */
export const OPENPIXO_HOST_APPEARANCE_THEMES = Object.freeze({
  DARK: "dark",
  LIGHT: "light",
  SYSTEM: "system",
} as const);

export type OpenPixoHostAppearanceTheme =
  (typeof OPENPIXO_HOST_APPEARANCE_THEMES)[keyof typeof OPENPIXO_HOST_APPEARANCE_THEMES];

export const OPENPIXO_HOST_UPDATER_ACTIONS = Object.freeze({
  CHECK: "check",
  CLEAR_CACHE: "clear-cache",
  DOWNLOAD: "download",
  INSTALL: "install",
  QUIT: "quit",
  STATUS: "status",
} as const);

export type OpenPixoHostUpdaterAction =
  (typeof OPENPIXO_HOST_UPDATER_ACTIONS)[keyof typeof OPENPIXO_HOST_UPDATER_ACTIONS];

/** @internal Updater actions that return a status snapshot (every action except `quit`). */
export type OpenPixoHostUpdaterStatusAction = Exclude<
  OpenPixoHostUpdaterAction,
  typeof OPENPIXO_HOST_UPDATER_ACTIONS.QUIT
>;

export const OPENPIXO_HOST_UPDATER_STATES = Object.freeze({
  AVAILABLE: "available",
  CHECKING: "checking",
  DOWNLOADED: "downloaded",
  DOWNLOADING: "downloading",
  ERROR: "error",
  IDLE: "idle",
  INSTALLING: "installing",
  NOT_AVAILABLE: "not-available",
  UNSUPPORTED: "unsupported",
} as const);

export type OpenPixoHostUpdaterState =
  (typeof OPENPIXO_HOST_UPDATER_STATES)[keyof typeof OPENPIXO_HOST_UPDATER_STATES];

export type OpenPixoHostUpdaterMode = "js-incremental" | "package-launcher";
export type OpenPixoHostUpdaterChannel = ReleaseChannel;

export type OpenPixoHostUpdaterActionOptions = {
  payload?: Record<string, unknown>;
};

export type OpenPixoHostUpdaterCapabilitySet = {
  canApplyInPlace: boolean;
  canDownload: boolean;
  canOpenInstaller: boolean;
  requiresManualInstall: boolean;
};

export type OpenPixoHostUpdaterPathSnapshot = {
  downloadRoot?: string;
  manifestPath?: string;
};

export type OpenPixoHostUpdaterChecksumSnapshot = {
  algorithm: "sha256" | "sha512";
  url?: string;
  value?: string;
};

export type OpenPixoHostUpdaterArtifactSnapshot = {
  name?: string;
  platformKey?: string;
  size?: number;
  type?: string;
  url: string;
};

export type OpenPixoHostUpdaterProgressSnapshot = {
  receivedBytes: number;
  totalBytes?: number;
};

export type OpenPixoHostUpdaterErrorSnapshot = {
  code: string;
  details?: unknown;
  message: string;
};

export type OpenPixoHostUpdaterInstallResult = {
  activeVersion?: string;
  artifactPath?: string;
  dryRun?: boolean;
  helperLogPath?: string;
  launcherRuntimePath?: string;
  launchPath?: string;
  openedAt: string;
  path: string;
};

export type OpenPixoHostUpdaterReleaseSnapshot = {
  arch: string;
  artifact: OpenPixoHostUpdaterArtifactSnapshot;
  checksum: OpenPixoHostUpdaterChecksumSnapshot;
  channel: OpenPixoHostUpdaterChannel;
  downloadedAt: string;
  key: string;
  metadata?: Record<string, unknown>;
  path: string;
  platformKey: string;
  version: string;
};

export type OpenPixoHostUpdaterIncomingSnapshot = {
  arch: string;
  artifact: OpenPixoHostUpdaterArtifactSnapshot;
  channel: OpenPixoHostUpdaterChannel;
  key?: string;
  metadata?: Record<string, unknown>;
  progress?: OpenPixoHostUpdaterProgressSnapshot;
  startedAt: string;
  version: string;
};

export type OpenPixoHostUpdaterCacheLifecycleTrigger = "cold-start" | "manual" | "next-version-ready";

export type OpenPixoHostUpdaterReleaseLifecycleState =
  | "cleanup-deferred"
  | "cleanup-removed"
  | "deprecated"
  | "retained"
  | "unknown";

export type OpenPixoHostUpdaterCacheLifecycleSummary = {
  lastRunAt?: string;
  lastTrigger?: OpenPixoHostUpdaterCacheLifecycleTrigger;
  platform: string;
  releases: {
    cleanupDeferred: number;
    cleanupRemoved: number;
    deprecated: number;
    errors: number;
    retained: number;
    total: number;
    unknown: number;
  };
};

export type OpenPixoHostUpdaterCacheSnapshot = {
  lifecycle?: OpenPixoHostUpdaterCacheLifecycleSummary;
};

export type OpenPixoHostUpdaterReinstallReason =
  | "launcher-schema"
  | "outer-below-min"
  | "outer-version-unreadable";

/**
 * Present when the release feed requires a full installer reinstall instead of
 * an in-place payload update. `installedVersion` is the physically installed
 * outer package version; `url` is an optional operator-supplied explanation
 * link.
 */
export type OpenPixoHostUpdaterReinstallSnapshot = {
  installedVersion?: string;
  minVersion?: string;
  reason: OpenPixoHostUpdaterReinstallReason;
  url?: string;
};

/**
 * Present while the feed declares a minimum usable version above the running
 * one and a release that satisfies it exists. Only a feed response this session
 * actually read can produce it, so being offline never does.
 */
export type OpenPixoHostUpdaterRequiredSnapshot = {
  message?: Record<string, string>;
  minVersion: string;
  url?: string;
};

export type OpenPixoHostUpdaterStatusSnapshot = {
  active?: OpenPixoHostUpdaterReleaseSnapshot;
  arch: string;
  artifact?: OpenPixoHostUpdaterArtifactSnapshot;
  artifactUrl?: string;
  availableVersion?: string;
  cache?: OpenPixoHostUpdaterCacheSnapshot;
  capabilities: OpenPixoHostUpdaterCapabilitySet;
  channel: OpenPixoHostUpdaterChannel;
  checksum?: OpenPixoHostUpdaterChecksumSnapshot;
  currentVersion: string;
  downloadPath?: string;
  enabled: boolean;
  error?: OpenPixoHostUpdaterErrorSnapshot;
  incoming?: OpenPixoHostUpdaterIncomingSnapshot;
  installResult?: OpenPixoHostUpdaterInstallResult;
  lastCheckedAt?: string;
  metadata?: Record<string, unknown>;
  mode: OpenPixoHostUpdaterMode;
  paths?: OpenPixoHostUpdaterPathSnapshot;
  platform: string;
  progress?: OpenPixoHostUpdaterProgressSnapshot;
  reinstall?: OpenPixoHostUpdaterReinstallSnapshot;
  required?: OpenPixoHostUpdaterRequiredSnapshot;
  state: OpenPixoHostUpdaterState;
  supported: boolean;
};

export type OpenPixoHostUpdaterResult =
  | { ok: true; status: OpenPixoHostUpdaterStatusSnapshot }
  | OpenPixoHostFailure;

export type OpenPixoHostUpdaterStatusListener = (status: OpenPixoHostUpdaterStatusSnapshot) => void;

export type OpenPixoHostUpdaterMenuLabels = {
  check: string;
  checking: string;
  downloading: string;
  install: string;
  installing: string;
  restart: string;
};

export type OpenPixoHostUpdaterOpenDialogRequest = {
  source: string;
};

export type OpenPixoHostUpdaterOpenDialogListener = (request: OpenPixoHostUpdaterOpenDialogRequest) => void;

export type OpenPixoHostDownloadResult = {
  url: string;
  state: "completed" | "cancelled" | "interrupted";
};

export type OpenPixoHostBridge = {
  startup?: {
    context(): Promise<{ launch_attempt_id: string; app_session_id: string } | null>;
    signal(value: { launch_attempt_id: string; app_session_id: string;
      readiness_point: 'first_visible' | 'interactive_ready'; required_data_ready?: boolean; actions_ready?: boolean }): Promise<boolean>;
  };
  /** Optional on older hosts. Reports actual disk completion, never initiation. */
  downloads?: {
    subscribe(listener: (result: OpenPixoHostDownloadResult) => void): () => void;
  };
  // Optional so older host builds still satisfy the bridge shape; callers
  // must feature-detect before invoking.
  appearance?: {
    setTheme(theme: OpenPixoHostAppearanceTheme): void;
  };
  // Optional: what the taskbar shows about agent runs. Fire-and-forget; older
  // hosts and the browser have none, so callers feature-detect.
  attention?: {
    /** Show work in progress on the taskbar button while a run is going. */
    setRunning(running: boolean): void;
    /** Flash the taskbar button until the window is focused, unless it already is. */
    request(): void;
  };
  browser: {
    clearData(options?: OpenPixoHostBrowserClearDataOptions): Promise<OpenPixoHostActionResult>;
  };
  capture: {
    page(options?: OpenPixoHostCaptureOptions): Promise<OpenPixoHostCaptureResult>;
  };
  client: OpenPixoHostClient;
  pdf: {
    print(html: string, nonce?: string, options?: OpenPixoHostPdfPrintOptions): Promise<OpenPixoHostActionResult>;
  };
  // Optional so web builds and older desktop hosts keep the same contract.
  // Electron is the only layer that can observe a compositor-affecting
  // subframe navigation failure after the iframe DOM remains healthy.
  preview?: {
    getLatestNavigationFailure(): OpenPixoHostPreviewNavigationFailure | null;
    subscribeNavigationFailure(listener: OpenPixoHostPreviewNavigationFailureListener): () => void;
  };
  project: {
    pickAndImport(init?: OpenPixoHostProjectImportInit): Promise<OpenPixoHostProjectImportResult>;
    pickAndReplaceWorkingDir(projectId: string): Promise<OpenPixoHostProjectReplaceWorkingDirResult>;
    // Optional so older host builds still satisfy the bridge shape; callers
    // must feature-detect before invoking.
    pickWorkingDir?(): Promise<OpenPixoHostPickWorkingDirResult>;
    /** Exact path token after explicit creation intent; the main process enforces allowed parents. */
    authorizeGameParent?(input: { baseDir: string; createParent: true }): Promise<OpenPixoHostPickWorkingDirResult>;
  };
  shell: {
    openExternal(url: string): Promise<OpenPixoHostActionResult>;
    openPath(projectId: string): Promise<OpenPixoHostActionResult>;
  };
  // Desktop only. Absent in Web and old clients; callers must fail closed.
  updater: {
    check(options?: OpenPixoHostUpdaterActionOptions): Promise<OpenPixoHostUpdaterStatusSnapshot>;
    "clear-cache"(options?: OpenPixoHostUpdaterActionOptions): Promise<OpenPixoHostUpdaterStatusSnapshot>;
    download(options?: OpenPixoHostUpdaterActionOptions): Promise<OpenPixoHostUpdaterStatusSnapshot>;
    install(options?: OpenPixoHostUpdaterActionOptions): Promise<OpenPixoHostUpdaterStatusSnapshot>;
    quit(options?: OpenPixoHostUpdaterActionOptions): Promise<OpenPixoHostActionResult>;
    /** `ok` when no task would be interrupted; otherwise the same denial `quit` returns. Changes nothing. */
    restartSafety(): Promise<OpenPixoHostActionResult>;
    setMenuLabels(labels: OpenPixoHostUpdaterMenuLabels): Promise<OpenPixoHostActionResult>;
    status(options?: OpenPixoHostUpdaterActionOptions): Promise<OpenPixoHostUpdaterStatusSnapshot>;
    subscribe(listener: OpenPixoHostUpdaterStatusListener): () => void;
    subscribeOpenDialog(listener: OpenPixoHostUpdaterOpenDialogListener): () => void;
  };
  version: typeof OPENPIXO_HOST_VERSION;
};

export type OpenPixoHostGlobalScope = Record<string, unknown> & {
  window?: unknown;
};
