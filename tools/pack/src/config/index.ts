import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  isUpstreamHost,
  type OpenPixoCloudConfig,
  parseOpenPixoCloudConfig,
  PRODUCT_CLOUD_ANON_KEY,
  PRODUCT_CLOUD_URL,
} from "@openpixo/contracts";

import {
  OPENPIXO_SIDECAR_CONTRACT,
  SIDECAR_DEFAULTS,
} from "@openpixo/sidecar-proto";
import { resolveNamespace } from "@openpixo/sidecar";
import {
  isPublicReleaseChannel,
  isPublicReleaseVersion,
  publicUpdateFeedUrl,
  releaseChannelFromVersion,
  releaseNamespace,
  type PublicReleaseChannel,
} from "@openpixo/release";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveToolPackRoot(startDir: string): string {
  let candidate = startDir;
  while (true) {
    const packageJsonPath = join(candidate, "package.json");
    if (existsSync(packageJsonPath)) {
      const require = createRequire(packageJsonPath);
      const packageJson = require(packageJsonPath) as { name?: string };
      if (packageJson.name === "@openpixo/tools-pack") return candidate;
    }

    const parent = path.dirname(candidate);
    if (parent === candidate) {
      throw new Error(`could not locate @openpixo/tools-pack package from ${startDir}`);
    }
    candidate = parent;
  }
}

export const WORKSPACE_ROOT = resolve(resolveToolPackRoot(__dirname), "../..");

export type ToolPackPlatform = "mac" | "win" | "linux";
export type ToolPackBuildOutput = "all" | "app" | "appimage" | "dir" | "dmg" | "nsis" | "zip";
export type ToolPackMacCompression = "store" | "normal" | "maximum";
export type ToolPackWebOutputMode = "server" | "standalone";

export type ToolPackCliOptions = {
  appVersion?: string;
  cacheDir?: string;
  containerized?: boolean;
  dir?: string;
  diagnoseAttempts?: string | number;
  expectedVersion?: string;
  expr?: string;
  headless?: boolean;
  json?: boolean;
  macCompression?: string;
  notarize?: boolean;
  namespace?: string;
  path?: string;
  payloadPath?: string;
  portable?: boolean;
  releaseChannel?: string;
  removeCache?: boolean;
  removeData?: boolean;
  removeLogs?: boolean;
  removeProductUserData?: boolean;
  removeSidecars?: boolean;
  requireOpenCode?: boolean;
  signed?: boolean;
  silent?: boolean;
  statusPollCount?: string | number;
  statusPollIntervalMs?: string | number;
  to?: string;
  updateAction?: string;
};

export type ToolPackRoots = {
  output: {
    appBuilderRoot: string;
    namespaceRoot: string;
    platformRoot: string;
    root: string;
  };
  runtime: {
    namespaceBaseRoot: string;
    namespaceRoot: string;
  };
  cacheRoot: string;
  toolPackRoot: string;
};

