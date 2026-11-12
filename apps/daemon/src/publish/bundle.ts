import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

/**
 * Early copies of the upload rules in specs/current/publish-and-rooms.md, for fast
 * errors only. The cloud enforces the real rules and owns the configured caps, so
 * a refusal the daemon lets through still comes back from the server.
 */
export const PUBLISH_ALLOWED_EXTENSIONS = new Set(['html', 'js', 'mjs', 'css', 'json', 'map', 'wasm', 'png', 'jpg', 'jpeg', 'gif', 'webp',
  'svg', 'avif', 'ico', 'mp3', 'ogg', 'wav', 'm4a', 'opus', 'webm', 'mp4', 'ttf', 'otf', 'woff', 'woff2', 'txt', 'xml', 'csv', 'atlas', 'fnt',
  'tmx', 'tsx', 'tmj', 'tsj', 'ldtk', 'bin', 'glb', 'gltf', 'ktx2', 'hdr']);
export const PUBLISH_PRECHECK_CAPS = { totalBytes: 200 * 1024 * 1024, fileBytes: 50 * 1024 * 1024, files: 2000, pathLength: 512 };

/** The game host answers these paths itself on every game's subdomain. */
const RESERVED_ROOTS = new Set(['__rooms', '__openpixo']);
const MAX_REFUSED_NAMED = 20;
const HASH_CONCURRENCY = 8;
const OUTPUT_DIRECTORIES = ['dist', 'build', 'out', 'www'];
/** A folder published as-is keeps its project files next to the game; those are not game content. */
const STATIC_ROOT_SKIPPED = /^(package(-lock)?\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|yarn\.lock|bun\.lockb?|tsconfig.*\.json|(vite|webpack|rollup|eslint|prettier)\.config\.[^/]+|.*\.md|licen[cs]e(\.txt)?|notice(\.txt)?)$/iu;

export interface BundleFile {
  path: string;
  size: number;
  sha256: string;
}

export interface PublishBundle {
  rootDir: string;
  files: BundleFile[];
  totalBytes: number;
}

/** A plain reason plus the paths to name. `code` is what the job reports. */
export class PublishBundleError extends Error {
  constructor(readonly code: 'PUBLISH_REFUSED' | 'PUBLISH_NO_OUTPUT', message: string, readonly refusedFiles?: string[]) { super(message); }
}

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

const isFile = (file: string) => stat(file).then(value => value.isFile(), () => false);

