import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, isAbsolute, relative } from "node:path";

import type { DesktopUpdateErrorSnapshot } from "@openpixo/sidecar-proto";

/**
 * @module updater/support
 *
 * Generic helpers shared across the updater modules: structured error
 * construction, JSON type-guard primitives, path containment, and atomic
 * JSON file IO. No updater state and no store semantics.
 */

export function createError(code: string, message: string, details?: unknown): DesktopUpdateErrorSnapshot {
  return {
    code,
    ...(details === undefined ? {} : { details }),
    message,
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

export function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function containsPath(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Error codes Windows returns while another process (antivirus, the search
 * indexer, Explorer's thumbnailer) briefly holds a file or folder open. They
 * clear on their own within moments, so a rename that hits one is retried.
 */
const TRANSIENT_RENAME_CODES = new Set(["EACCES", "EBUSY", "EPERM"]);

/** Waits between rename attempts: about 1.5 s in all, then the error stands. */
export const RENAME_RETRY_DELAYS_MS: readonly number[] = [25, 50, 100, 200, 400, 800];

export type RenameOptions = {
  delaysMs?: readonly number[];
  rename?: (from: string, to: string) => Promise<void>;
};

function isTransientRenameError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return typeof code === "string" && TRANSIENT_RENAME_CODES.has(code);
}

/**
 * Rename that survives a short-lived lock: retried a bounded number of times on
 * the codes above, never on anything else (a missing source fails at once).
 */
export async function renameWithRetry(from: string, to: string, options: RenameOptions = {}): Promise<void> {
  const doRename = options.rename ?? rename;
  const delays = options.delaysMs ?? RENAME_RETRY_DELAYS_MS;
  for (let attempt = 0; ; attempt += 1) {
    try {
      await doRename(from, to);
      return;
    } catch (error) {
      const delay = delays[attempt];
      if (delay == null || !isTransientRenameError(error)) throw error;
      await sleep(delay);
    }
  }
}

/** Name of the temporary file {@link writeJson} renames over `<file>`. */
export function isJsonWriteTmpFor(file: string, entry: string): boolean {
  return entry.startsWith(`${file}.`) && /^\.\d+\.\d+\.tmp$/.test(entry.slice(file.length));
}

/**
 * Atomic JSON write: the file either keeps its old content or gets the new one.
 * The temporary file does not outlive a failed write.
 */
export async function writeJson(path: string, payload: unknown, options: RenameOptions = {}): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await renameWithRetry(tmp, path, options);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}

/**
 * Puts `source` at `target`, replacing what is there, and never leaves neither:
 * the old directory is moved aside to `backup` first and moved back when the
 * new one cannot be moved in. On failure `source` stays where it was, so the
 * caller decides what to do with it. Every rename retries a short-lived lock.
 */
export async function replaceDirectory(
  source: string,
  target: string,
  backup: string,
  options: RenameOptions = {},
): Promise<void> {
  await rm(backup, { force: true, recursive: true });
  await mkdir(dirname(backup), { recursive: true });
  let movedAside = false;
  try {
    await renameWithRetry(target, backup, options);
    movedAside = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  try {
    await renameWithRetry(source, target, options);
  } catch (error) {
    if (movedAside) await renameWithRetry(backup, target, options).catch(() => undefined);
    throw error;
  }
  if (movedAside) await rm(backup, { force: true, recursive: true }).catch(() => undefined);
}

export async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

export async function readJsonStrict<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

/** Whether `path` holds nothing except entries `ignore` accepts. */
export async function directoryIsEmpty(path: string, ignore: (entries: string[]) => Promise<Set<string>> = async () => new Set()): Promise<boolean> {
  const entries = await readdir(path);
  if (entries.length === 0) return true;
  const ignored = await ignore(entries);
  return entries.every((entry) => ignored.has(entry));
}

export function numberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function objectField(record: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = record[key];
  return isRecord(value) ? value : null;
}
