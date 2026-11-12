import { readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { OPENPIXO_DOWNLOADS_ORIGIN } from "@openpixo/release";

import { contentType, writeJson } from "../storage/common.ts";
import { verifyAuthenticode, type AuthenticodeVerifier } from "./authenticode.ts";
import { allowedUrl, compareVersions, listFiles, sha256File, validateRelease, validateUrls, type Channel } from "./common.ts";

/** Human-readable checksum list published next to every release. */
export const CHECKSUMS_FILE = "SHA256SUMS.txt";

export type ReleaseArtifact = {
  name: string;
  url: string;
  sha256: string;
  sha256Url: string;
  size: number;
  contentType: string;
};
export type WinReleasePlatform = {
  platform: "win";
  platformKey: "win";
  arch: "x64";
  channel: Channel;
  /** The desktop updater only considers enabled platforms. */
  enabled: true;
  /** Windows reported the installer's Authenticode chain as Valid when metadata was generated. */
  signed: boolean;
  signer?: string;
  artifacts: { installer: ReleaseArtifact; portableZip?: ReleaseArtifact; payload?: ReleaseArtifact };
};
/**
 * The minimum usable version. A running app below `min` must update before it can
 * be used. `message` maps a locale (`en`, `zh-CN`) to the reason shown to the user;
 * `url` is the manual download page offered when the update cannot be fetched.
 */
export type MinimumVersion = {
  min: string;
  message?: Record<string, string>;
  url?: string;
};
export type ReleaseMetadata = {
  version: 1;
  channel: Channel;
  releaseVersion: string;
  generatedAt: string;
  releaseState: "complete";
  control?: { app: { version: MinimumVersion } };
  platforms: { win: WinReleasePlatform };
};

const MINIMUM_VERSION_MESSAGE_MAX_LENGTH = 1000;

/**
 * Refuses a floor the release cannot clear: every app below it would be blocked
 * with no update able to unblock it.
 */
export function validateMinimumVersion(minimum: MinimumVersion, releaseVersion: string, channel: string): void {
  validateRelease(minimum.min, channel);
  if (compareVersions(minimum.min, releaseVersion) > 0) {
    throw new Error(`minimum version ${minimum.min} is above the release ${releaseVersion}: no update could satisfy it`);
  }
  for (const [locale, text] of Object.entries(minimum.message ?? {})) {
    if (typeof text !== "string" || text.trim().length === 0 || text.length > MINIMUM_VERSION_MESSAGE_MAX_LENGTH) {
      throw new Error(`minimum version message for ${locale} must be 1-${MINIMUM_VERSION_MESSAGE_MAX_LENGTH} characters`);
    }
  }
  if (minimum.url != null && new URL(minimum.url).protocol !== "https:") {
    throw new Error("minimum version url must use https");
  }
}

export type MetadataOptions = {
  artifactsDir: string;
  version: string;
  channel: string;
  /** Defaults to the OpenPixo downloads origin. */
  publicOrigin?: string;
  minimumVersion?: MinimumVersion;
  verifySignature?: AuthenticodeVerifier;
};

export async function generateMetadata(options: MetadataOptions): Promise<ReleaseMetadata> {
  const channel = validateRelease(options.version, options.channel);
  if (options.minimumVersion != null) validateMinimumVersion(options.minimumVersion, options.version, channel);
  const origin = allowedUrl(options.publicOrigin ?? OPENPIXO_DOWNLOADS_ORIGIN).href.replace(/\/+$/, "");
  const files = listFiles(options.artifactsDir).filter((file) => /\.(exe|zip|7z)$/i.test(file));
  if (files.some((file) => relative(options.artifactsDir, file) !== basename(file))) {
    throw new Error("use a flat artifact directory containing only the release artifacts");
  }
  const installerFiles = files.filter((file) => /\.exe$/i.test(file));
  const payloadFiles = files.filter((file) => /(?:\.7z|-payload\.zip)$/i.test(file));
  const zipFiles = files.filter((file) => /\.zip$/i.test(file) && !payloadFiles.includes(file));
  if (installerFiles.length !== 1 || payloadFiles.length > 1 || zipFiles.length > 1) {
    throw new Error("expected one Windows installer EXE, at most one portable ZIP and one payload archive");
  }
  const entries = new Map<string, ReleaseArtifact>();
  for (const file of files) {
    const name = basename(file);
    if (/[\r\n\\]/.test(name)) throw new Error(`unsafe artifact filename: ${name}`);
    const sha256 = await sha256File(file);
    const url = `${origin}/releases/${options.version}/${encodeURIComponent(name)}`;
    entries.set(file, { name, url, sha256, sha256Url: `${url}.sha256`, size: statSync(file).size, contentType: contentType(name) });
  }
  const signature = await (options.verifySignature ?? verifyAuthenticode)(installerFiles[0]);
  const metadata: ReleaseMetadata = {
    version: 1,
    channel,
    releaseVersion: options.version,
    generatedAt: new Date().toISOString(),
    releaseState: "complete",
    ...(options.minimumVersion == null ? {} : { control: { app: { version: options.minimumVersion } } }),
    platforms: { win: {
      platform: "win", platformKey: "win", arch: "x64", channel, enabled: true,
      signed: signature.signed, ...(signature.signer ? { signer: signature.signer } : {}),
      artifacts: {
        installer: entries.get(installerFiles[0])!,
        ...(zipFiles[0] ? { portableZip: entries.get(zipFiles[0])! } : {}),
        ...(payloadFiles[0] ? { payload: entries.get(payloadFiles[0])! } : {}),
      },
    } },
  };
  for (const entry of entries.values()) writeFileSync(join(options.artifactsDir, `${entry.name}.sha256`), `${entry.sha256}\n`);
  writeFileSync(join(options.artifactsDir, CHECKSUMS_FILE), checksumText([...entries.values()]));
  writeJson(join(options.artifactsDir, "metadata.json"), metadata);
  return metadata;
}

export function checksumText(artifacts: ReleaseArtifact[]): string {
  return artifacts.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    .map((artifact) => `${artifact.sha256}  ${artifact.name}\n`).join("");
}

export function parseMetadata(bytes: Buffer, version: string, channel: string): ReleaseMetadata {
  validateRelease(version, channel);
  const metadata = JSON.parse(bytes.toString("utf8")) as ReleaseMetadata;
  const win = metadata?.platforms?.win;
  if (metadata?.version !== 1 || metadata.channel !== channel || metadata.releaseVersion !== version
    || metadata.releaseState !== "complete" || !win?.artifacts?.installer
    || win.enabled !== true || win.channel !== channel || typeof win.signed !== "boolean") {
    throw new Error(`metadata must describe a complete ${channel} ${version} Windows release`);
  }
  if (metadata.control?.app?.version != null) validateMinimumVersion(metadata.control.app.version, version, channel);
  validateUrls(metadata);
  for (const artifact of Object.values(win.artifacts)) {
    if (typeof artifact.name !== "string" || !artifact.name || basename(artifact.name) !== artifact.name
      || /[\\\r\n]/.test(artifact.name) || !/^[a-f0-9]{64}$/.test(artifact.sha256)
      || !Number.isSafeInteger(artifact.size) || artifact.size < 0) {
      throw new Error("invalid release artifact");
    }
    const url = allowedUrl(artifact.url);
    if (!url.pathname.endsWith(`/releases/${version}/${encodeURIComponent(artifact.name)}`)
      || artifact.sha256Url !== `${artifact.url}.sha256`) throw new Error("artifact must reference its immutable release path and checksum");
  }
  return metadata;
}

export function readMetadata(dir: string, version: string, channel: string): ReleaseMetadata {
  return parseMetadata(readFileSync(join(dir, "metadata.json")), version, channel);
}

/** The public origin every artifact of this release is served from. */
export function releaseOrigin(metadata: ReleaseMetadata): string {
  const url = new URL(metadata.platforms.win.artifacts.installer.url);
  return `${url.origin}${url.pathname.slice(0, url.pathname.lastIndexOf(`/releases/${metadata.releaseVersion}/`))}`;
}
