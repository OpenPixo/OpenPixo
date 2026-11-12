import { afterEach, expect, it, vi } from 'vitest';
import { createGameFromTemplate } from '../../src/components/NewGameDialog.api';
afterEach(() => vi.unstubAllGlobals());

it('retains domain reason codes inside the standard HTTP error envelope', async () => {
  const fetchMock = vi.fn(async () => Response.json({ error: { code: 'BAD_REQUEST', message: 'parentDir not found', details: { reasonCode: 'PARENT_NOT_FOUND' } } }, { status: 400 }));
  vi.stubGlobal('fetch', fetchMock);
  const input = { templateId: 'phaser3-vite', parentDir: 'C:\\Games', name: 'my-game', createParent: true };
  await expect(createGameFromTemplate(input, 'picked')).rejects.toMatchObject({ code: 'PARENT_NOT_FOUND', status: 400 });
  expect(fetchMock).toHaveBeenCalledWith('/api/projects/game-from-template', expect.objectContaining({
    method: 'POST', body: JSON.stringify(input), headers: { 'Content-Type': 'application/json', 'x-pixo-desktop-import-token': 'picked' },
  }));
});
