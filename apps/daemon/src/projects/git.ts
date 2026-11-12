import { execFile } from 'node:child_process';

export type ProjectGitRunner = (args: string[], input?: string) => Promise<string>;

function projectGitEnv(index: string | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES']) delete env[name];
  Object.assign(env, {
    GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C',
    GIT_AUTHOR_NAME: 'OpenPixo', GIT_AUTHOR_EMAIL: 'openpixo@local.invalid',
    GIT_COMMITTER_NAME: 'OpenPixo', GIT_COMMITTER_EMAIL: 'openpixo@local.invalid',
    ...(index ? { GIT_INDEX_FILE: index } : {}),
  });
  return env;
}

const PROJECT_GIT_CONFIG = [
  '-c', 'core.splitIndex=false', '-c', 'core.sparseCheckout=false', '-c', 'index.sparse=false',
  '-c', 'commit.gpgSign=false',
];

/** `gitDir` keeps the repository outside the project: the folder is only its work tree. */
function projectGitArgs(folder: string, args: string[], gitDir: string | undefined): string[] {
  return [...PROJECT_GIT_CONFIG, ...(gitDir ? [`--git-dir=${gitDir}`, `--work-tree=${folder}`] : []), ...args];
}

/** A project's Git process cannot inherit a shell integration's alternate worktree or index. */
export function runProjectGit(folder: string, args: string[], options: { index?: string | undefined; input?: string | undefined; signal?: AbortSignal | undefined; gitDir?: string | undefined } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile('git', projectGitArgs(folder, args, options.gitDir), { cwd: folder, env: projectGitEnv(options.index), windowsHide: true, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
      timeout: 30_000, signal: options.signal }, (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { stderr })); else resolve(stdout);
    });
    child.stdin?.on('error', () => {});
    child.stdin?.end(options.input);
  });
}

/** Same isolation as `runProjectGit`, for output that must stay bytes (blob contents). */
export function runProjectGitBytes(folder: string, args: string[], options: { maxBuffer: number; signal?: AbortSignal | undefined; gitDir?: string | undefined }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = execFile('git', projectGitArgs(folder, args, options.gitDir), { cwd: folder, env: projectGitEnv(undefined), windowsHide: true, encoding: 'buffer',
      maxBuffer: options.maxBuffer, timeout: 30_000, signal: options.signal }, (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { stderr: stderr.toString('utf8') })); else resolve(stdout);
    });
    child.stdin?.on('error', () => {});
    child.stdin?.end();
  });
}

/** Initialize HEAD/index only after explicit project creation or version-protection opt-in. No hooks run. */
export async function initializeProjectGit(runGit: ProjectGitRunner, message: string): Promise<void> {
  await runGit(['init', '--quiet']);
  await runGit(['add', '-A', '--', '.']);
  const tree = (await runGit(['write-tree'])).trim();
  const commit = (await runGit(['commit-tree', tree], message + '\n')).trim();
  await runGit(['update-ref', 'HEAD', commit, '']);
}
