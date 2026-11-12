import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { parseOpenPixoCloudConfig, type OpenPixoCloudConfig } from "@openpixo/contracts";
import { SIDECAR_DEFAULTS, normalizeNamespace } from "@openpixo/sidecar-proto";

// `electron` is loaded lazily so this module can also be imported from the
// headless entry, which runs in a plain Node process without the electron
// dependency on disk. Top-level `import { app } from "electron"` would crash
// headless at module-load with ERR_MODULE_NOT_FOUND.
async function loadElectronApp() {
  const electron = await import("electron");
  return electron.app;
}

export const PACKAGED_CONFIG_PATH_ENV = "PIXO_PACKAGED_CONFIG_PATH";
export const PACKAGED_NAMESPACE_ENV = "PIXO_PACKAGED_NAMESPACE";
export const PACKAGED_NAMESPACE_BASE_ROOT_ENV = "PIXO_PACKAGED_NAMESPACE_BASE_ROOT";
export const PACKAGED_WEB_OUTPUT_MODE_OVERRIDE_ENV = "PIXO_PACKAGED_ALLOW_WEB_OUTPUT_MODE_OVERRIDE";
export const PACKAGED_WEB_STANDALONE_ROOT_ENV = "PIXO_WEB_STANDALONE_ROOT";
export const PACKAGED_WEB_OUTPUT_MODE_ENV = "PIXO_WEB_OUTPUT_MODE";

export type PackagedWebOutputMode = "server" | "standalone";

export type RawPackagedConfig = {
  
  appVersion?: string;
  // Baked by tools/pack for public release channels; the anon key is a public client key.
  cloudUrl?: string;
  cloudAnonKey?: string;
  cloudAgentUrl?: string;
  daemonCliEntryRelative?: string;
  daemonSidecarEntryRelative?: string;
  namespace?: string;
  namespaceBaseRoot?: string;
  nodeCommandRelative?: string;
  resourceRoot?: string;
  // Baked by tools/pack from PIXO_TELEMETRY_RELAY_URL and forwarded to
  // the daemon at runtime; Langfuse credentials never ship in packaged config.
  telemetryRelayUrl?: string;
  updateMetadataUrl?: string;
  // PostHog product-analytics ingest key, baked by tools/pack from
  // process.env.POSTHOG_KEY at packaging time. Forwarded to the daemon
  // sidecar's spawn env as POSTHOG_KEY. `phc_` keys are public ingest
  // tokens (write-only event capture); embedding them in the bundle is
  // the PostHog-recommended pattern. The integration short-circuits when
  // either this is absent or the user has declined Privacy → metrics.
  posthogKey?: string;
  posthogHost?: string;
  
  
  webSidecarEntryRelative?: string;
  webStandaloneRoot?: string;
  webOutputMode?: string;
};

export type PackagedConfig = {
  
  appVersion: string | null;
  cloud: OpenPixoCloudConfig | null;
  daemonCliEntry: string | null;
  daemonSidecarEntry: string | null;
  namespace: string;
  namespaceBaseRoot: string;
  nodeCommand: string | null;
  resourceRoot: string;
  telemetryRelayUrl: string | null;
  updateMetadataUrl: string | null;
  posthogKey: string | null;
  posthogHost: string | null;
  
  
  webSidecarEntry: string | null;
  webStandaloneRoot: string | null;
  webOutputMode: PackagedWebOutputMode;
};

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfExists(filePath: string): Promise<RawPackagedConfig | null> {
  if (!(await pathExists(filePath))) return null;
  return JSON.parse(await readFile(filePath, "utf8")) as RawPackagedConfig;
}

function resolveDefaultConfigPath(): string {
  return join(process.resourcesPath, "openpixo-config.json");
}

async function readRawPackagedConfig(): Promise<RawPackagedConfig> {
  const explicit = process.env[PACKAGED_CONFIG_PATH_ENV];
  if (explicit != null && explicit.length > 0) {
    const config = await readJsonIfExists(resolve(explicit));
    if (config == null) throw new Error(`packaged config not found at ${explicit}`);
    return config;
  }

  const electronApp = await loadElectronApp();
  return (
    (await readJsonIfExists(resolveDefaultConfigPath())) ??
    (await readJsonIfExists(join(electronApp.getAppPath(), "openpixo-config.json"))) ??
    {}
  );
}

function resolveOptionalPath(value: string | undefined): string | undefined {
  return value == null || value.length === 0 ? undefined : resolve(value);
}

/**
 * A payload desktop runs from
 * `<root>/launcher/channels/<channel>/namespaces/<namespace>/versions/<version>/payload/<exe>`,
 * so the executable itself says which installation it belongs to. Returns that
 * installation's namespace base root, or null for any other executable.
 */
export function namespaceBaseRootFromPayloadExecutable(executablePath: string): string | null {
  const parts = executablePath.split(/[\\/]+/);
  const end = parts.length - 1;
  if (
    end < 9 ||
    parts[end - 1] !== "payload" ||
    parts[end - 3] !== "versions" ||
    parts[end - 5] !== "namespaces" ||
    parts[end - 7] !== "channels" ||
    parts[end - 8] !== "launcher"
  ) {
    return null;
  }
  const separator = executablePath.includes("\\") ? "\\" : "/";
  return `${parts.slice(0, end - 8).join(separator)}${separator}namespaces`;
}

