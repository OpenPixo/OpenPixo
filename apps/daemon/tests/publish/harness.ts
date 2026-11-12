import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import type { PublishedGame, RoomsUsage } from '@openpixo/contracts';
import { vi } from 'vitest';
import type { ShareStatusResult } from '../../src/account/publish-cloud.js';
import type { PublishAccount } from '../../src/publish/jobs.js';

export const GAME: PublishedGame = { shareId: 'share-1', url: 'https://play.example/share-1', title: 'My game', version: 1, state: 'live',
  publishedAt: '2026-11-04T00:00:00.000Z', updatedAt: '2026-11-04T00:00:00.000Z', playsThisMonth: 0 };

export const USAGE: RoomsUsage = { month: '2026-11', freeMinutesTotal: 600, freeMinutesUsed: 30, playerMinutes: 30, creditsCharged: 0, monthlyCreditLimit: 500, openRooms: 0 };

export function shareStatus(overrides: Partial<ShareStatusResult> = {}): ShareStatusResult {
  return { game: null, usage: null, paused: { publish: false, rooms: false }, termsAccepted: true, termsUrl: 'https://openpixo.example/sharing-rules',
    limits: { maxPlayers: 8, creditsPerPlayerHour: 5 }, ...overrides };
}

export type UploadReply = number | 'destroy' | { status: number; body: unknown };

/** The Worker's upload endpoint, with a scripted reply per path. It records every byte it accepts. */
export async function fakeUploads() {
  const accepted = new Map<string, { sha256: string; size: number; authorization: string | undefined }>();
  const attempts = new Map<string, number>();
  let script: (relative: string, attempt: number) => UploadReply = () => 204;
  let peak = 0;
  let active = 0;
  const server: Server = createServer((req, res) => {
    void (async () => {
      active += 1;
      peak = Math.max(peak, active);
      const chunks: Buffer[] = [];
      try { for await (const chunk of req) chunks.push(chunk as Buffer); }
      catch { active -= 1; return; }
      const relative = decodeURIComponent(new URL(req.url!, 'http://local').pathname.replace(/^\/upload\/\d+\//u, ''));
      const attempt = (attempts.get(relative) ?? 0) + 1;
      attempts.set(relative, attempt);
      const reply = script(relative, attempt);
      active -= 1;
      if (reply === 'destroy') { req.socket.destroy(); return; }
      if (typeof reply === 'object') {
        res.writeHead(reply.status, { 'Content-Type': 'application/json' }).end(JSON.stringify(reply.body));
        return;
      }
      if (reply === 204) {
        const body = Buffer.concat(chunks);
        accepted.set(relative, { sha256: createHash('sha256').update(body).digest('hex'), size: body.length, authorization: req.headers.authorization });
      }
      res.writeHead(reply).end();
    })();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as { port: number };
  return {
    baseUrl: `http://127.0.0.1:${port}/upload`, accepted, attempts,
    get peak() { return peak; },
    setScript(next: typeof script) { script = next; },
    async close() {
      server.closeAllConnections();
      await new Promise<void>(resolve => { server.close(() => resolve()); });
    },
  };
}

export function fakeAccount(baseUrl: string) {
  return {
    assertConfigured: vi.fn<PublishAccount['assertConfigured']>(),
    hasSession: vi.fn<PublishAccount['hasSession']>(async () => true),
    shareStatus: vi.fn<PublishAccount['shareStatus']>(async () => shareStatus()),
    publishBegin: vi.fn<PublishAccount['publishBegin']>(async input => ({ shareId: input.shareId ?? 'share-1', version: 2, uploadBaseUrl: baseUrl, uploadToken: 'upload-token', url: GAME.url })),
    publishFinish: vi.fn<PublishAccount['publishFinish']>(async () => GAME),
    shareRemove: vi.fn<PublishAccount['shareRemove']>(async () => {}),
    shareLimit: vi.fn<PublishAccount['shareLimit']>(async () => USAGE),
  };
}

export async function writeGameFiles(projectDir: string, files: Record<string, string> = { 'dist/index.html': '<canvas></canvas>', 'dist/assets/game.js': 'run()', 'dist/assets/hero sprite.png': 'png' }): Promise<void> {
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(projectDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents);
  }
}
