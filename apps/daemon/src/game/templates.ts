import { initializeProjectGit, runProjectGit, type ProjectGitRunner } from '../projects/git.js';
import { execFile } from 'node:child_process';
import { cp, mkdir, readFile, readdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  GAME_ENGINE_IDS,
  gameFolderNameProblem,
  type CreateGameFromTemplateRequest,
  type GameTemplateSummary,
  type GameCreationReasonCode,
  type GameTemplateGitResult,
} from '@openpixo/contracts';

const TEMPLATE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const exec = promisify(execFile);
/** Cover candidates in preference order; they sit beside `files/`, so projects never copy them. */
const COVER_FILES = [['cover.webp', 'image/webp'], ['cover.png', 'image/png']] as const;

export interface GameTemplateCover { file: string; contentType: string }

/**
 * The catalog cover of one template directory, or null. Only a template id
 * that passes the listing's id rule can name a directory, so the id never
 * reaches the filesystem as a path fragment.
 */
export async function resolveGameTemplateCover(templatesRoot: string, id: string): Promise<GameTemplateCover | null> {
  if (!TEMPLATE_ID.test(id)) return null;
  for (const [name, contentType] of COVER_FILES) {
    const file = path.join(templatesRoot, id, name);
    try {
      if ((await stat(file)).isFile()) return { file, contentType };
    } catch { /* try the next candidate */ }
  }
  return null;
}

export class GameTemplateError extends Error {
  constructor(readonly reasonCode: GameCreationReasonCode, message: string) { super(message); }
}

export function gameTemplateErrorCode(error: unknown): GameCreationReasonCode {
  return error instanceof GameTemplateError ? error.reasonCode : 'CREATE_FAILED';
}

/** Windows Known Folder resolution includes OneDrive and redirected Documents. */
export async function defaultGameParentDir(): Promise<string> {
  let documents = path.join(homedir(), 'Documents');
  if (process.platform === 'win32') {
    try {
      const result = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; [Environment]::GetFolderPath([Environment+SpecialFolder]::MyDocuments)'],
      { windowsHide: true, timeout: 5000, encoding: 'utf8' });
      const resolved = result.stdout.trim();
      if (path.isAbsolute(resolved)) documents = resolved;
    } catch { /* The daemon also works without a desktop host or PowerShell. */ }
  }
  return path.join(documents, 'OpenPixo Games');
}

export async function listGameTemplates(templatesRoot: string): Promise<GameTemplateSummary[]> {
  const entries = await readdir(templatesRoot, { withFileTypes: true });
  const templates: GameTemplateSummary[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || !TEMPLATE_ID.test(entry.name)) continue;
    const manifest = JSON.parse(await readFile(path.join(templatesRoot, entry.name, 'template.json'), 'utf8')) as GameTemplateSummary;
    if (manifest.id !== entry.name || !GAME_ENGINE_IDS.includes(manifest.engine) ||
        typeof manifest.name !== 'string' || !manifest.name.trim() ||
        typeof manifest.description !== 'string' || !manifest.description.trim() ||
        (manifest.nameZhCN !== undefined && (typeof manifest.nameZhCN !== 'string' || !manifest.nameZhCN.trim())) ||
        (manifest.descriptionZhCN !== undefined && (typeof manifest.descriptionZhCN !== 'string' || !manifest.descriptionZhCN.trim())) ||
        !(await stat(path.join(templatesRoot, entry.name, 'files'))).isDirectory()) {
      throw new Error(`Invalid game template: ${entry.name}`);
    }
    templates.push({
      id: manifest.id, name: manifest.name, engine: manifest.engine, description: manifest.description,
      ...(manifest.nameZhCN !== undefined ? { nameZhCN: manifest.nameZhCN } : {}),
      ...(manifest.descriptionZhCN !== undefined ? { descriptionZhCN: manifest.descriptionZhCN } : {}),
      ...(await resolveGameTemplateCover(templatesRoot, manifest.id) ? { coverUrl: `/api/game-templates/${manifest.id}/cover` } : {}),
    });
  }
  return templates;
}

