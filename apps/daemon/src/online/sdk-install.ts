/**
 * Puts the online SDK in a web game, the same way `pixo rooms add` installs the rooms SDK
 * (rooms/sdk-install.ts): one file with a content-hash marker, updated only while unedited.
 */
import { createHash, randomBytes } from 'node:crypto';
import nodeModule from 'node:module';
import { lstat, mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { OnlineInstallResponse } from '@openpixo/contracts';

export const ONLINE_SDK_RELATIVE_PATH = path.join('openpixo-online', 'openpixo-online.ts');
const SDK_NAME = 'openpixo-online';
const MARKER = /^\/\/ openpixo-online-sdk sha256=([0-9a-f]{64})\n/mu;
/** Folders a plain game keeps its scripts in, most likely first; otherwise the game's own folder. */
const SOURCE_DIRECTORIES = ['src', 'js', 'scripts'];

export class OnlineSdkEditedError extends Error {
  constructor(sdkPath: string) {
    super(`${sdkPath} was changed by hand, so it was left alone. Rename or delete it and run the command again to get the latest online SDK.`);
  }
}

const normalized = (text: string) => text.replace(/\r\n/gu, '\n');
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const exists = (file: string) => stat(file).then(() => true, () => false);

function stripTypes(source: string): string {
  const strip = (nodeModule as unknown as { stripTypeScriptTypes?: (code: string, options?: { mode?: 'strip' }) => string }).stripTypeScriptTypes;
  if (!strip) throw new Error('This version of Node cannot convert the online SDK to JavaScript. Add a tsconfig.json to the game, or update OpenPixo.');
  return strip(source, { mode: 'strip' });
}

/** The exact file for this language. The first lines say where it came from and record its content hash. */
export function renderOnlineSdk(source: string, language: 'ts' | 'js'): string {
  const text = normalized(source);
  const body = language === 'js' ? stripTypes(text) : text;
  return `// OpenPixo online SDK. Added by "pixo online add", which keeps it up to date; editing it stops updates.\n// openpixo-online-sdk sha256=${hash(body)}\n${body}`;
}

/** False when the file was changed after it was written, or was never ours. */
function isUnedited(contents: string): boolean {
  const text = normalized(contents);
  const marker = MARKER.exec(text);
  return Boolean(marker && hash(text.slice(marker.index + marker[0].length)) === marker[1]);
}

async function usesTypeScript(cwd: string): Promise<boolean> {
  if (await exists(path.join(cwd, 'tsconfig.json'))) return true;
  try {
    const manifest = JSON.parse(await readFile(path.join(cwd, 'package.json'), 'utf8')) as { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> };
    return Boolean(manifest.dependencies?.typescript ?? manifest.devDependencies?.typescript);
  } catch { return false; }
}

const candidates = (cwd: string) => [...SOURCE_DIRECTORIES, '.'].flatMap(directory =>
  ['ts', 'js'].map(extension => path.join(cwd, directory, `${SDK_NAME}.${extension}`)));

function projectRelative(projectDir: string, file: string): string {
  return path.relative(projectDir, file).split(path.sep).join('/');
}

/** Where the SDK already is, relative to the project root. */
export async function findInstalledOnlineSdk(projectDir: string, cwd: string): Promise<string | null> {
  const base = path.resolve(projectDir, cwd);
  for (const file of candidates(base)) if (await exists(file)) return projectRelative(projectDir, file);
  return null;
}

async function destination(cwd: string, language: 'ts' | 'js'): Promise<string> {
  for (const directory of SOURCE_DIRECTORIES) {
    const isDirectory = await stat(path.join(cwd, directory)).then(value => value.isDirectory(), () => false);
    if (isDirectory) return path.join(cwd, directory, `${SDK_NAME}.${language}`);
  }
  return path.join(cwd, `${SDK_NAME}.${language}`);
}

/**
 * Same version: a no-op. Older unedited copy: updated. Anything changed by hand: refused
 * with a message, never overwritten.
 */
export async function installOnlineSdk(input: { sdkDir: string; projectDir: string; cwd: string }): Promise<OnlineInstallResponse> {
  const projectDir = await realpath(input.projectDir);
  const cwd = await realpath(path.resolve(projectDir, input.cwd));
  const relativeCwd = path.relative(projectDir, cwd);
  if (relativeCwd === '..' || relativeCwd.startsWith(`..${path.sep}`) || path.isAbsolute(relativeCwd)) throw new Error('The game folder is outside the project.');
  const source = await readFile(path.join(input.sdkDir, ONLINE_SDK_RELATIVE_PATH), 'utf8');
  const existing = await findInstalledOnlineSdk(projectDir, cwd);
  const language = existing ? (existing.endsWith('.js') ? 'js' : 'ts') : await usesTypeScript(cwd) ? 'ts' : 'js';
  const target = existing ? path.join(projectDir, ...existing.split('/')) : await destination(cwd, language);
  const rendered = renderOnlineSdk(source, language);
  const sdkPath = projectRelative(projectDir, target);
  if (existing) {
    // A link could redirect the write outside the project.
    if ((await lstat(target)).isSymbolicLink()) throw new OnlineSdkEditedError(sdkPath);
    const current = await readFile(target, 'utf8');
    if (normalized(current) === rendered) return { sdkPath, changed: false };
    if (!isUnedited(current)) throw new OnlineSdkEditedError(sdkPath);
  }
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeFile(temporary, rendered, 'utf8');
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return { sdkPath, changed: true };
}
