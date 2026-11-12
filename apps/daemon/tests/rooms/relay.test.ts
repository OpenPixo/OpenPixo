import { ROOM_MAX_MESSAGE_BYTES, ROOM_PROTOCOL_VERSION, type RoomServerMessage } from '@openpixo/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { LOCAL_RELAY_LIMITS, LocalRoomsRelay } from '../../src/rooms/relay.js';

let at: number;
let relay: LocalRoomsRelay;

interface Client { messages: RoomServerMessage[]; ended: boolean; session: string; id: string }

function code(hostMigration = false): string {
  const room = relay.create({ v: ROOM_PROTOCOL_VERSION, hostMigration });
  if (!room.ok) throw new Error(room.reason);
  return room.code;
}

function join(roomCode: string): Client {
  const client: Client = { messages: [], ended: false, session: '', id: '' };
  const result = relay.join(roomCode, ROOM_PROTOCOL_VERSION, { send: message => client.messages.push(message), end: () => { client.ended = true; } });
  if (!result.ok) throw new Error(result.reason);
  client.session = result.session;
  client.id = result.playerId;
  return client;
}

const send = (client: Client, to: string, d: unknown) => relay.receive(client.session, JSON.stringify({ t: 'send', to, d }));
const last = (client: Client) => client.messages.at(-1);

beforeEach(() => {
  at = 1_000_000;
  relay = new LocalRoomsRelay(() => at);
});

describe('joining', () => {
  it('uses unambiguous 6-character codes', () => {
    for (let index = 0; index < 20; index += 1) expect(code()).toMatch(/^[A-HJKMNP-Z2-9]{6}$/u);
  });

  it('makes the first joiner host, and welcomes later ones with the room as it is', () => {
    const roomCode = code();
    const host = join(roomCode);
    expect(host.messages).toEqual([{ t: 'welcome', v: ROOM_PROTOCOL_VERSION, you: 'p1', host: 'p1', players: ['p1'], code: roomCode, maxPlayers: 8 }]);
    const guest = join(roomCode);
    expect(guest.messages[0]).toMatchObject({ t: 'welcome', you: 'p2', host: 'p1', players: ['p1', 'p2'] });
    expect(last(host)).toEqual({ t: 'join', id: 'p2' });
  });

  it('refuses a full room, an unknown code, a closed room and a wrong version', () => {
    const roomCode = code();
    for (let index = 0; index < LOCAL_RELAY_LIMITS.maxPlayers; index += 1) join(roomCode);
    const connection = { send: () => {}, end: () => {} };
    expect(relay.join(roomCode, ROOM_PROTOCOL_VERSION, connection)).toEqual({ ok: false, reason: 'room-full' });
    expect(relay.join('ZZZZZZ', ROOM_PROTOCOL_VERSION, connection)).toEqual({ ok: false, reason: 'room-not-found' });
    expect(relay.join(roomCode, ROOM_PROTOCOL_VERSION + 1, connection)).toEqual({ ok: false, reason: 'protocol-mismatch' });
    const closing = code();
    relay.disconnect(join(closing).session);
    expect(relay.join(closing, ROOM_PROTOCOL_VERSION, connection)).toEqual({ ok: false, reason: 'room-closed' });
  });

  it('refuses to create with a wrong version, or past the room cap', () => {
    expect(relay.create({ v: ROOM_PROTOCOL_VERSION + 1 })).toEqual({ ok: false, reason: 'protocol-mismatch' });
    expect(relay.create(null)).toEqual({ ok: false, reason: 'protocol-mismatch' });
    for (let index = 0; index < LOCAL_RELAY_LIMITS.maxRooms; index += 1) join(code());
    expect(relay.create({ v: ROOM_PROTOCOL_VERSION })).toEqual({ ok: false, reason: 'too-many-rooms' });
  });

  it('never reuses a player id in a room', () => {
    const roomCode = code();
    join(roomCode);
    const guest = join(roomCode);
    relay.disconnect(guest.session);
    expect(join(roomCode).id).toBe('p3');
  });
});

