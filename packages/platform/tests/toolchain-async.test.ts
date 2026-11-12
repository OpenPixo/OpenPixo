import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { wellKnownUserToolchainBins, wellKnownUserToolchainBinsAsync } from '../src/toolchain.js';

test('async toolchain discovery preserves version ordering and configured install roots', async () => {
  const home = await mkdtemp(join(tmpdir(), 'pixo-toolchain-async-'));
  try {
    await Promise.all([
      mkdir(join(home, '.nvm', 'versions', 'node', 'v24.1.0', 'bin'), { recursive: true }),
      mkdir(join(home, '.nvm', 'versions', 'node', 'v24.10.0', 'bin'), { recursive: true }),
      mkdir(join(home, '.local', 'share', 'mise', 'installs', 'npm-openai-codex', '1.0.0', 'bin'), { recursive: true }),
    ]);
    const options = { home, env: {}, includeSystemBins: false };
    expect(await wellKnownUserToolchainBinsAsync(options)).toEqual(wellKnownUserToolchainBins(options));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
