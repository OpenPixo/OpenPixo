import { OPENPIXO_HOST_UPDATER_ACTIONS } from "./protocol.js";
import type {
  OpenPixoHostActionResult,
  OpenPixoHostDownloadResult,
  OpenPixoHostBrowserClearDataOptions,
  OpenPixoHostCaptureOptions,
  OpenPixoHostCaptureResult,
  OpenPixoHostFailure,
  OpenPixoHostGlobalScope,
  OpenPixoHostPdfPrintOptions,
  OpenPixoHostPreviewNavigationFailure,
  OpenPixoHostPreviewNavigationFailureListener,
  OpenPixoHostPickWorkingDirResult,
  OpenPixoHostProjectImportInit,
  OpenPixoHostProjectImportResult,
  OpenPixoHostProjectReplaceWorkingDirResult,
  OpenPixoHostUpdaterActionOptions,
  OpenPixoHostUpdaterMenuLabels,
  OpenPixoHostUpdaterOpenDialogListener,
  OpenPixoHostUpdaterResult,
  OpenPixoHostUpdaterStatusAction,
  OpenPixoHostUpdaterStatusListener,
} from "./protocol.js";
import { getOpenPixoHost } from "./detection.js";

/**
 * @module actions
 *
 * Renderer-facing wrappers over the host bridge. Each resolves the bridge from
 * scope, invokes the capability, and returns a host-owned result (or a uniform
 * "host is not available" failure). Covers shell, browser, capture, project,
 * pdf and the full updater action surface.
 */

/** @internal Build a normalized host failure result. */
function failure(reason: string, details?: unknown): OpenPixoHostFailure {
  return {
    ...(details === undefined ? {} : { details }),
    ok: false,
    reason,
  };
}

/** @internal Uniform failure for when the host bridge is absent. */
function unavailable(reason: string): OpenPixoHostFailure {
  return failure(reason);
}

/** Open an external URL through the host shell. */
export async function openHostExternalUrl(url: string, scope: OpenPixoHostGlobalScope = globalThis): Promise<OpenPixoHostActionResult> {
  const host = getOpenPixoHost(scope);
  if (host == null) return unavailable("OpenPixo host is not available");
  try {
    return await host.shell.openExternal(url);
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : String(error));
  }
}

/** Reveal a project's path through the host shell. */
export async function openHostProjectPath(projectId: string, scope: OpenPixoHostGlobalScope = globalThis): Promise<OpenPixoHostActionResult> {
  const host = getOpenPixoHost(scope);
  if (host == null) return unavailable("OpenPixo host is not available");
  try {
    return await host.shell.openPath(projectId);
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : String(error));
  }
}

/** Clear host browser data (cookies and/or storage). */
export async function clearHostBrowserData(
  options?: OpenPixoHostBrowserClearDataOptions,
  scope: OpenPixoHostGlobalScope = globalThis,
): Promise<OpenPixoHostActionResult> {
  const host = getOpenPixoHost(scope);
  if (host == null) return unavailable("OpenPixo host is not available");
  try {
    return await host.browser.clearData(options);
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : String(error));
  }
}

/** Capture the host page (optionally clipped) as a data URL. */
export async function captureHostPage(
  options?: OpenPixoHostCaptureOptions,
  scope: OpenPixoHostGlobalScope = globalThis,
): Promise<OpenPixoHostCaptureResult> {
  const host = getOpenPixoHost(scope);
  if (host == null) return unavailable("OpenPixo host is not available");
  try {
    return await host.capture.page(options);
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : String(error));
  }
}

/** Pick and import a project through the host's native dialog. */
export async function pickAndImportHostProject(
  init?: OpenPixoHostProjectImportInit,
  scope: OpenPixoHostGlobalScope = globalThis,
): Promise<OpenPixoHostProjectImportResult> {
  const host = getOpenPixoHost(scope);
  if (host == null) return unavailable("OpenPixo host is not available");
  try {
    return await host.project.pickAndImport(init);
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : String(error));
  }
}