export type ToolPackConfig = {
  appVersion?: string;
  /** OpenPixo Cloud the packaged daemon signs in to; public release channels default to production. */
  cloud?: OpenPixoCloudConfig;
  containerized: boolean;
  electronBuilderCliPath: string;
  electronDistPath: string;
  electronVersion: string;
  macCompression: ToolPackMacCompression;
  macNotarize?: boolean;
  namespace: string;
  platform: ToolPackPlatform;
  portable: boolean;
  /** Public channel whose OpenPixo-hosted update feed this build bakes in (release builds only). */
  releaseChannel?: PublicReleaseChannel;
  removeCache?: boolean;
  removeData: boolean;
  removeLogs: boolean;
  removeProductUserData: boolean;
  removeSidecars: boolean;
  requireOpenCode: boolean;
  roots: ToolPackRoots;
  silent: boolean;
  signed: boolean;
  
  telemetryRelayUrl?: string;
  /**
   * PostHog product-analytics ingest key, sourced from process.env.POSTHOG_KEY
   * at packaging time. Baked into openpixo-config.json so the packaged
   * daemon can read it as POSTHOG_KEY env at launch — only official Open
   * Design builds (CI with the secret set) ship with this; forks compiling
   * locally produce binaries that omit the key and the integration
   * short-circuits cleanly. Apache-2.0 keeps the bundle public, but `phc_`
   * keys are write-only event ingest keys (cannot read your project data),
   * so embedding them in the binary is the PostHog-recommended pattern.
   */
  posthogKey?: string;
  posthogHost?: string;
  
  /**
   * Personal API key (`phx_...`) used by the @posthog/cli sourcemap helper to
   * upload browser sourcemaps to PostHog after `next build` and before the
   * web bundle is copied into the Electron package. Sourced from
   * `POSTHOG_CLI_API_KEY` (or the legacy `POSTHOG_PERSONAL_API_KEY` alias)
   * in CI; when missing (local packaging by a contributor, fork builds, PRs)
   * the helper still strips the .map files so source never leaks into the
   * shipped installer — it just skips the upload step.
   */
  posthogCliApiKey?: string;
  /**
   * Explicitly configured PostHog project ID
   * used by `@posthog/cli sourcemap upload`. Sourced from
   * `POSTHOG_CLI_PROJECT_ID` (or the alias `POSTHOG_PROJECT_ID`) in CI.
   * Required for upload to be attempted; missing → strip-only path.
   */
  posthogCliProjectId?: string;
  updateMetadataUrl?: string;
  /**
   * PostHog **management** host used by `@posthog/cli sourcemap upload`. This
   * is the regional app host (e.g. `https://us.posthog.com`) — distinct from
   * `posthogHost` above, which is the **ingest** host (`us.i.posthog.com`)
   * used by the runtime SDK and accepts `/capture/` traffic only. Sourced
   * from `POSTHOG_CLI_HOST`; when missing, the CLI defaults to the US Cloud
   * app host on its own, which is correct for the official project.
   */
  posthogCliHost?: string;
  to: ToolPackBuildOutput;
  webOutputMode: ToolPackWebOutputMode;
  workspaceRoot: string;
};

function resolveToolPackBuildOutput(platform: ToolPackPlatform, value: string | undefined): ToolPackBuildOutput {
  if (value == null || value.length === 0) return platform === "win" ? "nsis" : "all";
  if (platform === "mac" && (value === "all" || value === "app" || value === "dmg" || value === "zip")) return value;
  if (platform === "win" && (value === "all" || value === "dir" || value === "nsis" || value === "zip")) return value;
  if (platform === "linux" && (value === "all" || value === "appimage" || value === "dir")) return value;
  throw new Error(`unsupported ${platform} --to target: ${value}`);
}

function resolveToolPackMacCompression(value: string | undefined): ToolPackMacCompression {
  if (value == null || value.length === 0) return "normal";
  if (value === "store" || value === "normal" || value === "maximum") return value;
  throw new Error(`unsupported mac --mac-compression value: ${value}`);
}

function resolveToolPackAppVersion(value: string | undefined): string | undefined {
  if (value == null) return undefined;
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error("--app-version must not be empty");
  if (/\s/.test(normalized)) throw new Error(`--app-version must not contain whitespace: ${value}`);
  return normalized;
}

function defaultNamespaceForAppVersion(platform: ToolPackPlatform, appVersion: string | undefined): string {
  const channel = releaseChannelFromVersion(appVersion);
  if (channel == null) return SIDECAR_DEFAULTS.namespace;

  return releaseNamespace(channel, platform);
}

function resolveToolPackWebOutputMode(platform: ToolPackPlatform, value: string | undefined): ToolPackWebOutputMode {
  // Standalone web output is wired for desktop packaged platforms; Linux stays on
  // the existing server output until its AppImage resource path is optimized.
  if (platform === "linux") return "server";
  if (value == null || value.length === 0) return "standalone";
  if (value === "server" || value === "standalone") return value;
  throw new Error(`unsupported PIXO_WEB_OUTPUT_MODE value: ${value}`);
}




