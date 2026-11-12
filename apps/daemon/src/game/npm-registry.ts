import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

/**
 * npm's default registry is slow or unreachable from mainland China, which
 * makes a first `npm install` look like OpenPixo is broken. There, games and
 * agent shells use Alibaba's public mirror instead.
 *
 * "In mainland China" is read from the system time zone: it needs no network
 * call and sends nothing anywhere. Hong Kong, Macau and Taiwan reach npm
 * directly and keep the default. A registry the user or project already chose
 * always wins, so this only fills in the default.
 */
export const CHINA_NPM_MIRROR = 'https://registry.npmmirror.com';

const MAINLAND_CHINA_TIME_ZONES = new Set([
  'Asia/Shanghai', 'Asia/Chongqing', 'Asia/Chungking', 'Asia/Harbin', 'Asia/Urumqi', 'Asia/Kashgar', 'PRC',
]);

export function isMainlandChinaTimeZone(timeZone: string | undefined): boolean {
  return timeZone != null && MAINLAND_CHINA_TIME_ZONES.has(timeZone);
}

function systemTimeZone(): string | undefined {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; }
}

function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const key = Object.keys(env).find(candidate => candidate.toLowerCase() === name);
  const value = key == null ? undefined : env[key]?.trim();
  return value ? value : undefined;
}

/** True when an npmrc sets the default registry (scoped `@scope:registry` lines do not count). */
async function npmrcSetsRegistry(file: string): Promise<boolean> {
  let text: string;
  try { text = await readFile(file, 'utf8'); } catch { return false; }
  return text.split(/\r?\n/).some(line => /^\s*registry\s*=\s*\S/.test(line));
}

export interface NpmRegistryEnvOptions {
  env: NodeJS.ProcessEnv;
  /** The project folder; its `.npmrc` counts as the user's choice. */
  cwd?: string | undefined;
  timeZone?: string | undefined;
  home?: string;
}

/**
 * The environment additions that point npm and pnpm at the mirror, or `{}`
 * when the user is outside mainland China or already chose a registry. An
 * environment variable outranks every npmrc, so it is only set when none of
 * them names one.
 */
export async function npmRegistryEnv({
  env, cwd, timeZone = systemTimeZone(), home = homedir(),
}: NpmRegistryEnvOptions): Promise<NodeJS.ProcessEnv> {
  if (!isMainlandChinaTimeZone(timeZone)) return {};
  if (envValue(env, 'npm_config_registry')) return {};
  const userConfig = envValue(env, 'npm_config_userconfig') ?? path.join(home, '.npmrc');
  const files = [userConfig, ...(cwd ? [path.join(cwd, '.npmrc')] : [])];
  for (const file of files) if (await npmrcSetsRegistry(file)) return {};
  return { npm_config_registry: CHINA_NPM_MIRROR };
}