/** Pick and replace a project's working directory through the host. */
export async function pickAndReplaceHostProjectWorkingDir(
  projectId: string,
  scope: OpenPixoHostGlobalScope = globalThis,
): Promise<OpenPixoHostProjectReplaceWorkingDirResult> {
  const host = getOpenPixoHost(scope);
  if (host == null) return unavailable("OpenPixo host is not available");
  try {
    return await host.project.pickAndReplaceWorkingDir(projectId);
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : String(error));
  }
}

// Picks a folder via the host's native dialog and returns the chosen path
// plus a single-use token, WITHOUT touching any project. The Home flow uses
// this to let the user choose a working directory before the project exists;
// the token is later spent on POST /api/projects/:id/working-dir.
export async function pickHostWorkingDir(
  scope: OpenPixoHostGlobalScope = globalThis,
): Promise<OpenPixoHostPickWorkingDirResult> {
  const host = getOpenPixoHost(scope);
  if (host == null) return unavailable("OpenPixo host is not available");
  if (typeof host.project.pickWorkingDir !== "function") {
    return unavailable("host build does not support pickWorkingDir");
  }
  try {
    return await host.project.pickWorkingDir();
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : String(error));
  }
}

/** Request one exact game-parent token; the host rejects unauthorized locations. */
export async function authorizeHostGameParent(baseDir: string, scope: OpenPixoHostGlobalScope = globalThis): Promise<OpenPixoHostPickWorkingDirResult> {
  const host = getOpenPixoHost(scope);
  if (!host?.project.authorizeGameParent) return unavailable('host build does not support game parent authorization');
  try { return await host.project.authorizeGameParent({ baseDir, createParent: true }); }
  catch (error) { return unavailable(error instanceof Error ? error.message : String(error)); }
}

/** Print HTML to PDF through the host. */
export async function printHostPdf(
  html: string,
  nonce?: string,
  options?: OpenPixoHostPdfPrintOptions,
  scope: OpenPixoHostGlobalScope = globalThis,
): Promise<OpenPixoHostActionResult> {
  const host = getOpenPixoHost(scope);
  if (host == null) return unavailable("OpenPixo host is not available");
  try {
    return await host.pdf.print(html, nonce, options);
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : String(error));
  }
}


/** Read the latest Electron-observed preview subframe navigation failure. */
export function getLatestHostPreviewNavigationFailure(
  scope: OpenPixoHostGlobalScope = globalThis,
): OpenPixoHostPreviewNavigationFailure | null {
  const host = getOpenPixoHost(scope);
  if (typeof host?.preview?.getLatestNavigationFailure !== "function") return null;
  try {
    return host.preview.getLatestNavigationFailure();
  } catch {
    return null;
  }
}

/** Subscribe to Electron-observed preview subframe navigation failures. */
export function subscribeHostPreviewNavigationFailure(
  listener: OpenPixoHostPreviewNavigationFailureListener,
  scope: OpenPixoHostGlobalScope = globalThis,
): () => void {
  const host = getOpenPixoHost(scope);
  if (typeof host?.preview?.subscribeNavigationFailure !== "function") return () => undefined;
  try {
    return host.preview.subscribeNavigationFailure(listener);
  } catch {
    return () => undefined;
  }
}

/** @internal Run a status-returning updater action and wrap the result. */
async function runHostUpdaterAction(
  action: OpenPixoHostUpdaterStatusAction,
  options?: OpenPixoHostUpdaterActionOptions,
  scope: OpenPixoHostGlobalScope = globalThis,
): Promise<OpenPixoHostUpdaterResult> {
  const host = getOpenPixoHost(scope);
  if (host == null) return unavailable("OpenPixo host is not available");
  try {
    return {
      ok: true,
      status: await host.updater[action](options),
    };
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : String(error));
  }
}

/** Get the host updater status. */
export async function getHostUpdaterStatus(
  options?: OpenPixoHostUpdaterActionOptions,
  scope: OpenPixoHostGlobalScope = globalThis,
): Promise<OpenPixoHostUpdaterResult> {
  return await runHostUpdaterAction(OPENPIXO_HOST_UPDATER_ACTIONS.STATUS, options, scope);
}