/**
 * A public release build names its channel; the channel must agree with the
 * exact public version form, because the desktop updater derives its channel
 * from the running version and rejects feeds of any other channel.
 */
function resolveToolPackReleaseChannel(
  value: string | undefined,
  appVersion: string | undefined,
  portable: boolean,
): PublicReleaseChannel | undefined {
  if (value == null || value.length === 0) return undefined;
  if (!isPublicReleaseChannel(value)) throw new Error(`--release-channel must be stable or beta, got ${value}`);
  if (!portable) throw new Error("--release-channel requires --portable");
  if (appVersion == null || !isPublicReleaseVersion(appVersion, value)) {
    const form = value === "stable" ? "MAJOR.MINOR.PATCH" : "MAJOR.MINOR.PATCH-beta.N";
    throw new Error(`--release-channel ${value} requires --app-version in the form ${form}`);
  }
  return value;
}

/**
 * Release builds bake their channel's OpenPixo feed so the packaged updater is
 * on by default. An explicit PIXO_UPDATE_METADATA_URL still wins, which keeps
 * loopback fixtures usable for local validation builds.
 */
function resolveToolPackUpdateMetadataUrl(
  value: string | undefined,
  releaseChannel?: PublicReleaseChannel,
): string | undefined {
  const normalized = value?.trim() ?? "";
  if (normalized.length === 0) return releaseChannel == null ? undefined : publicUpdateFeedUrl(releaseChannel);
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error(`PIXO_UPDATE_METADATA_URL must be an absolute URL: ${value}`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`PIXO_UPDATE_METADATA_URL must use http(s): ${value}`);
  }
  if (isUpstreamHost(parsed.hostname)) {
    throw new Error("PIXO_UPDATE_METADATA_URL must not use an upstream update feed");
  }
  return normalized;
}

/**
 * PIXO_CLOUD_URL + PIXO_CLOUD_ANON_KEY override the cloud (both or neither), and PIXO_AGENT_URL
 * names that cloud's agent gateway; otherwise public release channels bake the production cloud
 * from @openpixo/contracts. A stable build without one would ship a paid product whose sign-in,
 * credits and hosted generation cannot work.
 */
export function resolveToolPackCloud(
  env: NodeJS.ProcessEnv,
  releaseChannel?: PublicReleaseChannel,
  production: { url: string; anonKey: string } = { url: PRODUCT_CLOUD_URL, anonKey: PRODUCT_CLOUD_ANON_KEY },
): OpenPixoCloudConfig | undefined {
  if (env.PIXO_CLOUD_URL?.trim() || env.PIXO_CLOUD_ANON_KEY?.trim()) {
    const cloud = parseOpenPixoCloudConfig(env.PIXO_CLOUD_URL, env.PIXO_CLOUD_ANON_KEY, env.PIXO_AGENT_URL);
    if (cloud == null) {
      throw new Error("PIXO_CLOUD_URL and PIXO_CLOUD_ANON_KEY must both be set: an https origin and a single-line key. PIXO_AGENT_URL, if set, must be an https URL");
    }
    return cloud;
  }
  if (releaseChannel == null) return undefined;
  const cloud = parseOpenPixoCloudConfig(production.url, production.anonKey);
  if (cloud == null && releaseChannel === "stable") {
    throw new Error("stable builds must ship the production cloud: set PRODUCT_CLOUD_URL and PRODUCT_CLOUD_ANON_KEY in packages/contracts/src/product.ts");
  }
  return cloud ?? undefined;
}

function resolveElectronVersion(workspaceRoot: string): string {
  const require = createRequire(join(workspaceRoot, "apps/desktop/package.json"));
  const desktopPackage = require(join(workspaceRoot, "apps/desktop/package.json")) as {
    devDependencies?: Record<string, string>;
  };
  const version = desktopPackage.devDependencies?.electron;
  if (version == null || version.length === 0) {
    throw new Error("apps/desktop/package.json must declare electron");
  }
  return version;
}

