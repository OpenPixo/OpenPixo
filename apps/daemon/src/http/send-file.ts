import path from 'node:path';
import type { Response } from 'express';

/**
 * Serves a file the caller has already validated, so that where the daemon happens
 * to live never decides whether the file can be read.
 *
 * `res.sendFile(absolutePath)` dot-checks every segment of the path and answers 404
 * for any dot-directory among them. Everything then 404s when the build or the data
 * lives under `.tmp`, a worktree under `.claude`, or an imported project under a
 * dot-folder. Only the part below `root` is dot-checked here, so a dotfile such as
 * `.env` is still refused. By default that part is the file's own name; a route whose
 * path comes from the request passes the root it validated against, so a dot-directory
 * below that root stays refused too.
 *
 * This performs no validation of its own: containment and symlink checks stay with
 * the caller. Errors reach Express's `next(err)` exactly as a plain `sendFile` does.
 */
export function sendValidatedFile(res: Response, file: string, root: string = path.dirname(file)): void {
  res.sendFile(path.relative(root, file).split(path.sep).join('/'), { root });
}
