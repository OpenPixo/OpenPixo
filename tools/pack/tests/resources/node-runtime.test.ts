import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BUNDLED_NODE_RELEASE, BUNDLED_NODE_TREE_ENV, bundledNodeArchiveUrl, resolveBundledNodeDistribution,
} from '@/node-runtime.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'openpixo-bundled-node-'));
  roots.push(root);
  return root;
}

const unusedSevenZip = join('no', '7z.exe');

describe('bundled Node.js for games', () => {
  it('downloads the pinned official archive and refuses one whose checksum differs', async () => {
    const cacheRoot = await tempRoot();
    const fetchArchive = vi.fn(async () => Buffer.from('not the official archive'));
    await expect(resolveBundledNodeDistribution({ cacheRoot, sevenZipExe: unusedSevenZip, env: {}, fetchArchive }))
      .rejects.toThrow(/checksum mismatch/);
    expect(fetchArchive).toHaveBeenCalledWith(bundledNodeArchiveUrl());
    expect(bundledNodeArchiveUrl()).toBe(`https://nodejs.org/dist/v${BUNDLED_NODE_RELEASE.version}/node-v${BUNDLED_NODE_RELEASE.version}-win-x64.zip`);
    // Nothing unverified is kept for the next build to pick up.
    await expect(readdir(join(cacheRoot, 'bundled-node'))).resolves.toEqual([]);
  });

  it('reuses a tree extracted from the verified archive without downloading again', async () => {
    const cacheRoot = await tempRoot();
    const source = join(cacheRoot, 'bundled-node', `node-v${BUNDLED_NODE_RELEASE.version}-win-x64`);
    await mkdir(source, { recursive: true });
    await writeFile(join(source, 'node.exe'), 'node');
    await writeFile(join(source, '.openpixo-verified'), `${BUNDLED_NODE_RELEASE.sha256}\n`);
    const fetchArchive = vi.fn(async () => Buffer.alloc(0));
    await expect(resolveBundledNodeDistribution({ cacheRoot, sevenZipExe: unusedSevenZip, env: {}, fetchArchive }))
      .resolves.toEqual({ source, version: BUNDLED_NODE_RELEASE.version, sha256: BUNDLED_NODE_RELEASE.sha256 });
    expect(fetchArchive).not.toHaveBeenCalled();
  });

  it('takes an explicit tree only when it holds node.exe, and never downloads for it', async () => {
    const tree = await tempRoot();
    const fetchArchive = vi.fn(async () => Buffer.alloc(0));
    const resolve = () => resolveBundledNodeDistribution({
      cacheRoot: '', sevenZipExe: unusedSevenZip, env: { [BUNDLED_NODE_TREE_ENV]: tree }, fetchArchive,
    });
    await expect(resolve()).rejects.toThrow(/no node\.exe/);
    await writeFile(join(tree, 'node.exe'), 'node');
    await expect(resolve()).resolves.toEqual({ source: tree, version: null, sha256: null });
    expect(fetchArchive).not.toHaveBeenCalled();
  });

  it('fails loudly instead of downloading somewhere unplanned when no cache root is given', async () => {
    await expect(resolveBundledNodeDistribution({ cacheRoot: '', sevenZipExe: unusedSevenZip, env: {} }))
      .rejects.toThrow(BUNDLED_NODE_TREE_ENV);
  });
});
