import { request as httpRequest, type Server } from 'node:http';
import express from 'express';
import { ROOM_MAX_MESSAGE_BYTES, ROOM_PROTOCOL_VERSION, type RoomServerMessage } from '@openpixo/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_ROOMS_RELAY_PATH, registerLocalRoomsRelay, type LocalRoomsRelayHandle } from '../../src/routes/rooms-local.js';

let server: Server;
let base: string;
let handle: LocalRoomsRelayHandle;
const open: Stream[] = [];

interface Stream { messages: RoomServerMessage[]; session: string; controller: AbortController; ended: Promise<void> }

const relayUrl = () => `${base}${LOCAL_ROOMS_RELAY_PATH}`;

async function createRoom(body: object = { v: ROOM_PROTOCOL_VERSION }, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${relayUrl()}/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
}

async function roomCode(hostMigration = false): Promise<string> {
  const created = await (await createRoom({ v: ROOM_PROTOCOL_VERSION, hostMigration })).json() as { ok: true; code: string };
  return created.code;
}

async function connect(code: string, version = ROOM_PROTOCOL_VERSION): Promise<Stream> {
  const controller = new AbortController();
  const response = await fetch(`${relayUrl()}/rooms/${code}/events?v=${version}`, { signal: controller.signal });
  expect(response.headers.get('content-type')).toContain('text/event-stream');
  const stream: Stream = { messages: [], session: '', controller, ended: Promise.resolve() };
  const decoder = new TextDecoder();
  let buffer = '';
  stream.ended = (async () => {
    try {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });
        let boundary: number;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = frame.split('\n').find(line => line.startsWith('data: '))?.slice(6);
          if (!data) continue;
          if (frame.startsWith('event: session')) stream.session = (JSON.parse(data) as { session: string }).session;
          else stream.messages.push(JSON.parse(data) as RoomServerMessage);
        }
      }
    } catch { /* Aborted by the test. */ }
  })();
  open.push(stream);
  return stream;
}

const post = (code: string, stream: Stream, body: string) => fetch(`${relayUrl()}/rooms/${code}/send?session=${encodeURIComponent(stream.session)}`, { method: 'POST', body });

const seen = (stream: Stream, match: Partial<RoomServerMessage>) => vi.waitFor(() => {
  expect(stream.messages).toContainEqual(expect.objectContaining(match));
});

