// The folder picked in the Home composer is where the new game lives. The agent
// works inside it and verify, playtest and run read it, so it becomes the
// project's working directory (`metadata.baseDir`, through the handoff in App)
// rather than a read-only `linkedDirs` reference.
import type { ProjectMetadata } from '@openpixo/contracts';

export interface HomeWorkingDirInput {
  workingDir?: string | null;
  workingDirToken?: string | null;
  /** Folders referenced as context; these stay read-only. */
  linkedDirs?: string[] | null;
}

export function homeWorkingDirCreateFields(input: HomeWorkingDirInput): {
  metadata: Pick<ProjectMetadata, 'userWorkingDir' | 'linkedDirs'>;
  userWorkingDirToken?: string;
} {
  const workingDir = input.workingDir?.trim() ?? '';
  const linkedDirs = [...new Set((input.linkedDirs ?? []).map(dir => dir.trim()).filter(Boolean))]
    .filter(dir => dir !== workingDir);
  return {
    metadata: {
      ...(workingDir ? { userWorkingDir: workingDir } : {}),
      ...(linkedDirs.length > 0 ? { linkedDirs } : {}),
    },
    ...(workingDir && input.workingDirToken ? { userWorkingDirToken: input.workingDirToken } : {}),
  };
}

type HostGrant = { ok: true; baseDir: string; token: string } | { ok: false; canceled?: boolean; reason?: string };

export interface HomeWorkingDirGrantDeps {
  hostAvailable: boolean;
  authorize: (baseDir: string) => Promise<HostGrant>;
  pick: () => Promise<HostGrant>;
}

/**
 * The token the desktop host mints for a folder is short-lived and single-use,
 * and a person takes longer than that to type a game idea. A recent folder has
 * no token at all. Ask for a fresh one when the message is sent; when the host
 * will not vouch for the folder, the picker is the way to say yes. Null means
 * the user declined, so there is nothing to send.
 */
export async function refreshHomeWorkingDirGrant(
  workingDir: string,
  token: string | null,
  deps: HomeWorkingDirGrantDeps,
): Promise<{ workingDir: string; token: string | null } | null> {
  if (!deps.hostAvailable) return { workingDir, token };
  const refreshed = await deps.authorize(workingDir);
  if (refreshed.ok) return { workingDir: refreshed.baseDir, token: refreshed.token };
  const picked = await deps.pick();
  return picked.ok ? { workingDir: picked.baseDir, token: picked.token } : null;
}