describe('messages', () => {
  let host: Client, a: Client, b: Client;
  beforeEach(() => {
    const roomCode = code();
    host = join(roomCode); a = join(roomCode); b = join(roomCode);
  });

  it('sends to everyone else, to the host, and to one player', () => {
    send(a, 'all', 1);
    expect(last(host)).toEqual({ t: 'msg', from: 'p2', d: 1 });
    expect(last(b)).toEqual({ t: 'msg', from: 'p2', d: 1 });
    expect(a.messages.some(message => message.t === 'msg')).toBe(false);
    send(b, 'host', 2);
    expect(last(host)).toEqual({ t: 'msg', from: 'p3', d: 2 });
    send(host, 'p3', 3);
    expect(last(b)).toEqual({ t: 'msg', from: 'p1', d: 3 });
    expect(a.messages.filter(message => message.t === 'msg')).toEqual([]);
  });

  it('drops a message to someone who left without an error', () => {
    send(a, 'p9', 1);
    expect(a.messages.some(message => message.t === 'warn')).toBe(false);
  });

  it('warns about a message over the size limit and does not deliver it', () => {
    const before = b.messages.length;
    const large = JSON.stringify({ t: 'send', to: 'all', d: 'x'.repeat(ROOM_MAX_MESSAGE_BYTES) });
    relay.receive(a.session, large);
    expect(last(a)).toEqual({ t: 'warn', code: 'too-large' });
    expect(b.messages).toHaveLength(before);
    relay.receive(a.session, { tooLarge: true });
    expect(last(a)).toEqual({ t: 'warn', code: 'too-large' });
  });

  it('counts bytes, not characters', () => {
    const wide = 'é'.repeat(ROOM_MAX_MESSAGE_BYTES / 2);
    relay.receive(a.session, JSON.stringify({ t: 'send', to: 'all', d: wide }));
    expect(last(a)).toEqual({ t: 'warn', code: 'too-large' });
  });

  it.each(['not json', '42', 'null', '{"t":"nope"}', '{"t":"send"}', '{"t":"send","to":""}'])('warns about the bad message %s', raw => {
    relay.receive(a.session, raw);
    expect(last(a)).toEqual({ t: 'warn', code: 'bad-message' });
  });

  it('lets only the host close the room', () => {
    relay.receive(a.session, '{"t":"close"}');
    expect(last(a)).toEqual({ t: 'warn', code: 'not-host' });
    expect(relay.roomCount).toBe(1);
    relay.receive(host.session, '{"t":"close"}');
    for (const client of [host, a, b]) {
      expect(last(client)).toEqual({ t: 'closing', reason: 'closed-by-host' });
      expect(client.ended).toBe(true);
    }
    expect(relay.roomCount).toBe(0);
  });

  it('answers false for an unknown session', () => {
    expect(relay.receive('nobody', '{}')).toBe(false);
  });

  it('allows 60 a second, drops the excess with one warning, and starts again next second', () => {
    for (let index = 0; index < LOCAL_RELAY_LIMITS.messagesPerSecond + 5; index += 1) send(a, 'host', index);
    expect(host.messages.filter(message => message.t === 'msg')).toHaveLength(LOCAL_RELAY_LIMITS.messagesPerSecond);
    expect(a.messages.filter(message => message.t === 'warn')).toEqual([{ t: 'warn', code: 'too-fast' }]);
    at += 1000;
    send(a, 'host', 'later');
    expect(last(host)).toEqual({ t: 'msg', from: 'p2', d: 'later' });
  });

  it('closes the connection of a player who keeps going too fast, and only theirs', () => {
    for (let second = 0; second <= LOCAL_RELAY_LIMITS.sustainedOverLimitSeconds && !a.ended; second += 1) {
      for (let index = 0; index < LOCAL_RELAY_LIMITS.messagesPerSecond + 1 && !a.ended; index += 1) send(a, 'host', index);
      at += 1000;
    }
    expect(a.ended).toBe(true);
    expect(last(host)).toEqual({ t: 'leave', id: 'p2' });
    expect(relay.roomCount).toBe(1);
    expect(host.ended).toBe(false);
  });
});