/** Trigger a host updater check. */
export async function checkHostUpdater(
  options?: OpenPixoHostUpdaterActionOptions,
  scope: OpenPixoHostGlobalScope = globalThis,
): Promise<OpenPixoHostUpdaterResult> {
  return await runHostUpdaterAction(OPENPIXO_HOST_UPDATER_ACTIONS.CHECK, options, scope);
}

/** Trigger a host updater download. */
export async function downloadHostUpdater(
  options?: OpenPixoHostUpdaterActionOptions,
  scope: OpenPixoHostGlobalScope = globalThis,
): Promise<OpenPixoHostUpdaterResult> {
  return await runHostUpdaterAction(OPENPIXO_HOST_UPDATER_ACTIONS.DOWNLOAD, options, scope);
}

/** Clear the host updater/launcher caches and reset one-shot update state. */
export async function clearHostUpdaterCache(
  options?: OpenPixoHostUpdaterActionOptions,
  scope: OpenPixoHostGlobalScope = globalThis,
): Promise<OpenPixoHostUpdaterResult> {
  return await runHostUpdaterAction(OPENPIXO_HOST_UPDATER_ACTIONS.CLEAR_CACHE, options, scope);
}

/** Trigger a host updater install. */
export async function installHostUpdater(
  options?: OpenPixoHostUpdaterActionOptions,
  scope: OpenPixoHostGlobalScope = globalThis,
): Promise<OpenPixoHostUpdaterResult> {
  return await runHostUpdaterAction(OPENPIXO_HOST_UPDATER_ACTIONS.INSTALL, options, scope);
}

/** Quit the host after its updater installer has opened. */
export async function quitHostAfterUpdaterInstallerOpen(
  options?: OpenPixoHostUpdaterActionOptions,
  scope: OpenPixoHostGlobalScope = globalThis,
): Promise<OpenPixoHostActionResult> {
  const host = getOpenPixoHost(scope);
  if (host == null) return unavailable("OpenPixo host is not available");
  try {
    return await host.updater.quit(options);
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : String(error));
  }
}

/** Ask whether restarting now would interrupt a running task. Changes nothing. */
export async function readHostUpdaterRestartSafety(
  scope: OpenPixoHostGlobalScope = globalThis,
): Promise<OpenPixoHostActionResult> {
  const host = getOpenPixoHost(scope);
  if (host == null) return unavailable("OpenPixo host is not available");
  try {
    return await host.updater.restartSafety();
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : String(error));
  }
}

/** Subscribe to host updater status changes; returns an unsubscribe fn. */
export function subscribeHostUpdater(
  listener: OpenPixoHostUpdaterStatusListener,
  scope: OpenPixoHostGlobalScope = globalThis,
): () => void {
  const host = getOpenPixoHost(scope);
  if (host == null) return () => undefined;
  try {
    return host.updater.subscribe(listener);
  } catch {
    return () => undefined;
  }
}

/** Subscribe to native host requests to open the updater dialog. */
export function subscribeHostUpdaterOpenDialog(
  listener: OpenPixoHostUpdaterOpenDialogListener,
  scope: OpenPixoHostGlobalScope = globalThis,
): () => void {
  const host = getOpenPixoHost(scope);
  if (host == null) return () => undefined;
  try {
    return host.updater.subscribeOpenDialog(listener);
  } catch {
    return () => undefined;
  }
}

/** Synchronize renderer-localized updater menu labels to the native host. */
export async function setHostUpdaterMenuLabels(
  labels: OpenPixoHostUpdaterMenuLabels,
  scope: OpenPixoHostGlobalScope = globalThis,
): Promise<OpenPixoHostActionResult> {
  const host = getOpenPixoHost(scope);
  if (host == null) return unavailable("OpenPixo host is not available");
  try {
    return await host.updater.setMenuLabels(labels);
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : String(error));
  }
}

/** Observe native download completion when the host supports it. */
export function subscribeHostDownloads(
  listener: (result: OpenPixoHostDownloadResult) => void,
  scope: OpenPixoHostGlobalScope = globalThis,
): (() => void) | null {
  return getOpenPixoHost(scope)?.downloads?.subscribe(listener) ?? null;
}
