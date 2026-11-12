import type { ProjectMetadata } from '@openpixo/contracts';
import Database from 'better-sqlite3';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { ProjectAssetIndexer } from '../../src/assets/indexer.js';
import { copyGameTemplate } from '../../src/game/templates.js';

it('recognizes the copied sample art and sounds as browsable project media', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'openpixo-sample-assets-'));
  const templatesRoot = fileURLToPath(new URL('../../../../game-templates/', import.meta.url));
  const db = new Database(':memory:');
  const indexer = new ProjectAssetIndexer({ db, projectsRoot: path.join(parent, 'managed-projects') });
  try {
    const root = await copyGameTemplate(templatesRoot, {
      parentDir: parent, name: 'sample', templateId: 'phaser3-sample-platformer',
    });
    const metadata: ProjectMetadata = { kind: 'other', baseDir: root };
    const listed = await indexer.list('sample', {}, metadata);
    expect(listed.assets.map(({ relPath, kind, mime }) => ({ relPath, kind, mime }))).toEqual([
      { relPath: 'public/assets/background.png', kind: 'image', mime: 'image/png' },
      { relPath: 'public/assets/coin.png', kind: 'image', mime: 'image/png' },
      { relPath: 'public/assets/coin.wav', kind: 'audio', mime: 'audio/wav' },
      { relPath: 'public/assets/ground.png', kind: 'image', mime: 'image/png' },
      { relPath: 'public/assets/jump.wav', kind: 'audio', mime: 'audio/wav' },
      { relPath: 'public/assets/player.png', kind: 'image', mime: 'image/png' },
    ]);
    for (const [asset, width, height] of [
      ['player.png', 192, 32], ['ground.png', 32, 32], ['coin.png', 16, 16], ['background.png', 400, 225],
    ] as const) {
      expect(await indexer.info('sample', 'public/assets/' + asset, metadata))
        .toMatchObject({ kind: 'image', width, height, contentHash: expect.any(String) });
    }
    for (const asset of ['jump.wav', 'coin.wav']) {
      const bytes = await readFile(path.join(root, 'public/assets', asset));
      expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
      expect(bytes.toString('ascii', 8, 16)).toBe('WAVEfmt ');
      expect(bytes.readUInt16LE(20)).toBe(1); // PCM
      expect(bytes.readUInt16LE(22)).toBe(1); // Mono
      expect(bytes.readUInt32LE(24)).toBe(22_050);
      expect(bytes.readUInt16LE(34)).toBe(16);
      expect(bytes.toString('ascii', 36, 40)).toBe('data');
      expect(bytes.readUInt32LE(40)).toBe(bytes.length - 44);
      expect(bytes.subarray(44).some(value => value !== 0)).toBe(true);
    }
    expect(listed.assets.reduce((total, asset) => total + asset.size, 0)).toBeLessThan(1_000_000);
  } finally {
    await indexer.close();
    db.close();
    await rm(parent, { recursive: true, force: true });
  }
});
