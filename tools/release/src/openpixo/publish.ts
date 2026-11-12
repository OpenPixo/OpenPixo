import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { OPENPIXO_DOWNLOADS_ORIGIN } from "@openpixo/release";

import { contentType, storageConfigFromEnv } from "../storage/common.ts";
import { getStorageObject, putStorageObject, putStorageObjectWithStatus, type StorageConfig } from "../storage/s3-upload.ts";
import { verifyAuthenticode, type AuthenticodeVerifier } from "./authenticode.ts";
import { allowedUrl, compareVersions, sha256File, validateRelease } from "./common.ts";
import { CHECKSUMS_FILE, checksumText, parseMetadata, readMetadata, releaseOrigin, validateMinimumVersion, type MinimumVersion, type ReleaseMetadata } from "./metadata.ts";

const IMMUTABLE = "public, max-age=31536000, immutable";
const LATEST = "public, max-age=60, must-revalidate";
type ReleaseOptions = {
  artifactsDir: string;
  version: string;
  channel: string;
  /** Print the plan and public URLs without touching storage. The CLI defaults to this. */
  dryRun?: boolean;
  /** Publish an installer that is not Authenticode-signed. Recorded as `signed: false` and warned about. */
  allowUnsigned?: boolean;
  verifySignature?: AuthenticodeVerifier;
};
export type Upload = { objectKey: string; bodyPath: string; cacheControl: string };
export type PublicUrls = { installer: string; checksums: string; metadata: string; feed: string };

function storageFromEnv(): StorageConfig {
  const storage = storageConfigFromEnv();
  allowedUrl(storage.endpointUrl);
  return storage;
}

export async function planPublish(options: ReleaseOptions): Promise<Upload[]> {
  const metadata = readMetadata(options.artifactsDir, options.version, options.channel);
  const artifacts = Object.values(metadata.platforms.win.artifacts);
  for (const artifact of artifacts) {
    const path = join(options.artifactsDir, artifact.name);
    if (statSync(path).size !== artifact.size || await sha256File(path) !== artifact.sha256
      || readFileSync(`${path}.sha256`, "utf8") !== `${artifact.sha256}\n`) {
      throw new Error(`artifact changed after metadata generation: ${artifact.name}`);
    }
  }
  if (readFileSync(join(options.artifactsDir, CHECKSUMS_FILE), "utf8") !== checksumText(artifacts)) {
    throw new Error(`${CHECKSUMS_FILE} does not match metadata`);
  }
  const names = artifacts.flatMap((artifact) => [artifact.name, `${artifact.name}.sha256`]);
  names.push(CHECKSUMS_FILE, "metadata.json");
  return [
    ...names.map((name) => ({ objectKey: `releases/${options.version}/${name}`, bodyPath: join(options.artifactsDir, name), cacheControl: IMMUTABLE })),
    { objectKey: `updates/${options.channel}/latest/metadata.json`, bodyPath: join(options.artifactsDir, "metadata.json"), cacheControl: LATEST },
  ];
}

export function publicUrls(metadata: ReleaseMetadata): PublicUrls {
  const origin = releaseOrigin(metadata);
  const release = `${origin}/releases/${metadata.releaseVersion}`;
  return {
    installer: metadata.platforms.win.artifacts.installer.url,
    checksums: `${release}/${CHECKSUMS_FILE}`,
    metadata: `${release}/metadata.json`,
    feed: `${origin}/updates/${metadata.channel}/latest/metadata.json`,
  };
}

/**
 * A public release is Authenticode-signed unless the publisher explicitly
 * allows an unsigned one. The installer on disk is re-verified at publish time
 * (not trusted from metadata), and metadata must record that same result, so
 * the feed and download page never claim a signature the bytes lack.
 */
async function releaseSignature(options: ReleaseOptions, metadata: ReleaseMetadata): Promise<string | null> {
  const installer = join(options.artifactsDir, metadata.platforms.win.artifacts.installer.name);
  const signature = await (options.verifySignature ?? verifyAuthenticode)(installer);
  if (signature.signed !== metadata.platforms.win.signed) {
    throw new Error(`metadata records signed: ${metadata.platforms.win.signed} but the installer is ${signature.status}; regenerate metadata`);
  }
  return signature.signed ? null : `installer Authenticode status is ${signature.status}`;
}