describe('leaving', () => {
  it('closes the room with host-left when the host goes', () => {
    const roomCode = code();
    const host = join(roomCode), guest = join(roomCode);
    relay.disconnect(host.session);
    expect(last(guest)).toEqual({ t: 'closing', reason: 'host-left' });
    expect(guest.ended).toBe(true);
    expect(relay.roomCount).toBe(0);
  });

  it('tells the others when a guest goes, and the room stays', () => {
    const roomCode = code();
    const host = join(roomCode), guest = join(roomCode);
    relay.disconnect(guest.session);
    expect(last(host)).toEqual({ t: 'leave', id: 'p2' });
    expect(relay.roomCount).toBe(1);
    relay.disconnect(guest.session);
    expect(host.messages.filter(message => message.t === 'leave')).toHaveLength(1);
  });

  it('moves the host to the earliest remaining player with migration on', () => {
    const roomCode = code(true);
    const host = join(roomCode), second = join(roomCode), third = join(roomCode);
    relay.disconnect(host.session);
    expect(second.messages.slice(-2)).toEqual([{ t: 'leave', id: 'p1' }, { t: 'host', id: 'p2' }]);
    expect(last(third)).toEqual({ t: 'host', id: 'p2' });
    relay.receive(second.session, '{"t":"close"}');
    expect(last(third)).toEqual({ t: 'closing', reason: 'closed-by-host' });
  });

  it('lets a refreshing host return to an empty migrating room within 60 seconds', () => {
    const roomCode = code(true);
    relay.disconnect(join(roomCode).session);
    at += LOCAL_RELAY_LIMITS.emptyMs - 1;
    relay.sweep();
    const back = join(roomCode);
    expect(back.messages[0]).toMatchObject({ t: 'welcome', you: 'p2', host: 'p2' });
  });
});

describe('cleanup', () => {
  it('closes an empty room after 60 seconds', () => {
    const empty = code();
    at += LOCAL_RELAY_LIMITS.emptyMs - 1;
    relay.sweep();
    expect(relay.roomCount).toBe(1);
    at += 1;
    relay.sweep();
    expect(relay.roomCount).toBe(0);
    expect(relay.join(empty, ROOM_PROTOCOL_VERSION, { send: () => {}, end: () => {} })).toEqual({ ok: false, reason: 'room-closed' });
  });

  it('closes a room nobody has messaged for 10 minutes', () => {
    const roomCode = code();
    const host = join(roomCode), guest = join(roomCode);
    at += LOCAL_RELAY_LIMITS.idleMs - 1000;
    send(host, 'all', 'still here');
    at += LOCAL_RELAY_LIMITS.idleMs - 1;
    relay.sweep();
    expect(guest.ended).toBe(false);
    at += 1;
    relay.sweep();
    expect(last(guest)).toEqual({ t: 'closing', reason: 'idle' });
  });

  it('closes any room at 4 hours', () => {
    const roomCode = code();
    const host = join(roomCode), guest = join(roomCode);
    for (let elapsed = 0; elapsed < LOCAL_RELAY_LIMITS.maxDurationMs; elapsed += LOCAL_RELAY_LIMITS.idleMs / 2) {
      at += LOCAL_RELAY_LIMITS.idleMs / 2;
      if (elapsed + LOCAL_RELAY_LIMITS.idleMs / 2 < LOCAL_RELAY_LIMITS.maxDurationMs) send(host, 'all', 'x');
      relay.sweep();
    }
    expect(last(guest)).toEqual({ t: 'closing', reason: 'max-duration' });
  });

  it('frees memory on dispose and ends every connection', () => {
    const roomCode = code();
    const host = join(roomCode);
    relay.dispose();
    expect(host.ended).toBe(true);
    expect(relay.roomCount).toBe(0);
    expect(relay.receive(host.session, '{}')).toBe(false);
  });
});