/** Resolve the chosen parent once; a project name can only name one child. */
export async function resolveGameTemplateTarget(parentDir: string, name: string, allowMissingParent = false): Promise<string> {
  if (gameFolderNameProblem(name)) {
    throw new GameTemplateError('INVALID_NAME', 'name must be a valid folder name without path separators or ..');
  }
  return path.join(await resolveGameTemplateParent(parentDir, allowMissingParent), name);
}

/** Canonical parent directory; throws the reason a path cannot hold a new game. */
export async function resolveGameTemplateParent(parentDir: string, allowMissing = false): Promise<string> {
  if (typeof parentDir !== 'string' || !path.isAbsolute(parentDir)) {
    throw new GameTemplateError('PARENT_NOT_ABSOLUTE', 'parentDir must be absolute');
  }
  let parent: string;
  try {
    parent = await realpath(parentDir);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      if (allowMissing) {
        const ancestor = path.dirname(parentDir);
        if (ancestor !== parentDir) return path.join(await resolveGameTemplateParent(ancestor, true), path.basename(parentDir));
      }
      throw new GameTemplateError('PARENT_NOT_FOUND', 'parentDir not found');
    }
    if (code === 'ENOTDIR') throw new GameTemplateError('PARENT_NOT_DIRECTORY', 'parentDir must be a directory');
    throw new GameTemplateError('PARENT_UNREADABLE', `Cannot access parentDir (${code ?? 'unknown'}): ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!(await stat(parent)).isDirectory()) throw new GameTemplateError('PARENT_NOT_DIRECTORY', 'parentDir must be a directory');
  return parent;
}

export async function copyGameTemplate(
  templatesRoot: string,
  input: CreateGameFromTemplateRequest,
  validateTarget?: (target: string) => Promise<void>,
): Promise<string> {
  const target = await resolveGameTemplateTarget(input.parentDir, input.name, input.createParent === true);
  const template = (await listGameTemplates(templatesRoot)).find(item => item.id === input.templateId);
  if (!template) throw new GameTemplateError('TEMPLATE_NOT_FOUND', 'Unknown game template');
  // Import policy runs before the first write, including data-root and
  // credential-directory rejection. The directory is then claimed exclusively.
  await validateTarget?.(target);
  if (input.createParent === true) {
    const parent = path.dirname(target);
    await mkdir(parent, { recursive: true });
    // Do not follow an ancestor swapped for a symlink between preflight and mkdir.
    if (await realpath(parent) !== parent) throw new GameTemplateError('TARGET_REJECTED', 'Parent directory changed while creating the game');
  }
  try {
    await mkdir(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new GameTemplateError('TARGET_EXISTS', 'Target already exists');
    throw error;
  }
  const files = path.join(templatesRoot, template.id, 'files');
  for (const entry of await readdir(files)) {
    await cp(path.join(files, entry), path.join(target, entry), {
      recursive: true, force: false, errorOnExist: true,
    });
  }
  return target;
}

/**
 * Copy a starter into a project folder that already exists (the folder the user
 * chose, or a managed project). Never overwrites; the caller checks it is empty.
 */
export async function copyGameTemplateInto(templatesRoot: string, templateId: string, target: string): Promise<string[]> {
  const template = (await listGameTemplates(templatesRoot)).find(item => item.id === templateId);
  if (!template) throw new GameTemplateError('TEMPLATE_NOT_FOUND', 'Unknown game template');
  const files = path.join(templatesRoot, template.id, 'files');
  const entries = await readdir(files);
  for (const entry of entries) {
    await cp(path.join(files, entry), path.join(target, entry), { recursive: true, force: false, errorOnExist: true });
  }
  return entries;
}

/** Only newly copied template folders call this; imported folders are never initialized. */
export async function initializeGameTemplateGit(target: string, templateId: string,
  runGit: ProjectGitRunner = (args, input) => runProjectGit(target, args, { input })): Promise<GameTemplateGitResult> {
  try {
    await initializeProjectGit(runGit, `Initial project from ${templateId}`);
    return { status: 'initialized' };
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
      ? { status: 'skipped', reasonCode: 'GIT_MISSING' }
      : { status: 'failed', reasonCode: 'GIT_INIT_FAILED', message: error instanceof Error ? error.message : String(error) };
  }
}
