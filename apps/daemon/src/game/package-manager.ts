import type { GamePackageManager } from '@openpixo/contracts';
export const GAME_PACKAGE_LOCKS = [
  ['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn'], ['bun.lock', 'bun'], ['bun.lockb', 'bun'], ['package-lock.json', 'npm'],
] as const;

/** Run/build/install honor the manifest first, then the same lockfile precedence. */
export function gamePackageManager(declared: unknown, hasFile: (name: string) => boolean): GamePackageManager {
  const match = typeof declared === 'string' ? /^(npm|pnpm|yarn|bun)@[^\s]+$/.exec(declared) : null;
  return match ? match[1] as GamePackageManager : GAME_PACKAGE_LOCKS.find(([file]) => hasFile(file))?.[1] ?? 'npm';
}
