import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import express from 'express';
import { ROOM_MAX_MESSAGE_BYTES } from '@openpixo/contracts';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_ROOMS_RELAY_PATH, registerLocalRoomsRelay, type LocalRoomsRelayHandle } from '../../src/routes/rooms-local.js';
import { renderRoomsSdk, ROOMS_SDK_RELATIVE_PATH } from '../../src/rooms/sdk-install.js';

const SDK_DIR = path.resolve(import.meta.dirname, '../../../../game-sdk');

/** The public surface, typed here so this runs the real installed JavaScript and not a TypeScript import. */
interface RoomLike {
  code: string; you: string; host: string; isHost: boolean; players: string[];
  inviteUrl(): string; send(data: unknown): void; sendTo(id: string, data: unknown): void; sendToHost(data: unknown): void;
  close(): void; leave(): void;
  on(event: string, listener: (value: any) => void): () => void;
}
interface Sdk {
  createRoom(options?: { hostMigration?: boolean }): Promise<RoomLike>;
  joinRoom(code: string): Promise<RoomLike>;
  joinFromUrl(): Promise<RoomLike | null>;
  RoomError: new (code: string, message: string) => Error & { code: string };
}

let sdk: Sdk;
let directory: string;
let server: Server;
let base: string;
let relay: string;
let handle: LocalRoomsRelayHandle;
const rooms: RoomLike[] = [];

const stubPage = (href: string) => vi.stubGlobal('location', { href });

function track<T extends RoomLike>(room: T): T { rooms.push(room); return room; }

function events(room: RoomLike, name: string): any[] {
  const seen: any[] = [];
  room.on(name, value => seen.push(value));
  return seen;
}

const eventually = (assertion: () => void) => vi.waitFor(assertion);

beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'openpixo-sdk-run-'));
  const file = path.join(directory, 'openpixo-rooms.mjs');
  await writeFile(file, renderRoomsSdk(await readFile(path.join(SDK_DIR, ROOMS_SDK_RELATIVE_PATH), 'utf8'), 'js'));
  sdk = await import(/* @vite-ignore */ pathToFileURL(file).href) as Sdk;
});

afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

