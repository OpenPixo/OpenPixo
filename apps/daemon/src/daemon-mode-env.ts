/**
 * The daemon's environment without the mode it runs in. The packaged daemon is
 * started with NODE_ENV=production, which says something about the daemon only: a
 * package manager reads it as "leave out the development dependencies" (npm does, and
 * a web game's `vite` is one), and a dev server as "behave like a release". Games and
 * agents get the environment a terminal would give them.
 */
export function withoutDaemonMode<T extends NodeJS.ProcessEnv | Record<string, string>>(env: T): T {
  return Object.fromEntries(Object.entries(env).filter(([name]) => name.toUpperCase() !== 'NODE_ENV')) as T;
}
