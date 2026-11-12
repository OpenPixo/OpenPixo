import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { cp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Games made in OpenPixo (Phaser, three.js, plain web) need `node` and `npm`
 * to install dependencies and start their dev server, and many users have
 * never installed Node. The Windows build therefore carries the official
 * Node.js LTS distribution as a separate tool for games and agent shells.
 *
 * It is deliberately not the daemon's runtime: the daemon keeps running on
 * Electron's Node, whose ABI the native modules are built for.
 */
export const BUNDLED_NODE_TREE_ENV = 'PIXO_BUNDLED_NODE_DIR';
/** Where the tree lives under the packaged resource root. The packaged launcher reads the same path. */
export const BUNDLED_NODE_RESOURCE_PATH = ['bin', 'libexec', 'node'] as const;

/** Pinned official build. The checksum is from https://nodejs.org/dist/v24.22.1/SHASUMS256.txt. */
export const BUNDLED_NODE_RELEASE = {
  version: '24.22.1',
  target: 'win-x64',
  sha256: 'd2046d28c2c3dcd211ac5145c0bf30e2047ef9dfb306693c8c6e2eccd8b95fa5',
} as const;

/** What the games need: node, npm and npx, plus Node's license. Corepack and installer helpers stay out. */
export const BUNDLED_NODE_ENTRIES = [
  'node.exe', 'npm', 'npm.cmd', 'npm.ps1', 'npx', 'npx.cmd', 'npx.ps1', 'LICENSE', join('node_modules', 'npm'),
] as const;

export type BundledNodeDistribution = {
  /** Directory holding node.exe and node_modules/npm. */
  source: string;
  version: string | null;
  sha256: string | null;
};

type ResolveOptions = {
  cacheRoot: string;
  sevenZipExe: string;
  env?: NodeJS.ProcessEnv;
  fetchArchive?: (url: string) => Promise<Buffer>;
};

function archiveName(): string {
  return `node-v${BUNDLED_NODE_RELEASE.version}-${BUNDLED_NODE_RELEASE.target}`;
}

export function bundledNodeArchiveUrl(): string {
  return `https://nodejs.org/dist/v${BUNDLED_NODE_RELEASE.version}/${archiveName()}.zip`;
}

async function isFile(file: string): Promise<boolean> {
  return stat(file).then(entry => entry.isFile(), () => false);
}

async function defaultFetchArchive(url: string): Promise<Buffer> {
  let response: Response;
  try { response = await fetch(url); } catch (error) {
    throw new Error(`Could not download ${url}. Behind a proxy, set NODE_USE_ENV_PROXY=1, `
      + `or extract the archive yourself and set ${BUNDLED_NODE_TREE_ENV}.`, { cause: error });
  }
  if (!response.ok) throw new Error(`Downloading ${url} failed with HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/**
 * The extracted official distribution, downloaded once into the tools-pack
 * cache and checked against the pinned sha256 before it is extracted.
 */
export async function resolveBundledNodeDistribution({
  cacheRoot, sevenZipExe, env = process.env, fetchArchive = defaultFetchArchive,
}: ResolveOptions): Promise<BundledNodeDistribution> {
  const override = env[BUNDLED_NODE_TREE_ENV]?.trim();
  if (override) {
    if (!await isFile(join(override, 'node.exe'))) throw new Error(`${BUNDLED_NODE_TREE_ENV} has no node.exe: ${override}`);
    return { source: override, version: null, sha256: null };
  }
  if (!cacheRoot) throw new Error(`No tools-pack cache root to download Node.js into; set ${BUNDLED_NODE_TREE_ENV}`);
  const root = join(cacheRoot, 'bundled-node');
  const source = join(root, archiveName());
  const marker = join(source, '.openpixo-verified');
  if (await readFile(marker, 'utf8').then(value => value.trim() === BUNDLED_NODE_RELEASE.sha256, () => false)) {
    return { source, version: BUNDLED_NODE_RELEASE.version, sha256: BUNDLED_NODE_RELEASE.sha256 };
  }
  await mkdir(root, { recursive: true });
  const archive = join(root, `${archiveName()}.zip`);
  const cached: Buffer | null = await readFile(archive).catch(() => null);
  if (!cached || sha256(cached) !== BUNDLED_NODE_RELEASE.sha256) {
    const downloaded = await fetchArchive(bundledNodeArchiveUrl());
    const actual = sha256(downloaded);
    if (actual !== BUNDLED_NODE_RELEASE.sha256) {
      throw new Error(`Node.js archive checksum mismatch: expected ${BUNDLED_NODE_RELEASE.sha256}, got ${actual}`);
    }
    await writeFile(`${archive}.partial`, downloaded);
    await rename(`${archive}.partial`, archive);
  }
  const staging = join(root, `${archiveName()}.extracting`);
  await rm(staging, { recursive: true, force: true });
  await rm(source, { recursive: true, force: true });
  await execFileAsync(sevenZipExe, ['x', archive, `-o${staging}`, '-y'], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  await rename(join(staging, archiveName()), source);
  await rm(staging, { recursive: true, force: true });
  if (!await isFile(join(source, 'node.exe'))) throw new Error(`Extracted Node.js has no node.exe: ${source}`);
  await writeFile(marker, `${BUNDLED_NODE_RELEASE.sha256}\n`);
  return { source, version: BUNDLED_NODE_RELEASE.version, sha256: BUNDLED_NODE_RELEASE.sha256 };
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Copy the selected entries into `<resourceRoot>/bin/libexec/node`. */
export async function copyBundledNodeTree(distribution: BundledNodeDistribution, resourceRoot: string): Promise<void> {
  const target = join(resourceRoot, ...BUNDLED_NODE_RESOURCE_PATH);
  await mkdir(target, { recursive: true });
  for (const entry of BUNDLED_NODE_ENTRIES) {
    const from = join(distribution.source, entry);
    const exists = await stat(from).then(() => true, () => false);
    if (!exists) {
      if (entry === 'node.exe' || entry === 'npm.cmd' || entry === join('node_modules', 'npm')) {
        throw new Error(`Bundled Node.js is missing ${entry}: ${distribution.source}`);
      }
      continue;
    }
    await cp(from, join(target, entry), { recursive: true });
  }
}
