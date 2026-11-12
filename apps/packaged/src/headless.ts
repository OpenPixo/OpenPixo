import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseOpenPixoCloudConfig } from "@openpixo/contracts";
import {
  APP_KEYS,
  OPENPIXO_SIDECAR_CONTRACT,
  SIDECAR_DEFAULTS,
  SIDECAR_SOURCES,
} from "@openpixo/sidecar-proto";
import { bootstrapSidecarProcess, readCurrentSidecarStamp } from "@openpixo/sidecar";
import { releaseChannelFromNamespace } from "@openpixo/release";

import { PACKAGED_NAMESPACE_ENV, type PackagedConfig } from "./config.js";
import {
  parsePackagedHeadlessRequest,
  runPackagedHeadless,
} from "./headless-runtime.js";
import { resolvePackagedNamespacePaths } from "./paths.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

function resolveHeadlessNamespaceBaseRoot(): string {
  const pixoDataDir = process.env.PIXO_DATA_DIR;
  if (pixoDataDir != null && pixoDataDir.length > 0) {
    return join(resolve(pixoDataDir.replace(/^~/, homedir())), "namespaces");
  }
  const xdgDataHome = process.env.XDG_DATA_HOME;
  const dataBase =
    xdgDataHome != null && xdgDataHome.length > 0
      ? xdgDataHome
      : join(homedir(), ".local", "share");
  return join(dataBase, "openpixo", "namespaces");
}


function resolveHeadlessConfig(): PackagedConfig {
  const namespace = OPENPIXO_SIDECAR_CONTRACT.normalizeNamespace(
    process.env[PACKAGED_NAMESPACE_ENV] ?? SIDECAR_DEFAULTS.namespace,
  );
  const namespaceBaseRoot = resolveHeadlessNamespaceBaseRoot();

  // PIXO_RESOURCE_ROOT may be set by a launcher script; otherwise default to a
  // sibling openpixo/ directory relative to the node_modules that contain
  // this file — the layout written by tools-pack linux headless-install.
  const resourceRoot =
    process.env.PIXO_RESOURCE_ROOT
    ?? join(__dirname, "..", "..", "..", "openpixo");

  return {
    
    appVersion: null,
    cloud: parseOpenPixoCloudConfig(process.env.PIXO_CLOUD_URL, process.env.PIXO_CLOUD_ANON_KEY, process.env.PIXO_AGENT_URL),
    daemonCliEntry: null,
    daemonSidecarEntry: null,
    namespace,
    namespaceBaseRoot,
    nodeCommand: null,
    resourceRoot,
    telemetryRelayUrl:
      process.env.PIXO_TELEMETRY_RELAY_URL?.trim() || null,
    updateMetadataUrl: process.env.PIXO_UPDATE_METADATA_URL?.trim() || null,
    posthogKey: process.env.POSTHOG_KEY?.trim() || null,
    posthogHost: process.env.POSTHOG_HOST?.trim() || null,
    
    
    webSidecarEntry: null,
    webStandaloneRoot: null,
    webOutputMode: "server",
  };
}

const headlessRequest = parsePackagedHeadlessRequest([
  "--headless",
  ...process.argv.slice(2),
]);

async function main(): Promise<void> {
  const config = resolveHeadlessConfig();
  const paths = resolvePackagedNamespacePaths(config, config.namespace, process.env);
  const currentStamp = (() => {
    try { return readCurrentSidecarStamp(); } catch { return null; }
  })();
  const stamp = currentStamp ?? {
    app: APP_KEYS.DESKTOP,
    channel: releaseChannelFromNamespace(config.namespace, "default") ?? "stable",
    mode: "headless",
    namespace: config.namespace,
    source: SIDECAR_SOURCES.PACKAGED,
  };
  if (await bootstrapSidecarProcess(stamp, {
    dataRoot: paths.dataRoot,
    ownerPid: null,
    port: 0,
    runtimeRoot: paths.runtimeRoot,
  })) return;
  await runPackagedHeadless(config, headlessRequest, {
    mcpBootstrapLaunch: {
      command: process.execPath,
      args: [fileURLToPath(import.meta.url), "--headless"],
    },
  });
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `openpixo headless failed: ${
      error instanceof Error ? error.message : String(error)
    }\n`,
  );
  process.exit(1);
});
