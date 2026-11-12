import { existsSync, readFileSync } from "node:fs";

import { writeJson } from "../storage/common.ts";
import { parseSiteManifest, type Release } from "../site/data.ts";
import { compareVersions } from "./common.ts";
import { readMetadata, releaseOrigin, type ReleaseMetadata } from "./metadata.ts";

/** The website repository's path of the one manifest its download pages are generated from. */
export const SITE_RELEASE_MANIFEST = "data/release.json";

/** `current: null` means no public build; the pages then say so. */
export type SiteReleaseManifest = { current: Release | null; history: Release[] };

export const EMPTY_SITE_MANIFEST: SiteReleaseManifest = { current: null, history: [] };

/** The site lists only the installer; payloads and archives exist for the updater. */
export function siteRelease(metadata: ReleaseMetadata): Release {
  const installer = metadata.platforms.win.artifacts.installer;
  return {
    version: metadata.releaseVersion,
    date: metadata.generatedAt.slice(0, 10),
    downloadBaseUrl: `${releaseOrigin(metadata)}/releases/${metadata.releaseVersion}`,
    artifacts: [{ fileName: installer.name, size: installer.size, sha256: installer.sha256 }],
    signed: metadata.platforms.win.signed,
  };
}

export function readSiteManifest(path: string): SiteReleaseManifest {
  if (!existsSync(path)) return EMPTY_SITE_MANIFEST;
  const parsed = parseSiteManifest(JSON.parse(readFileSync(path, "utf8")));
  return { current: parsed.current, history: parsed.history };
}

/**
 * Promotes a published stable release to the site's current download and moves
 * the previous one into history. An unsigned release is listed only when
 * explicitly allowed, and the page then labels it unsigned.
 */
export function promoteSiteRelease(
  manifest: SiteReleaseManifest,
  metadata: ReleaseMetadata,
  options: { allowUnsigned?: boolean } = {},
): SiteReleaseManifest {
  if (metadata.channel !== "stable") throw new Error("the download page lists stable releases only");
  if (!metadata.platforms.win.signed && !options.allowUnsigned) {
    throw new Error("refusing to list an unsigned build on the download page (--allow-unsigned lists it, labelled unsigned)");
  }
  const release = siteRelease(metadata);
  if (manifest.current != null && compareVersions(release.version, manifest.current.version) <= 0) {
    throw new Error(`site already lists ${manifest.current.version}; promote a newer release`);
  }
  return {
    current: release,
    history: manifest.current == null ? manifest.history : [manifest.current, ...manifest.history],
  };
}

export function updateSiteManifest(options: {
  artifactsDir: string; version: string; channel: string; manifestPath: string; allowUnsigned?: boolean;
}): SiteReleaseManifest {
  const metadata = readMetadata(options.artifactsDir, options.version, options.channel);
  const next = promoteSiteRelease(readSiteManifest(options.manifestPath), metadata, { allowUnsigned: options.allowUnsigned });
  writeJson(options.manifestPath, next);
  return next;
}