beforeEach(async () => {
  const app = express();
  handle = registerLocalRoomsRelay(app);
  // Proves the relay answers ahead of what production registers after it.
  app.use('/api', (_req, res) => { res.status(403).json({ error: 'Cross-origin requests are not allowed' }); });
  server = await new Promise<Server>(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterEach(async () => {
  for (const stream of open.splice(0)) stream.controller.abort();
  handle.stop();
  server.closeAllConnections();
  await new Promise<void>(resolve => { server.close(() => resolve()); });
});

describe('protocol over POST and SSE', () => {
  it('delivers both ways between two clients', async () => {
    const code = await roomCode();
    const host = await connect(code);
    await seen(host, { t: 'welcome', you: 'p1' });
    const guest = await connect(code);
    await seen(guest, { t: 'welcome', you: 'p2', host: 'p1' });
    await seen(host, { t: 'join', id: 'p2' });
    expect(guest.session).not.toBe('');
    expect((await post(code, guest, JSON.stringify({ t: 'send', to: 'host', d: { hello: 1 } }))).status).toBe(204);
    await seen(host, { t: 'msg', from: 'p2', d: { hello: 1 } });
    await post(code, host, JSON.stringify({ t: 'send', to: 'all', d: 'state' }));
    await seen(guest, { t: 'msg', from: 'p1', d: 'state' });
  });

  it('closes the room when the host goes away, and ends the guest stream', async () => {
    const code = await roomCode();
    const host = await connect(code);
    await seen(host, { t: 'welcome' });
    const guest = await connect(code);
    await seen(guest, { t: 'welcome' });
    host.controller.abort();
    await seen(guest, { t: 'closing', reason: 'host-left' });
    await guest.ended;
    expect((await post(code, guest, '{"t":"send","to":"all","d":1}')).status).toBe(410);
  });

  it('moves the host when the room allows it', async () => {
    const code = await roomCode(true);
    const host = await connect(code);
    await seen(host, { t: 'welcome' });
    const guest = await connect(code);
    await seen(guest, { t: 'welcome' });
    host.controller.abort();
    await seen(guest, { t: 'leave', id: 'p1' });
    await seen(guest, { t: 'host', id: 'p2' });
  });

  it('refuses a ninth player over the stream, and ends it', async () => {
    const code = await roomCode();
    const players: Stream[] = [];
    for (let index = 0; index < 8; index += 1) {
      const player = await connect(code);
      await seen(player, { t: 'welcome' });
      players.push(player);
    }
    const ninth = await connect(code);
    await ninth.ended;
    expect(ninth.messages).toEqual([{ t: 'refused', reason: 'room-full' }]);
    expect(ninth.session).toBe('');
  });

  it.each([
    ['AAAAAA', ROOM_PROTOCOL_VERSION, 'room-not-found'],
    ['bad-code', ROOM_PROTOCOL_VERSION, 'room-not-found'],
  ])('refuses the code %s', async (code, version, reason) => {
    const stream = await connect(code, version);
    await stream.ended;
    expect(stream.messages).toEqual([{ t: 'refused', reason }]);
  });

  it('refuses a mismatched protocol on create and on join', async () => {
    expect(await (await createRoom({ v: 99 })).json()).toEqual({ ok: false, reason: 'protocol-mismatch' });
    const stream = await connect(await roomCode(), 99);
    await stream.ended;
    expect(stream.messages).toEqual([{ t: 'refused', reason: 'protocol-mismatch' }]);
  });

  it.each([
    ['just over the limit', ROOM_MAX_MESSAGE_BYTES + 1],
    ['far over the limit', ROOM_MAX_MESSAGE_BYTES * 8],
  ])('warns about a message %s and keeps the connection', async (_name, size) => {
    const code = await roomCode();
    const host = await connect(code);
    await seen(host, { t: 'welcome' });
    expect((await post(code, host, 'x'.repeat(size))).status).toBe(204);
    await seen(host, { t: 'warn', code: 'too-large' });
    await post(code, host, '{"t":"close"}');
    await seen(host, { t: 'closing', reason: 'closed-by-host' });
  });

  it('refuses another room\'s session', async () => {
    const first = await roomCode();
    const host = await connect(first);
    await seen(host, { t: 'welcome' });
    expect((await post(await roomCode(), host, '{"t":"close"}')).status).toBe(410);
  });

  it('survives a malformed create body', async () => {
    const response = await fetch(`${relayUrl()}/rooms`, { method: 'POST', body: 'not json' });
    expect(await response.json()).toEqual({ ok: false, reason: 'protocol-mismatch' });
  });

  it('ends every stream when the daemon stops', async () => {
    const code = await roomCode();
    const host = await connect(code);
    await seen(host, { t: 'welcome' });
    handle.stop();
    await host.ended;
    expect(host.messages.some(message => message.t === 'closing')).toBe(false);
  });
});

describe('who may call it', () => {
  it.each(['http://127.0.0.1:5173', 'http://localhost:5173', 'http://[::1]:5173'])('answers a page on %s with CORS', async origin => {
    const response = await createRoom(undefined, { Origin: origin });
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe(origin);
    expect(response.headers.get('vary')).toContain('Origin');
  });

  it('answers the preflight a JSON post needs', async () => {
    const response = await fetch(`${relayUrl()}/rooms`, { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect(response.headers.get('access-control-allow-methods')).toContain('POST');
    expect(response.headers.get('access-control-allow-headers')).toContain('Content-Type');
  });

  it.each(['https://evil.example', 'http://evil.example:5173', 'null', 'http://127.0.0.1.evil.example'])('refuses a page on %s on every route', async origin => {
    const code = await roomCode();
    const host = await connect(code);
    await seen(host, { t: 'welcome' });
    const replies = await Promise.all([
      createRoom(undefined, { Origin: origin }),
      fetch(`${relayUrl()}/rooms/${code}/events?v=1`, { headers: { Origin: origin } }),
      fetch(`${relayUrl()}/rooms/${code}/send?session=${host.session}`, { method: 'POST', headers: { Origin: origin }, body: '{"t":"close"}' }),
      fetch(`${relayUrl()}/rooms`, { method: 'OPTIONS', headers: { Origin: origin } }),
    ]);
    for (const reply of replies) {
      expect(reply.status).toBe(403);
      expect(reply.headers.get('access-control-allow-origin')).toBeNull();
    }
    expect(handle.relay.roomCount).toBe(1);
  });

  it('refuses a rebinding Host header', async () => {
    const { port } = server.address() as { port: number };
    const status = await new Promise<number>((resolve, reject) => {
      const request = httpRequest({ host: '127.0.0.1', port, path: `${LOCAL_ROOMS_RELAY_PATH}/rooms`, method: 'POST', headers: { Host: 'evil.example' } }, response => {
        response.resume();
        resolve(response.statusCode!);
      });
      request.on('error', reject);
      request.end('{}');
    });
    expect(status).toBe(403);
  });
});
