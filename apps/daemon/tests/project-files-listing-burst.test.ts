import type http from 'node:http';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * The workspace re-reads a project's file list after file events. On a large game one listing took
 * seconds and megabytes, an agent kept writing files, and the daemon started a full listing for
 * every request: listings in flight piled up until the heap ran out (2026-11-15, 3.9 GB after
 * 2.9 hours). Concurrent requests for one project must share scans.
 */
const scans = vi.hoisted(() => ({ root: '', count: 0, hold: null as Promise<void> | null }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const readdir = (async (...args: Parameters<typeof actual.readdir>) => {
    if (scans.root && path.resolve(String(args[0])).toLowerCase() === scans.root) {
      scans.count++;
      if (scans.count === 1 && scans.hold) await scans.hold;
    }
    return actual.readdir(...args);
  }) as typeof actual.readdir;
  return { ...actual, readdir, default: { ...actual, readdir } };
});

const { startServer } = await import('../src/server.js');

describe('GET /api/projects/:id/files under a burst', () => {
  let server: http.Server;
  let baseUrl: string;
  let folder: string;

  beforeAll(async () => {
    const started = (await startServer({ port: 0, returnServer: true })) as { url: string; server: http.Server };
    baseUrl = started.url;
    server = started.server;
    folder = realpathSync(mkdtempSync(path.join(tmpdir(), 'pixo-files-burst-')));
    await writeFile(path.join(folder, 'index.html'), '<!doctype html>');
    for (const dir of ['frames', 'derived']) {
      await mkdir(path.join(folder, dir));
      for (let i = 0; i < 100; i++) await writeFile(path.join(folder, dir, `report-${i}.json`), '{}');
    }
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(folder, { recursive: true, force: true });
  });

  it('shares scans among concurrent requests and still answers each with files written before it asked', async () => {
    const imported = await fetch(`${baseUrl}/api/import/folder`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseDir: folder }),
    });
    expect(imported.status).toBe(200);
    const { project } = (await imported.json()) as { project: { id: string } };
    const url = `${baseUrl}/api/projects/${project.id}/files`;

    let release!: () => void;
    scans.hold = new Promise<void>((resolve) => { release = resolve; });
    scans.root = folder.toLowerCase();
    scans.count = 0;

    // One listing is slow (a big game); the workspace keeps asking while it runs.
    const first = fetch(url);
    for (let i = 0; i < 100 && scans.count === 0; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(scans.count).toBe(1);
    await writeFile(path.join(folder, 'written-during-the-scan.png'), 'png');
    const burst = Array.from({ length: 30 }, () => fetch(url));
    await new Promise((resolve) => setTimeout(resolve, 500));
    release();

    const responses = await Promise.all([first, ...burst]);
    const bodies = await Promise.all(responses.map(async (response) => {
      expect(response.status).toBe(200);
      return (await response.json()) as { files: Array<{ name: string }> };
    }));
    expect(bodies[0]!.files.map((file) => file.name)).toContain('frames/report-99.json');
    for (const body of bodies.slice(1)) {
      expect(body.files.map((file) => file.name)).toContain('written-during-the-scan.png');
    }
    // The running scan, plus one shared by everyone who asked while it ran.
    expect(scans.count).toBe(2);
    scans.root = '';
  });
});
