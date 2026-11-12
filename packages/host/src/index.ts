/**
 * @module host
 *
 * Public barrel for `@openpixo/host` — the OpenPixo renderer host-bridge
 * protocol. Re-exports the exact prior flat surface from the cohesive sibling
 * modules: the wire protocol (constants + types), bridge detection/validation,
 * adapter-result normalizers, and the renderer-facing action wrappers. This
 * file contains no logic.
 */

// --- protocol: constant registries + wire types ---
export {
  OPENPIXO_HOST_GLOBAL,
  OPENPIXO_HOST_VERSION,
  OPENPIXO_HOST_APPEARANCE_THEMES,
  OPENPIXO_HOST_CLIENT_TYPES,
  OPENPIXO_HOST_UPDATER_ACTIONS,
  OPENPIXO_HOST_UPDATER_STATES,
} from "./protocol.js";
export type {
  OpenPixoHostClientType,
  OpenPixoHostClient,
  OpenPixoHostFailure,
  OpenPixoHostActionResult,
  OpenPixoHostDownloadResult,
  OpenPixoHostProjectImportInit,
  OpenPixoHostProjectImportSuccess,
  OpenPixoHostProjectImportResult,
  OpenPixoHostProjectReplaceWorkingDirSuccess,
  OpenPixoHostProjectReplaceWorkingDirResult,
  OpenPixoHostPickWorkingDirSuccess,
  OpenPixoHostPickWorkingDirResult,
  OpenPixoHostPdfPrintOptions,
  OpenPixoHostCaptureClip,
  OpenPixoHostCaptureOptions,
  OpenPixoHostCaptureSuccess,
  OpenPixoHostCaptureResult,
  OpenPixoHostPreviewNavigationFailure,
  OpenPixoHostPreviewNavigationFailureListener,
  OpenPixoHostAppearanceTheme,
  OpenPixoHostBrowserClearDataOptions,
  OpenPixoHostUpdaterAction,
  OpenPixoHostUpdaterState,
  OpenPixoHostUpdaterMode,
  OpenPixoHostUpdaterChannel,
  OpenPixoHostUpdaterActionOptions,
  OpenPixoHostUpdaterCapabilitySet,
  OpenPixoHostUpdaterPathSnapshot,
  OpenPixoHostUpdaterChecksumSnapshot,
  OpenPixoHostUpdaterArtifactSnapshot,
  OpenPixoHostUpdaterProgressSnapshot,
  OpenPixoHostUpdaterErrorSnapshot,
  OpenPixoHostUpdaterInstallResult,
  OpenPixoHostUpdaterReleaseSnapshot,
  OpenPixoHostUpdaterIncomingSnapshot,
  OpenPixoHostUpdaterCacheLifecycleTrigger,
  OpenPixoHostUpdaterReleaseLifecycleState,
  OpenPixoHostUpdaterCacheLifecycleSummary,
  OpenPixoHostUpdaterCacheSnapshot,
  OpenPixoHostUpdaterReinstallReason,
  OpenPixoHostUpdaterReinstallSnapshot,
  OpenPixoHostUpdaterRequiredSnapshot,
  OpenPixoHostUpdaterStatusSnapshot,
  OpenPixoHostUpdaterResult,
  OpenPixoHostUpdaterStatusListener,
  OpenPixoHostUpdaterMenuLabels,
  OpenPixoHostUpdaterOpenDialogRequest,
  OpenPixoHostUpdaterOpenDialogListener,
  OpenPixoHostBridge,
  OpenPixoHostGlobalScope,
} from "./protocol.js";

// --- detection: locate + validate the injected bridge ---
export {
  isOpenPixoHostBridge,
  getOpenPixoHost,
  isOpenPixoHostAvailable,
  detectOpenPixoHostClientType,
} from "./detection.js";

// --- normalize: adapter result -> renderer contract ---
export {
  normalizeOpenPixoHostProjectImportResult,
  normalizeOpenPixoHostProjectReplaceWorkingDirResult,
  normalizeOpenPixoHostPickWorkingDirResult,
} from "./normalize.js";

// --- actions: renderer-facing host action wrappers ---
export {
  openHostExternalUrl,
  openHostProjectPath,
  clearHostBrowserData,
  captureHostPage,
  pickAndImportHostProject,
  pickAndReplaceHostProjectWorkingDir,
  pickHostWorkingDir,
  authorizeHostGameParent,
  printHostPdf,
  subscribeHostDownloads,
  getHostUpdaterStatus,
  checkHostUpdater,
  clearHostUpdaterCache,
  downloadHostUpdater,
  installHostUpdater,
  quitHostAfterUpdaterInstallerOpen,
  readHostUpdaterRestartSafety,
  getLatestHostPreviewNavigationFailure,
  subscribeHostUpdater,
  subscribeHostUpdaterOpenDialog,
  subscribeHostPreviewNavigationFailure,
  setHostUpdaterMenuLabels,
} from "./actions.js";
