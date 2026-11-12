import { describe, expect, it } from 'vitest';
import { homeWorkingDirCreateFields, refreshHomeWorkingDirGrant } from '../../src/components/home-working-dir';

describe('the folder chosen on Home is the project folder', () => {
  it('becomes the working directory, not a read-only reference', () => {
    const fields = homeWorkingDirCreateFields({ workingDir: 'C:\\Games\\RageGame', workingDirToken: 'picker-token', linkedDirs: [] });
    expect(fields.metadata.userWorkingDir).toBe('C:\\Games\\RageGame');
    expect(fields.userWorkingDirToken).toBe('picker-token');
    expect(fields.metadata.linkedDirs).toBeUndefined();
  });

  it('keeps folders referenced as context read-only', () => {
    const fields = homeWorkingDirCreateFields({ workingDir: null, linkedDirs: ['C:\\Other', ' C:\\Other ', ''] });
    expect(fields.metadata.userWorkingDir).toBeUndefined();
    expect(fields.metadata.linkedDirs).toEqual(['C:\\Other']);
    expect(fields.userWorkingDirToken).toBeUndefined();
  });

  it('does not reference the working directory as a second folder', () => {
    const fields = homeWorkingDirCreateFields({ workingDir: 'C:\\Games\\RageGame', linkedDirs: ['C:\\Games\\RageGame', 'C:\\Art'] });
    expect(fields.metadata.linkedDirs).toEqual(['C:\\Art']);
  });

  it('asks for nothing with no folder', () => {
    expect(homeWorkingDirCreateFields({ workingDir: null, linkedDirs: null })).toEqual({ metadata: {} });
  });
});

describe('the desktop grant for that folder', () => {
  const deps = (overrides = {}) => ({
    hostAvailable: true,
    authorize: async (baseDir: string) => ({ ok: true as const, baseDir, token: 'fresh' }),
    pick: async () => ({ ok: true as const, baseDir: 'C:\\Picked', token: 'picked' }),
    ...overrides,
  });

  it('needs no grant in a plain browser', async () => {
    await expect(refreshHomeWorkingDirGrant('C:\\G', null, deps({ hostAvailable: false }))).resolves.toEqual({ workingDir: 'C:\\G', token: null });
  });

  it('mints a fresh token at send time, because a picked one expires while the user types', async () => {
    await expect(refreshHomeWorkingDirGrant('C:\\G', 'stale', deps())).resolves.toEqual({ workingDir: 'C:\\G', token: 'fresh' });
  });

  it('reopens the picker for a recent folder the host will not vouch for', async () => {
    const result = await refreshHomeWorkingDirGrant('C:\\Recent', null, deps({ authorize: async () => ({ ok: false as const, reason: 'Choose this parent with the folder picker first' }) }));
    expect(result).toEqual({ workingDir: 'C:\\Picked', token: 'picked' });
  });

  it('stops the send when the user cancels that picker', async () => {
    const result = await refreshHomeWorkingDirGrant('C:\\Recent', null, deps({
      authorize: async () => ({ ok: false as const, reason: 'no' }),
      pick: async () => ({ ok: false as const, canceled: true as const }),
    }));
    expect(result).toBeNull();
  });
});