beforeEach(async () => {
  const app = express();
  handle = registerLocalRoomsRelay(app);
  server = await new Promise<Server>(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  relay = `${base}${LOCAL_ROOMS_RELAY_PATH}`;
  stubPage(`http://127.0.0.1:5173/?pixoRooms=${encodeURIComponent(relay)}`);
});

afterEach(async () => {
  for (const room of rooms.splice(0)) room.leave();
  handle.stop();
  server.closeAllConnections();
  await new Promise<void>(resolve => { server.close(() => resolve()); });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('rooms over the local relay', () => {
  it('creates a room, joins by code and exchanges every kind of message', async () => {
    const host = track(await sdk.createRoom());
    expect(host).toMatchObject({ you: 'p1', host: 'p1', isHost: true, players: ['p1'] });
    expect(host.code).toMatch(/^[A-Z0-9]{6}$/u);
    const joined = events(host, 'playerJoined');
    const atHost = events(host, 'message');

    const guest = track(await sdk.joinRoom(` ${host.code.toLowerCase()} `));
    expect(guest).toMatchObject({ code: host.code, you: 'p2', host: 'p1', isHost: false, players: ['p1', 'p2'] });
    const atGuest = events(guest, 'message');
    await eventually(() => { expect(joined).toEqual([{ id: 'p2' }]); });
    expect(host.players).toEqual(['p1', 'p2']);

    guest.sendToHost({ input: 'left' });
    await eventually(() => { expect(atHost).toEqual([{ from: 'p2', data: { input: 'left' } }]); });
    host.send({ state: 1 });
    await eventually(() => { expect(atGuest).toEqual([{ from: 'p1', data: { state: 1 } }]); });
    host.sendTo('p2', 'direct');
    await eventually(() => { expect(atGuest).toContainEqual({ from: 'p1', data: 'direct' }); });
  });

  it('keeps a player\'s messages in order', async () => {
    const host = track(await sdk.createRoom());
    const guest = track(await sdk.joinRoom(host.code));
    const received = events(host, 'message');
    for (let index = 0; index < 40; index += 1) guest.sendToHost(index);
    await eventually(() => { expect(received).toHaveLength(40); });
    expect(received.map(item => item.data)).toEqual(Array.from({ length: 40 }, (_, index) => index));
  });

  it('delivers the host\'s own sendToHost as a message, without touching the network', async () => {
    const host = track(await sdk.createRoom());
    const received = events(host, 'message');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    host.sendToHost({ dx: 1 });
    await eventually(() => { expect(received).toEqual([{ from: 'p1', data: { dx: 1 } }]); });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('tells the guest when the host leaves', async () => {
    const host = track(await sdk.createRoom());
    const guest = track(await sdk.joinRoom(host.code));
    const closed = events(guest, 'closed');
    const hostClosed = events(host, 'closed');
    host.leave();
    expect(hostClosed).toEqual([{ reason: 'left', message: 'You left the room.' }]);
    await eventually(() => { expect(closed).toEqual([{ reason: 'host-left', message: 'The host left, so the room closed.' }]); });
  });

  it('moves the host with migration on', async () => {
    const host = track(await sdk.createRoom({ hostMigration: true }));
    const guest = track(await sdk.joinRoom(host.code));
    const changed = events(guest, 'hostChanged');
    const left = events(guest, 'playerLeft');
    host.leave();
    await eventually(() => { expect(changed).toEqual([{ id: 'p2' }]); });
    expect(left).toEqual([{ id: 'p1' }]);
    expect(guest).toMatchObject({ host: 'p2', isHost: true, players: ['p2'] });
  });

  it('lets the host close the room for everyone, and refuses a guest', async () => {
    const host = track(await sdk.createRoom());
    const guest = track(await sdk.joinRoom(host.code));
    const closed = events(guest, 'closed');
    expect(() => guest.close()).toThrow(/Only the host/u);
    host.close();
    await eventually(() => { expect(closed[0]).toMatchObject({ reason: 'closed-by-host' }); });
    await expect(sdk.joinRoom(host.code)).rejects.toMatchObject({ code: 'room-closed', message: expect.stringContaining('has closed') });
  });

  it('reports a lost connection', async () => {
    const host = track(await sdk.createRoom());
    const guest = track(await sdk.joinRoom(host.code));
    const closed = events(guest, 'closed');
    handle.relay.dispose();
    await eventually(() => { expect(closed[0]).toMatchObject({ reason: 'connection-lost' }); });
  });

  it('lets a player who left rejoin the live room as a new player, as the skill tells games to do', async () => {
    const host = track(await sdk.createRoom());
    const guest = track(await sdk.joinRoom(host.code));
    guest.leave();
    const back = track(await sdk.joinRoom(host.code));
    expect(back.you).toBe('p3');
    expect(back.players).toEqual(['p1', 'p3']);
  });


  it('warns once and stops sending after the room closed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const host = track(await sdk.createRoom());
    host.leave();
    host.send(1); host.send(2);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('throws on a message over the limit before sending it', async () => {
    const host = track(await sdk.createRoom());
    expect(() => host.send('x'.repeat(ROOM_MAX_MESSAGE_BYTES))).toThrow(/limit is 16384/u);
  });

  it('reports a warning from the server in plain words', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const host = track(await sdk.createRoom());
    const guest = track(await sdk.joinRoom(host.code));
    for (let index = 0; index < 70; index += 1) guest.sendToHost(index);
    await eventually(() => { expect(warn.mock.calls.flat().join()).toContain('more than 60 a second'); });
  });

  it('keeps early events for listeners attached right after the await', async () => {
    const host = track(await sdk.createRoom());
    const joining = sdk.joinRoom(host.code);
    const joined = events(host, 'playerJoined');
    const guest = track(await joining);
    await eventually(() => { expect(joined).toEqual([{ id: 'p2' }]); });
    expect(guest.players).toEqual(['p1', 'p2']);
  });
});

describe('invites', () => {
  it('builds a link that keeps the relay, and joinFromUrl follows it', async () => {
    const host = track(await sdk.createRoom());
    const invite = new URL(host.inviteUrl());
    expect(invite.searchParams.get('room')).toBe(host.code);
    expect(invite.searchParams.get('pixoRooms')).toBe(relay);
    stubPage(invite.href);
    const guest = track((await sdk.joinFromUrl())!);
    expect(guest).toMatchObject({ code: host.code, you: 'p2' });
  });

  it('resolves to null when the page names no room', async () => {
    expect(await sdk.joinFromUrl()).toBeNull();
  });
});

describe('refusals', () => {
  it.each([
    ['AAAAAA', 'room-not-found', 'No room has that code'],
  ])('explains the code %s', async (code, reason, message) => {
    await expect(sdk.joinRoom(code)).rejects.toMatchObject({ code: reason, message: expect.stringContaining(message) });
  });

  it.each(['', 'ABC', 'TOOLONGCODE', 'AB CD!'])('rejects the code %j without a request', async code => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(sdk.joinRoom(code)).rejects.toMatchObject({ code: 'room-not-found', message: expect.stringContaining('6 letters') });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('explains a full room', async () => {
    const host = track(await sdk.createRoom());
    for (let index = 0; index < 7; index += 1) track(await sdk.joinRoom(host.code));
    await expect(sdk.joinRoom(host.code)).rejects.toMatchObject({ code: 'room-full', message: 'That room is full.' });
  });

  it('points at pixo rooms test on a local page with no relay', async () => {
    stubPage('http://localhost:5173/');
    await expect(sdk.createRoom()).rejects.toMatchObject({ code: 'relay-missing', message: expect.stringContaining('pixo rooms test') });
    await expect(sdk.createRoom()).rejects.toMatchObject({ message: expect.not.stringContaining('relay') });
    await expect(sdk.joinRoom('ABCDEF')).rejects.toMatchObject({ code: 'relay-missing' });
  });

  it('refuses a relay address that is not on this computer', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    stubPage('http://localhost:5173/?pixoRooms=https://evil.example/relay');
    await expect(sdk.createRoom()).rejects.toMatchObject({ code: 'relay-invalid' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('explains an unreachable relay, naming the fresh-URL fix', async () => {
    stubPage(`http://127.0.0.1:5173/?pixoRooms=${encodeURIComponent('http://127.0.0.1:1/api/rooms/local')}`);
    await expect(sdk.createRoom()).rejects.toMatchObject({ code: 'relay-unreachable', message: expect.stringContaining('pixo rooms test') });
    await expect(sdk.createRoom()).rejects.toMatchObject({ message: expect.not.stringContaining('relay') });
  });
});

describe('hosted backend', () => {
  class FakeSocket {
    static OPEN = 1; static CONNECTING = 0;
    static last: FakeSocket;
    readyState = FakeSocket.CONNECTING;
    sent: string[] = [];
    private listeners: Record<string, ((event: any) => void)[]> = {};
    constructor(readonly url: string) { FakeSocket.last = this; }
    addEventListener(name: string, listener: (event: any) => void) { (this.listeners[name] ??= []).push(listener); }
    send(text: string) { this.sent.push(text); }
    close() { this.readyState = 3; }
    fire(name: string, event: unknown = {}) { for (const listener of this.listeners[name] ?? []) listener(event); }
    message(value: unknown) { this.fire('message', { data: JSON.stringify(value) }); }
  }

  const welcome = { t: 'welcome', v: 1, you: 'p1', host: 'p1', players: ['p1'], code: 'ABC234', maxPlayers: 8 };

  function hostedFetch(reply: unknown, config: unknown = { v: 1, shareUrl: 'https://play.example/share-1', maxPlayers: 8 }) {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, ...(init ? { init } : {}) });
      if (url === '/__openpixo/config.json') return Response.json(config);
      if (url === '/__rooms') return Response.json(reply);
      throw new Error(`unexpected ${url}`);
    }));
    return calls;
  }

  beforeEach(() => {
    FakeSocket.last = undefined as unknown as FakeSocket;
    stubPage('https://share-1.play.example/index.html');
    vi.stubGlobal('WebSocket', FakeSocket);
  });

  it('posts to /__rooms, connects over wss and sends the wire protocol', async () => {
    const calls = hostedFetch({ ok: true, code: 'ABC234', maxPlayers: 8 });
    const opening = sdk.createRoom({ hostMigration: true });
    await eventually(() => { expect(FakeSocket.last?.url).toBe('wss://share-1.play.example/__rooms/ABC234?v=1'); });
    expect(calls[0]).toMatchObject({ url: '/__rooms', init: { method: 'POST' } });
    expect(JSON.parse(calls[0]!.init!.body as string)).toEqual({ v: 1, hostMigration: true });
    const socket = FakeSocket.last;
    socket.readyState = FakeSocket.OPEN;
    socket.fire('open');
    socket.message(welcome);
    const room = track(await opening);
    expect(room).toMatchObject({ code: 'ABC234', you: 'p1', isHost: true });
    room.send({ a: 1 });
    expect(JSON.parse(socket.sent[0]!)).toEqual({ t: 'send', to: 'all', d: { a: 1 } });
    room.close();
    expect(JSON.parse(socket.sent[1]!)).toEqual({ t: 'close' });
  });

  it('invites through the public link, not the game frame', async () => {
    hostedFetch({ ok: true, code: 'ABC234', maxPlayers: 8 });
    const opening = sdk.createRoom();
    await eventually(() => { expect(FakeSocket.last?.url).toContain('ABC234'); });
    FakeSocket.last.message(welcome);
    expect((await opening).inviteUrl()).toBe('https://play.example/share-1/ABC234');
  });

  it('falls back to the page when the config is missing', async () => {
    hostedFetch({ ok: true, code: 'ABC234', maxPlayers: 8 }, {});
    const opening = sdk.createRoom();
    await eventually(() => { expect(FakeSocket.last?.url).toContain('ABC234'); });
    FakeSocket.last.message(welcome);
    expect((await opening).inviteUrl()).toBe('https://share-1.play.example/index.html?room=ABC234');
  });

  it.each([
    ['paused', 'not open yet'],
    ['game-unavailable', 'not available for this game'],
    ['out-of-credits', 'out of credits'],
    ['limit-reached', 'spending limit'],
    ['too-many-rooms', 'Too many rooms'],
    ['protocol-mismatch', 'Refresh the page'],
    ['unavailable', 'Try again in a minute'],
  ])('explains the create refusal %s', async (reason, message) => {
    hostedFetch({ ok: false, reason });
    await expect(sdk.createRoom()).rejects.toMatchObject({ code: reason, message: expect.stringContaining(message) });
  });

  it.each([
    ['room-not-found', 'No room has that code'],
    ['room-full', 'full'],
    ['room-closed', 'has closed'],
    ['protocol-mismatch', 'Refresh the page'],
  ])('explains the join refusal %s', async (reason, message) => {
    hostedFetch({});
    const joining = sdk.joinRoom('ABC234');
    FakeSocket.last.message({ t: 'refused', reason });
    await expect(joining).rejects.toMatchObject({ code: reason, message: expect.stringContaining(message) });
  });

  it('explains a socket that closes before the welcome', async () => {
    hostedFetch({});
    const joining = sdk.joinRoom('ABC234');
    FakeSocket.last.fire('close');
    await expect(joining).rejects.toMatchObject({ code: 'connection-failed' });
  });

  it.each([
    ['out-of-credits', "ran out of credits"],
    ['limit-reached', 'monthly spending limit'],
    ['idle', 'nobody played'],
    ['max-duration', 'time limit'],
    ['removed', 'no longer available'],
  ])('passes on the closing reason %s', async (reason, message) => {
    hostedFetch({});
    const joining = sdk.joinRoom('ABC234');
    FakeSocket.last.message(welcome);
    const room = track(await joining);
    const closed = events(room, 'closed');
    FakeSocket.last.message({ t: 'closing', reason });
    await eventually(() => { expect(closed[0]).toMatchObject({ reason, message: expect.stringContaining(message) }); });
  });

  it('reports a socket lost after joining, and does not reconnect by itself', async () => {
    hostedFetch({});
    const joining = sdk.joinRoom('ABC234');
    const socket = FakeSocket.last;
    socket.message(welcome);
    const room = track(await joining);
    const closed = events(room, 'closed');
    socket.fire('close');
    await eventually(() => { expect(closed[0]).toMatchObject({ reason: 'connection-lost' }); });
    expect(FakeSocket.last).toBe(socket);
  });

  it('ignores a non-loopback pixoRooms parameter on a published page', async () => {
    stubPage('https://share-1.play.example/?pixoRooms=https://evil.example/');
    const calls = hostedFetch({ ok: false, reason: 'paused' });
    await expect(sdk.createRoom()).rejects.toMatchObject({ code: 'paused' });
    expect(calls[0]!.url).toBe('/__rooms');
  });
});
