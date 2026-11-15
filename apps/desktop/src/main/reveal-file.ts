import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

/**
 * Resolve a project-relative file for "Show in Explorer".
 *
 * The renderer names a project and a path inside it; the project directory
 * comes from the daemon (the same trust boundary as `shell:open-path`). This
 * function only has to make sure the path cannot leave that directory: no
 * absolute paths, no `..`, no NUL, and after symlinks are followed the file
 * must still sit inside the project's real directory. The file must exist,
 * because Explorer opened on a missing item lands somewhere unrelated.
 */
export type RevealFileResult = { ok: true; resolved: string } | { ok: false; reason: string };

export interface RevealFileDeps {
  realpath: (path: string) => Promise<string>;
  platform: NodeJS.Platform;
}

const defaultDeps: RevealFileDeps = { realpath: (path) => realpath(path), platform: process.platform };

function insideDir(dir: string, candidate: string, platform: NodeJS.Platform): boolean {
  const fold = (value: string) => (platform === "win32" || platform === "darwin" ? value.toLowerCase() : value);
  const rel = relative(fold(dir), fold(candidate));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel) && !rel.startsWith(`..${sep}`));
}

export async function resolveProjectFileForReveal(
  projectDir: string,
  relPath: unknown,
  deps: RevealFileDeps = defaultDeps,
): Promise<RevealFileResult> {
  if (typeof relPath !== "string" || relPath.length === 0) {
    return { ok: false, reason: "file path must be a non-empty string" };
  }
  if (relPath.length > 4096 || relPath.includes("\0")) {
    return { ok: false, reason: "file path is not valid" };
  }
  const normalized = relPath.replace(/\\/g, "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized) || isAbsolute(relPath)) {
    return { ok: false, reason: "file path must be relative to the project" };
  }
  if (normalized.split("/").some((segment) => segment === "..")) {
    return { ok: false, reason: "file path must stay inside the project" };
  }
  let realDir: string;
  try {
    realDir = await deps.realpath(projectDir);
  } catch {
    return { ok: false, reason: "project folder does not exist" };
  }
  const joined = resolve(realDir, ...normalized.split("/").filter((segment) => segment !== "" && segment !== "."));
  if (!insideDir(realDir, joined, deps.platform)) {
    return { ok: false, reason: "file path must stay inside the project" };
  }
  let realFile: string;
  try {
    realFile = await deps.realpath(joined);
  } catch {
    return { ok: false, reason: "file does not exist" };
  }
  if (!insideDir(realDir, realFile, deps.platform)) {
    return { ok: false, reason: "file path must stay inside the project" };
  }
  return { ok: true, resolved: realFile };
}