function resolveElectronDistPath(workspaceRoot: string): string {
  const require = createRequire(join(workspaceRoot, "apps/desktop/package.json"));
  const electronEntry = require.resolve("electron");
  return join(path.dirname(electronEntry), "dist");
}

function resolveElectronBuilderCliPath(): string {
  const require = createRequire(import.meta.url);
  return require.resolve("electron-builder/out/cli/cli.js");
}

export function resolveToolPackConfig(
  platform: ToolPackPlatform,
  options: ToolPackCliOptions = {},
): ToolPackConfig {
  const appVersion = resolveToolPackAppVersion(options.appVersion);
  const releaseChannel = resolveToolPackReleaseChannel(options.releaseChannel, appVersion, options.portable === true);
  const namespace = resolveNamespace({
    contract: OPENPIXO_SIDECAR_CONTRACT,
    env: process.env,
    namespace: options.namespace
      ?? (releaseChannel == null ? defaultNamespaceForAppVersion(platform, appVersion) : releaseNamespace(releaseChannel, platform)),
  });
  const defaultToolPackRoot = join(WORKSPACE_ROOT, ".tmp", "tools-pack");
  const toolPackRoot = resolve(options.dir ?? defaultToolPackRoot);
  const cacheRoot = resolve(options.cacheDir ?? join(defaultToolPackRoot, "cache"));
  const outputRoot = join(toolPackRoot, "out");
  const outputPlatformRoot = join(outputRoot, platform);
  const outputNamespaceRoot = join(outputPlatformRoot, "namespaces", namespace);
  const runtimeNamespaceBaseRoot = join(toolPackRoot, "runtime", platform, "namespaces");
  const cloud = resolveToolPackCloud(process.env, releaseChannel);

  return {
    appVersion,
    ...(cloud == null ? {} : { cloud }),
    containerized: options.containerized === true,
    electronBuilderCliPath: resolveElectronBuilderCliPath(),
    electronDistPath: resolveElectronDistPath(WORKSPACE_ROOT),
    electronVersion: resolveElectronVersion(WORKSPACE_ROOT),
    macCompression: resolveToolPackMacCompression(options.macCompression),
    macNotarize: options.notarize === true,
    namespace,
    platform,
    portable: options.portable === true,
    ...(releaseChannel == null ? {} : { releaseChannel }),
    roots: {
      output: {
        appBuilderRoot: join(outputNamespaceRoot, "builder"),
        namespaceRoot: outputNamespaceRoot,
        platformRoot: outputPlatformRoot,
        root: outputRoot,
      },
      runtime: {
        namespaceBaseRoot: runtimeNamespaceBaseRoot,
        namespaceRoot: join(runtimeNamespaceBaseRoot, namespace),
      },
      cacheRoot,
      toolPackRoot,
    },
    removeCache: options.removeCache === true,
    removeData: options.removeData === true,
    removeLogs: options.removeLogs === true,
    removeProductUserData: options.removeProductUserData === true,
    removeSidecars: options.removeSidecars === true,
    requireOpenCode: options.requireOpenCode === true,
    silent: options.silent !== false,
    signed: options.signed === true,
    
    // Do not bake upstream analytics configuration or sourcemap credentials into a fork.
    telemetryRelayUrl: undefined,
    updateMetadataUrl: resolveToolPackUpdateMetadataUrl(process.env.PIXO_UPDATE_METADATA_URL, releaseChannel),
    posthogKey: undefined,
    posthogHost: undefined,
    
    
    posthogCliApiKey: undefined,
    posthogCliProjectId: undefined,
    posthogCliHost: undefined,
    to: resolveToolPackBuildOutput(platform, options.to),
    webOutputMode: resolveToolPackWebOutputMode(platform, process.env.PIXO_WEB_OUTPUT_MODE),
    workspaceRoot: WORKSPACE_ROOT,
  };
}