/**
 * Projects, sign-in and every other daemon file live under this root, so an
 * update must never move it. The payload's own config cannot decide that: a public
 * payload carries no root at all, while an install made by tools-pack bakes one
 * into its outer config. The payload's location is the only thing both agree on,
 * so it outranks the config.
 */
export function resolvePackagedNamespaceBaseRoot(
  rawNamespaceBaseRoot: string | undefined,
  electronUserDataRoot: string,
  env: NodeJS.ProcessEnv = process.env,
  executablePath: string = process.execPath,
): string {
  return resolveOptionalPath(env[PACKAGED_NAMESPACE_BASE_ROOT_ENV])
    ?? namespaceBaseRootFromPayloadExecutable(executablePath)
    ?? resolveOptionalPath(rawNamespaceBaseRoot)
    ?? join(electronUserDataRoot, "namespaces");
}

// Config DTOs use null for optional scalar values consumed by runtime options;
// optional paths use undefined so callers can distinguish "no path" from a resolved path string.
function cleanOptionalString(value: string | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}


function resolvePackagedWebOutputMode(value: string | undefined): PackagedWebOutputMode {
  if (value == null || value.length === 0) return "server";
  if (value === "server" || value === "standalone") return value;
  throw new Error(`unsupported packaged web output mode: ${value}`);
}


function isTruthyEnv(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "yes";
}

function resolvePackagedWebStandaloneRoot(
  webOutputMode: PackagedWebOutputMode,
  value: string | undefined,
): string | null {
  const configured = resolveOptionalPath(value);
  if (configured != null) return configured;
  if (webOutputMode !== "standalone") return null;
  return join(process.resourcesPath, "openpixo-web-standalone");
}

async function resolvePackagedRelativeEntry(value: string | undefined): Promise<string | null> {
  const cleaned = cleanOptionalString(value);
  if (cleaned == null) return null;
  const entry = join(process.resourcesPath, cleaned);
  if (!(await pathExists(entry))) {
    throw new Error(`configured packaged entry not found at ${entry}`);
  }
  return entry;
}

export async function readPackagedConfig(): Promise<PackagedConfig> {
  const raw = await readRawPackagedConfig();
  const namespace = normalizeNamespace(
    process.env[PACKAGED_NAMESPACE_ENV] ?? raw.namespace ?? SIDECAR_DEFAULTS.namespace,
  );
  const electronApp = await loadElectronApp();
  const namespaceBaseRoot = resolvePackagedNamespaceBaseRoot(
    raw.namespaceBaseRoot,
    electronApp.getPath("userData"),
  );
  const resourceRoot = resolveOptionalPath(raw.resourceRoot) ?? join(process.resourcesPath, "openpixo");
  const relativeNodeCommand =
    raw.nodeCommandRelative == null || raw.nodeCommandRelative.length === 0
      ? join("openpixo", "bin", "node")
      : raw.nodeCommandRelative;
  const nodeCommandCandidate = join(process.resourcesPath, relativeNodeCommand);
  const nodeCommand = (await pathExists(nodeCommandCandidate)) ? nodeCommandCandidate : null;
  const allowWebOutputModeOverride = isTruthyEnv(process.env[PACKAGED_WEB_OUTPUT_MODE_OVERRIDE_ENV]);
  const webOutputMode = resolvePackagedWebOutputMode(
    allowWebOutputModeOverride
      ? process.env[PACKAGED_WEB_OUTPUT_MODE_ENV] ?? raw.webOutputMode
      : raw.webOutputMode,
  );
  const webStandaloneRoot = resolvePackagedWebStandaloneRoot(
    webOutputMode,
    allowWebOutputModeOverride
      ? process.env[PACKAGED_WEB_STANDALONE_ROOT_ENV] ?? raw.webStandaloneRoot
      : raw.webStandaloneRoot,
  );
  const daemonCliEntry = await resolvePackagedRelativeEntry(raw.daemonCliEntryRelative);
  const daemonSidecarEntry = await resolvePackagedRelativeEntry(raw.daemonSidecarEntryRelative);
  const webSidecarEntry = await resolvePackagedRelativeEntry(raw.webSidecarEntryRelative);

  return {
    
    appVersion: cleanOptionalString(raw.appVersion),
    cloud: parseOpenPixoCloudConfig(raw.cloudUrl, raw.cloudAnonKey, raw.cloudAgentUrl),
    daemonCliEntry,
    daemonSidecarEntry,
    namespace,
    namespaceBaseRoot,
    nodeCommand,
    resourceRoot,
    // Fork builds never inherit upstream telemetry destinations or ingest keys.
    telemetryRelayUrl: null,
    updateMetadataUrl: cleanOptionalString(raw.updateMetadataUrl),
    posthogKey: null,
    posthogHost: null,
    
    
    webSidecarEntry,
    webStandaloneRoot,
    webOutputMode,
  };
}
