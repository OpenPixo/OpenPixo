import { afterEach, expect, it, vi } from 'vitest';
import { bootstrapProjectRoute } from '../src/state/projects';
import type { Project } from '../src/types';

const project: Project = {
  id: 'local-game', name: 'Local game', skillId: null, createdAt: 1, updatedAt: 1,
};
afterEach(() => vi.unstubAllGlobals());

it('opens a local project with the daemon-resolved folder and no workspace headers', async () => {
  const fetch = vi.fn(async () => Response.json({ project, resolvedDir: '/imported/game' }));
  vi.stubGlobal('fetch', fetch);
  expect(await bootstrapProjectRoute(project.id)).toEqual({ kind: 'found', project, resolvedDir: '/imported/game' });
  expect(fetch).toHaveBeenCalledWith('/api/projects/local-game', { cache: 'no-store' });
});

it.each([[403, 'forbidden'], [404, 'not-found'], [503, 'unavailable']] as const)(
  'preserves a refused local detail read: HTTP %s', async (status, kind) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status })));
    expect(await bootstrapProjectRoute(project.id)).toEqual({ kind });
  },
);

it('rejects a mismatched project instead of mounting another project on the route', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ project: { ...project, id: 'other' } })));
  expect(await bootstrapProjectRoute(project.id)).toEqual({ kind: 'unavailable' });
});

it('joins concurrent reads and lets a later request recover after a transport failure', async () => {
  let fail!: (error: Error) => void;
  const fetch = vi.fn<() => Promise<Response>>(() => new Promise((_resolve, reject) => { fail = reject; }));
  vi.stubGlobal('fetch', fetch);
  const first = bootstrapProjectRoute(project.id);
  const second = bootstrapProjectRoute(project.id);
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  fail(new Error('local daemon restarting'));
  expect(await first).toEqual({ kind: 'unavailable' });
  expect(await second).toEqual({ kind: 'unavailable' });
  fetch.mockImplementation(async () => Response.json({ project }));
  expect(await bootstrapProjectRoute(project.id)).toEqual({ kind: 'found', project, resolvedDir: null });
  expect(fetch).toHaveBeenCalledTimes(2);
});