/** Reads the output folder a build config names. A config it cannot read just falls through to the usual names. */
async function configuredOutputDirectories(cwd: string): Promise<string[]> {
  const found: string[] = [];
  const entries = await readdir(cwd).catch(() => [] as string[]);
  for (const name of entries.filter(entry => /^(vite|webpack|rollup)\.config\.[cm]?[jt]s$/u.test(entry)).sort()) {
    const text = await readFile(path.join(cwd, name), 'utf8').catch(() => '');
    const quoted = /\boutDir\s*:\s*['"`]([^'"`]+)['"`]/u.exec(text)?.[1]
      ?? /\bpath\s*:\s*path\.(?:resolve|join)\(\s*__dirname\s*,\s*['"`]([^'"`]+)['"`]\s*\)/u.exec(text)?.[1]
      ?? /\bdir\s*:\s*['"`]([^'"`]+)['"`]/u.exec(text)?.[1];
    if (quoted) found.push(quoted);
  }
  try {
    const manifest = JSON.parse(await readFile(path.join(cwd, 'package.json'), 'utf8')) as { scripts?: Record<string, unknown> };
    const script = manifest.scripts?.build;
    const flag = typeof script === 'string' ? /--(?:out-?dir|dist-dir)[ =]['"]?([^\s'"]+)/u.exec(script)?.[1] : undefined;
    if (flag) found.push(flag);
  } catch { /* A static folder has no manifest. */ }
  return found;
}

export interface BuildOutput {
  rootDir: string;
  /** True when the project folder itself is the game and no build produced it. */
  staticRoot: boolean;
}

/** Picks the folder to upload. It must stay inside the project and hold a root index.html. */
export async function findBuildOutput(projectDir: string, cwd: string, hasBuildCommand: boolean): Promise<BuildOutput> {
  const root = await realpath(projectDir);
  const base = await realpath(path.resolve(root, cwd));
  const candidates = [...new Set([...await configuredOutputDirectories(base), ...OUTPUT_DIRECTORIES])];
  for (const candidate of candidates) {
    const target = path.resolve(base, candidate);
    const real = await realpath(target).catch(() => null);
    if (!real || !inside(root, real)) continue;
    if (await isFile(path.join(real, 'index.html'))) return { rootDir: real, staticRoot: false };
  }
  if (!hasBuildCommand && await isFile(path.join(base, 'index.html'))) return { rootDir: base, staticRoot: true };
  throw new PublishBundleError('PUBLISH_NO_OUTPUT', hasBuildCommand
    ? `The build finished, but no folder with an index.html was found (looked in ${candidates.join(', ')}).`
    : 'No build output with an index.html was found. Add a build script, or put index.html in the game folder.');
}

interface WalkedFile { relative: string; absolute: string; size: number }

interface Refusal { path: string; reason: string }

/** Lists what would be uploaded. Dot segments are private by convention and are never sent. */
async function walk(rootDir: string, staticRoot: boolean, refusals: Refusal[]): Promise<WalkedFile[]> {
  const files: WalkedFile[] = [];
  const pending = [''];
  while (pending.length) {
    const directory = pending.pop()!;
    const entries = await readdir(path.join(rootDir, directory), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.')) continue;
      const relative = directory ? `${directory}/${entry.name}` : entry.name;
      if (staticRoot && !directory && (entry.name === 'node_modules' || STATIC_ROOT_SKIPPED.test(entry.name))) continue;
      const absolute = path.join(rootDir, relative);
      if (entry.isSymbolicLink()) {
        const real = await realpath(absolute).catch(() => null);
        const target = real ? await stat(real).catch(() => null) : null;
        // A link that leaves the folder would publish files the creator never built.
        if (!real || !target || !inside(rootDir, real) || !target.isFile()) { refusals.push({ path: relative, reason: 'a link to something outside the build' }); continue; }
        files.push({ relative, absolute: real, size: target.size });
      } else if (entry.isDirectory()) {
        pending.push(relative);
      } else if (entry.isFile()) {
        files.push({ relative, absolute, size: (await lstat(absolute)).size });
      }
      if (files.length > PUBLISH_PRECHECK_CAPS.files) {
        throw new PublishBundleError('PUBLISH_REFUSED', `This build has more than ${PUBLISH_PRECHECK_CAPS.files} files, which is over the limit for a public link.`);
      }
    }
  }
  return files.sort((a, b) => (a.relative < b.relative ? -1 : a.relative > b.relative ? 1 : 0));
}

export function publishPathProblem(relative: string): string | null {
  if (relative.length > PUBLISH_PRECHECK_CAPS.pathLength) return 'a file name that is too long';
  if (relative.includes('\\') || /[\x00-\x1f\x7f]/u.test(relative)) return "a file name that can't be used";
  if (relative.startsWith('/') || relative.split('/').some(segment => !segment || segment === '.' || segment === '..' || segment.startsWith('.'))) return "a file name that can't be used";
  if (RESERVED_ROOTS.has(relative.split('/')[0]!)) return 'a folder name OpenPixo reserves';
  const name = relative.slice(relative.lastIndexOf('/') + 1);
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
  return PUBLISH_ALLOWED_EXTENSIONS.has(extension) ? null : 'file type not allowed';
}

/** Password prompts on an anonymous game link are how phishing pages are hosted, so the server refuses them too. */
export function htmlHasPasswordInput(html: string): boolean {
  return /<input\b[^>]*\btype\s*=\s*(?:["']\s*password\s*["']|password\b)/iu.test(html);
}

function hashFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file).on('error', reject).on('data', chunk => hash.update(chunk)).on('end', () => resolve(hash.digest('hex')));
  });
}

function refuse(refusals: Refusal[]): PublishBundleError {
  const named = refusals.slice(0, MAX_REFUSED_NAMED);
  const reasons = [...new Set(refusals.map(item => item.reason))].join('; ');
  const count = refusals.length === 1 ? '1 file' : `${refusals.length} files`;
  return new PublishBundleError('PUBLISH_REFUSED', `${count} in this build can't go on a public link (${reasons}).`, named.map(item => item.path));
}

/** Walks, checks and hashes one build folder. Nothing leaves the machine here. */
export async function collectBundle({ rootDir, staticRoot }: BuildOutput): Promise<PublishBundle> {
  const refusals: Refusal[] = [];
  const walked = await walk(rootDir, staticRoot, refusals);
  if (!walked.some(file => file.relative === 'index.html')) {
    throw new PublishBundleError('PUBLISH_NO_OUTPUT', 'The build folder has no index.html at its root.');
  }
  let totalBytes = 0;
  for (const file of walked) {
    totalBytes += file.size;
    const problem = publishPathProblem(file.relative);
    if (problem) refusals.push({ path: file.relative, reason: problem });
    else if (file.size > PUBLISH_PRECHECK_CAPS.fileBytes) refusals.push({ path: file.relative, reason: `larger than ${PUBLISH_PRECHECK_CAPS.fileBytes / (1024 * 1024)} MB` });
    else if (/\.html$/iu.test(file.relative) && htmlHasPasswordInput(await readFile(file.absolute, 'utf8'))) {
      refusals.push({ path: file.relative, reason: 'a page with a password box' });
    }
  }
  if (refusals.length) throw refuse(refusals);
  if (totalBytes > PUBLISH_PRECHECK_CAPS.totalBytes) {
    throw new PublishBundleError('PUBLISH_REFUSED', `This build is ${Math.ceil(totalBytes / (1024 * 1024))} MB; a public link holds at most ${PUBLISH_PRECHECK_CAPS.totalBytes / (1024 * 1024)} MB.`);
  }
  const files: BundleFile[] = new Array(walked.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(HASH_CONCURRENCY, walked.length) }, async () => {
    while (next < walked.length) {
      const index = next++;
      const file = walked[index]!;
      files[index] = { path: file.relative, size: file.size, sha256: await hashFile(file.absolute) };
    }
  }));
  return { rootDir, files, totalBytes };
}
