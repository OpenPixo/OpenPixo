import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DpapiSecretStore } from '../../src/account/secret-store.js';

describe('daemon account SecretStore', () => {
  it('requires the resolved absolute data root', () => {
    expect(() => new DpapiSecretStore('relative-root')).toThrow('absolute resolved daemon data root');
  });

  it.runIf(process.platform !== 'win32')('refuses persistence on platforms without a secure implementation', async () => {
    const store = new DpapiSecretStore(tmpdir());
    expect(await store.isAvailable()).toBe(false);
    await expect(store.write('never-written')).rejects.toThrow('OS-encrypted account storage is unavailable');
  });

  it.runIf(process.platform === 'win32')('round-trips through CurrentUser DPAPI and persists only ciphertext, including overwrites', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'pixo-account-dpapi-'));
    try {
      const store = new DpapiSecretStore(root);
      expect(await store.isAvailable()).toBe(true);
      expect(await store.read()).toBeNull();
      const secret = JSON.stringify({ accessToken: 'synthetic-access-secret', refreshToken: 'synthetic-refresh-secret', name: '开发者' });
      await store.write(secret);
      expect(await store.read()).toBe(secret);
      const ciphertext = await readFile(path.join(root, 'account', 'session.dpapi'));
      expect(ciphertext.includes(Buffer.from(secret))).toBe(false);
      expect(ciphertext.includes(Buffer.from('synthetic-access-secret'))).toBe(false);
      expect(ciphertext.includes(Buffer.from(Buffer.from(secret).toString('base64')))).toBe(false);
      const restarted = new DpapiSecretStore(root);
      expect(await restarted.read()).toBe(secret);
      await restarted.write('rotated synthetic secret');
      expect(await store.read()).toBe('rotated synthetic secret');
      expect(await readdir(path.join(root, 'account'))).toEqual(['session.dpapi']);
      await store.clear();
      expect(await restarted.read()).toBeNull();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
