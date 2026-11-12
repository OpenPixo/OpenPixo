import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { expandHomePath } from './paths.js';

/**
 * Whether the vendor's own sign-in is on this computer although its CLI was
 * not found. Only Codex is known: the Codex desktop app and editor extensions
 * keep their sign-in where the CLI does (`$CODEX_HOME`, default `~/.codex`),
 * so a sign-in there with no `codex` command means the user has Codex, just
 * not the command-line version OpenPixo runs. A first-time tester in exactly
 * this spot read "no coding agent found" as "OpenPixo can't see my Codex".
 *
 * Reads only whether the file exists, never its contents.
 */
export function vendorSignInWithoutCli(
  agentId: string,
  configuredEnv: Record<string, string> = {},
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (agentId !== 'codex') return false;
  const raw = (configuredEnv.CODEX_HOME ?? env.CODEX_HOME)?.trim();
  const home = raw ? expandHomePath(raw) : path.join(homedir(), '.codex');
  try {
    return existsSync(path.join(home, 'auth.json'));
  } catch {
    return false;
  }
}