export async function publishRelease(options: ReleaseOptions): Promise<Upload[]> {
  const plan = await planPublish(options);
  const metadata = readMetadata(options.artifactsDir, options.version, options.channel);
  const urls = publicUrls(metadata);
  const unsignedReason = await releaseSignature(options, metadata);
  const prefix = options.dryRun ? "[dry-run] " : "";
  if (releaseOrigin(metadata) !== OPENPIXO_DOWNLOADS_ORIGIN) {
    console.log(`${prefix}note: release builds read ${OPENPIXO_DOWNLOADS_ORIGIN}; this release is served from ${releaseOrigin(metadata)}`);
  }
  if (options.dryRun) {
    for (const upload of plan) console.log(`[dry-run] PUT ${upload.objectKey} <- ${upload.bodyPath}`);
    printUrls(urls, prefix);
    console.log(unsignedReason == null
      ? "[dry-run] signature: Valid. Re-run with --execute to upload."
      : options.allowUnsigned
      ? `[dry-run] WARNING: ${unsignedReason}; --execute --allow-unsigned would publish an UNSIGNED release`
      : `[dry-run] --execute would be refused: ${unsignedReason} (--allow-unsigned publishes it anyway)`);
    return plan;
  }
  if (unsignedReason != null) {
    if (!options.allowUnsigned) throw new Error(`refusing to publish an unsigned build as a release: ${unsignedReason}`);
    console.warn(`WARNING: publishing an UNSIGNED release (${unsignedReason}). Windows will show "Unknown publisher"; metadata records signed: false.`);
  }
  const storage = storageFromEnv();
  for (const upload of plan) {
    const body = readFileSync(upload.bodyPath);
    const request = { ...storage, body, objectKey: upload.objectKey, cacheControl: upload.cacheControl, contentType: contentType(upload.bodyPath) };
    if (upload.cacheControl === IMMUTABLE) {
      const result = await putStorageObjectWithStatus({ ...request, headers: { "if-none-match": "*" } });
      if (!result.ok) {
        const existing = result.status === 412 ? await getStorageObject({ ...storage, objectKey: upload.objectKey }) : null;
        if (!existing?.bytes.equals(body)) throw new Error(`immutable upload failed (${result.status}): ${upload.objectKey}`);
      }
    } else {
      await putStorageObject(request);
    }
    console.log(`published ${upload.objectKey}`);
  }
  printUrls(urls, prefix);
  return plan;
}

function printUrls(urls: PublicUrls, prefix: string): void {
  console.log(`${prefix}installer: ${urls.installer}`);
  console.log(`${prefix}checksums: ${urls.checksums}`);
  console.log(`${prefix}metadata:  ${urls.metadata}`);
  console.log(`${prefix}feed:      ${urls.feed}`);
}

/**
 * Raises or clears the minimum usable version on the live feed without a new
 * build, for a problem found after the fixed release already went out. Only the
 * mutable feed changes; the release's own immutable metadata keeps what it shipped
 * with, so a later rollback to that release also drops this floor.
 */
export async function setMinimumVersion(options: {
  channel: string;
  /** null clears the floor. */
  minimumVersion: MinimumVersion | null;
  dryRun?: boolean;
}): Promise<void> {
  const storage = storageFromEnv();
  const objectKey = `updates/${options.channel}/latest/metadata.json`;
  const current = await getStorageObject({ ...storage, objectKey });
  if (!current) throw new Error(`missing current metadata: ${objectKey}`);
  const currentVersion = (JSON.parse(current.text) as { releaseVersion: string }).releaseVersion;
  const metadata = parseMetadata(current.bytes, currentVersion, options.channel);
  if (options.minimumVersion != null) validateMinimumVersion(options.minimumVersion, currentVersion, options.channel);
  const { control: _previous, ...rest } = metadata;
  const next: ReleaseMetadata = {
    ...rest,
    ...(options.minimumVersion == null ? {} : { control: { app: { version: options.minimumVersion } } }),
  };
  const description = options.minimumVersion == null ? "cleared" : options.minimumVersion.min;
  if (options.dryRun) {
    console.log(`[dry-run] PUT ${objectKey}: minimum version ${description} (latest release ${currentVersion})`);
    return;
  }
  if (!current.etag) throw new Error("latest metadata has no ETag; cannot safely replace the pointer");
  await putStorageObject({
    ...storage,
    objectKey,
    body: Buffer.from(`${JSON.stringify(next, null, 2)}\n`),
    contentType: contentType(objectKey),
    cacheControl: LATEST,
    headers: { "if-match": current.etag },
  });
  console.log(`${objectKey}: minimum version ${description} (latest release ${currentVersion})`);
}

export async function rollbackRelease(options: { version: string; channel: string; dryRun?: boolean }): Promise<void> {
  validateRelease(options.version, options.channel);
  const storage = storageFromEnv();
  const objectKey = `updates/${options.channel}/latest/metadata.json`;
  const current = await getStorageObject({ ...storage, objectKey });
  if (!current) throw new Error(`missing current metadata: ${objectKey}`);
  const currentVersion = (JSON.parse(current.text) as { releaseVersion: string }).releaseVersion;
  parseMetadata(current.bytes, currentVersion, options.channel);
  if (compareVersions(options.version, currentVersion) >= 0) throw new Error("rollback version must be earlier than latest");
  const sourceKey = `releases/${options.version}/metadata.json`;
  const source = await getStorageObject({ ...storage, objectKey: sourceKey });
  if (!source) throw new Error(`missing published metadata: ${sourceKey}`);
  parseMetadata(source.bytes, options.version, options.channel);
  if (options.dryRun) {
    console.log(`[dry-run] PUT ${objectKey} <- ${sourceKey} (${currentVersion} -> ${options.version})`);
    return;
  }
  if (!current.etag) throw new Error("latest metadata has no ETag; cannot safely replace the pointer");
  await putStorageObject({ ...storage, objectKey, body: source.bytes, contentType: contentType(objectKey), cacheControl: LATEST, headers: { "if-match": current.etag } });
  console.log(`rolled back ${objectKey}: ${currentVersion} -> ${options.version}`);
}
