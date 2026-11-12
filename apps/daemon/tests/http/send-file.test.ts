import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sendValidatedFile } from '../../src/http/send-file.js';

/**
 * Express refuses any path with a dot-directory in it, so a build under `.tmp`, a
 * worktree under `.claude`, or a project inside a dot-folder lost every image. The
 * folder the daemon chose is trusted; what lies below it is still dot-checked.
 */
describe('sendValidatedFile', () => {
  let root: string;
  let server: Server;
  let base: string;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'openpixo-send-file-'));
    const assets = path.join(root, '.tmp', 'assets');
    await mkdir(path.join(assets, '.hidden'), { recursive: true });
    await writeFile(path.join(assets, 'cover.png'), 'cover');
    await writeFile(path.join(assets, 'name with #hash %20.png'), 'odd name');
    await writeFile(path.join(assets, '.env'), 'SECRET=1');
    await writeFile(path.join(assets, '.hidden', 'inner.png'), 'inner');
    const app = express();
    app.get('/file', (req, res) => sendValidatedFile(res, path.join(assets, String(req.query.name))));
    app.get('/rooted', (req, res) => sendValidatedFile(res, path.join(assets, String(req.query.name)), assets));
    server = app.listen(0);
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing test port');
    base = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  });

  const get = (route: string, name: string) => fetch(`${base}${route}?name=${encodeURIComponent(name)}`);

  it('serves a file whose folders include a dot-directory', async () => {
    const response = await get('/file', 'cover.png');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('cover');
    expect(response.headers.get('content-type')).toMatch(/^image\/png/);
  });

  it('serves a file name that needs URL escaping', async () => {
    const response = await get('/file', 'name with #hash %20.png');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('odd name');
  });

  it('still refuses a dotfile', async () => {
    expect((await get('/file', '.env')).status).toBe(404);
    expect((await get('/rooted', '.env')).status).toBe(404);
  });

  it('with a trusted root, still refuses a dot-directory below it', async () => {
    expect((await get('/rooted', 'cover.png')).status).toBe(200);
    expect((await get('/rooted', path.join('.hidden', 'inner.png'))).status).toBe(404);
  });

  it('with a trusted root, refuses a path that climbs out of it', async () => {
    expect((await get('/rooted', path.join('..', 'assets', 'cover.png'))).status).toBe(200);
    const escaped = await get('/rooted', path.join('..', '..', 'outside.png'));
    expect(escaped.status).toBeGreaterThanOrEqual(400);
  });
});

/** A new absolute `res.sendFile` would bring the missing-images bug straight back. */
describe('daemon file-serving call sites', () => {
  it('go through sendValidatedFile, or name their own root', async () => {
    const src = fileURLToPath(new URL('../../src/', import.meta.url));
    const entries = await readdir(src, { recursive: true, withFileTypes: true });
    const offenders: string[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
      const file = path.join(entry.parentPath, entry.name);
      const relative = path.relative(src, file).split(path.sep).join('/');
      if (relative === 'http/send-file.ts') continue;
      const text = await readFile(file, 'utf8');
      for (const match of text.matchAll(/\.sendFile\(([^)]*)\)/gu)) {
        if (!/\{\s*root:/u.test(match[1] ?? '')) offenders.push(`${relative}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
