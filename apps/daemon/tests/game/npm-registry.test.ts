import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CHINA_NPM_MIRROR, isMainlandChinaTimeZone, npmRegistryEnv } from '../../src/game/npm-registry.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function temp(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'openpixo-npm-registry-'));
  roots.push(root);
  return root;
}

describe('npm registry for users in mainland China', () => {
  it('counts mainland time zones only', () => {
    for (const zone of ['Asia/Shanghai', 'Asia/Urumqi', 'Asia/Chongqing', 'PRC']) expect(isMainlandChinaTimeZone(zone), zone).toBe(true);
    for (const zone of ['Asia/Hong_Kong', 'Asia/Macau', 'Asia/Taipei', 'Asia/Tokyo', 'Asia/Singapore', 'UTC', undefined]) {
      expect(isMainlandChinaTimeZone(zone), String(zone)).toBe(false);
    }
  });

  it('points npm at the mirror in mainland China and leaves everyone else on the default', async () => {
    const home = await temp();
    await expect(npmRegistryEnv({ env: {}, timeZone: 'Asia/Shanghai', home })).resolves.toEqual({ npm_config_registry: CHINA_NPM_MIRROR });
    await expect(npmRegistryEnv({ env: {}, timeZone: 'Asia/Hong_Kong', home })).resolves.toEqual({});
    await expect(npmRegistryEnv({ env: {}, timeZone: 'America/Los_Angeles', home })).resolves.toEqual({});
  });

  it('keeps a registry the user already chose, in the environment or any npmrc', async () => {
    const home = await temp();
    const project = await temp();
    const china = { timeZone: 'Asia/Shanghai', home, cwd: project };
    await expect(npmRegistryEnv({ ...china, env: { NPM_CONFIG_REGISTRY: 'https://npm.example.com' } })).resolves.toEqual({});

    // A scoped registry only covers that scope, so the default still needs the mirror.
    await writeFile(path.join(home, '.npmrc'), '@acme:registry=https://npm.acme.dev\n');
    await expect(npmRegistryEnv({ ...china, env: {} })).resolves.toEqual({ npm_config_registry: CHINA_NPM_MIRROR });

    await writeFile(path.join(project, '.npmrc'), 'registry = https://npm.company.cn/\n');
    await expect(npmRegistryEnv({ ...china, env: {} })).resolves.toEqual({});

    await rm(path.join(project, '.npmrc'));
    const custom = path.join(home, 'custom.npmrc');
    await writeFile(custom, 'registry=https://registry.npmjs.org/\r\n');
    await expect(npmRegistryEnv({ ...china, env: { npm_config_userconfig: custom } })).resolves.toEqual({});
  });
});
