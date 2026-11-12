import { closeDatabase } from '../src/db.js';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db.js';

import { resolveLocalPluginBySource, resolvePluginFolder, resolvePluginSnapshot, upsertInstalledPlugin } from '../src/plugins/index.js';

const roots: string[] = [];

afterEach(async () => {
  closeDatabase();
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true }),
  ));
});

async function pluginManifest(folder: string, title: string): Promise<void> {
  await mkdir(folder, { recursive: true });
  await writeFile(
    path.join(folder, 'pixo.json'),
    JSON.stringify({ name: 'shared-id', title, version: '1.0.0' }),
  );
}

describe('resolveLocalPluginBySource', () => {


  it('selects the exact installed local record and carries it into a project snapshot', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'pixo-local-plugin-source-')); roots.push(root);
    const db = openDatabase(root, { dataDir: root });
    const folder = path.join(root, 'plugin'); await pluginManifest(folder, 'Local copy');
    const parsed = await resolvePluginFolder({ folder, folderId: 'shared-id', sourceKind: 'local', source: folder });
    if (!parsed.ok) throw new Error(parsed.errors.join('; ')); upsertInstalledPlugin(db, parsed.record);
    const selected = await resolveLocalPluginBySource({ db, id: 'shared-id', source: folder });
    expect(selected).toMatchObject({ id: 'shared-id', source: folder, title: 'Local copy' });
    expect(await resolveLocalPluginBySource({ db, id: 'shared-id', source: path.join(root, 'different') })).toBeNull();
    db.prepare('INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run('local-game', 'Game', 1, 1);
    const snapshot = resolvePluginSnapshot({ db, body: { pluginId: 'shared-id' }, projectId: 'local-game', registry: { skills: [], atoms: [] }, plugin: selected! });
    expect(snapshot?.ok).toBe(true); if (snapshot?.ok) expect(snapshot.snapshot.pluginTitle).toBe('Local copy');
  });

  it('rejects an unknown local source without adopting filesystem bytes', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'pixo-local-plugin-source-')); roots.push(root);
    const db = openDatabase(root, { dataDir: root });
    await pluginManifest(path.join(root, 'unregistered'), 'Unregistered');
    expect(await resolveLocalPluginBySource({ db, id: 'shared-id', source: path.join(root, 'unregistered') })).toBeNull();
  });


});
