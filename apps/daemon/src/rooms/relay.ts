import { randomBytes, randomInt } from 'node:crypto';
import { ROOM_MAX_MESSAGE_BYTES, ROOM_PROTOCOL_VERSION, type RoomClientMessage, type RoomCloseReason, type RoomCreateRequest, type RoomCreateResponse,
  type RoomJoinRefusal, type RoomServerMessage } from '@openpixo/contracts';

/**
 * The hosted Room's behaviour for local testing: same messages, limits and host
 * rules, no billing and no cloud. Local values, independent of the cloud's config.
 */
export const LOCAL_RELAY_LIMITS = {
  maxRooms: 32,
  maxPlayers: 8,
  maxMessageBytes: ROOM_MAX_MESSAGE_BYTES,
  messagesPerSecond: 60,
  /** Whole seconds over the rate limit in a row before that player's connection closes. */
  sustainedOverLimitSeconds: 5,
  idleMs: 10 * 60 * 1000,
  maxDurationMs: 4 * 60 * 60 * 1000,
  emptyMs: 60 * 1000,
  /** Recently closed codes answer `room-closed` rather than `room-not-found`. */
  closedCodesKept: 256,
} as const;

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

export interface RelayConnection {
  send(message: RoomServerMessage): void;
  /** Ends the transport. The relay has already removed this player. */
  end(): void;
}

interface Player {
  id: string;
  session: string;
  connection: RelayConnection;
  windowStart: number;
  windowCount: number;
  warnedThisWindow: boolean;
  overLimitSeconds: number;
}

interface Room {
  code: string;
  hostMigration: boolean;
  players: Player[];
  host: string | null;
  nextPlayer: number;
  createdAt: number;
  lastMessageAt: number;
  emptySince: number | null;
}

export type RelayJoinResult = { ok: true; session: string; playerId: string } | { ok: false; reason: RoomJoinRefusal };

export class LocalRoomsRelay {
  private readonly rooms = new Map<string, Room>();
  private readonly sessions = new Map<string, { room: Room; player: Player }>();
  private readonly closedCodes = new Set<string>();

  constructor(private readonly now: () => number = Date.now) {}

  get roomCount(): number { return this.rooms.size; }

  create(request: Partial<RoomCreateRequest> | null | undefined): RoomCreateResponse {
    if (request?.v !== ROOM_PROTOCOL_VERSION) return { ok: false, reason: 'protocol-mismatch' };
    this.sweep();
    if (this.rooms.size >= LOCAL_RELAY_LIMITS.maxRooms) return { ok: false, reason: 'too-many-rooms' };
    const at = this.now();
    let code: string;
    do { code = Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join(''); }
    while (this.rooms.has(code) || this.closedCodes.has(code));
    this.rooms.set(code, { code, hostMigration: request.hostMigration === true, players: [], host: null, nextPlayer: 1, createdAt: at, lastMessageAt: at, emptySince: at });
    return { ok: true, code, maxPlayers: LOCAL_RELAY_LIMITS.maxPlayers };
  }

  /** The first joiner is host. On success the connection has already received `welcome`. */
  join(code: string, version: number, connection: RelayConnection): RelayJoinResult {
    if (version !== ROOM_PROTOCOL_VERSION) return { ok: false, reason: 'protocol-mismatch' };
    this.sweep();
    const room = this.rooms.get(code);
    if (!room) return { ok: false, reason: this.closedCodes.has(code) ? 'room-closed' : 'room-not-found' };
    if (room.players.length >= LOCAL_RELAY_LIMITS.maxPlayers) return { ok: false, reason: 'room-full' };
    const player: Player = { id: `p${room.nextPlayer++}`, session: randomBytes(24).toString('base64url'), connection,
      windowStart: this.now(), windowCount: 0, warnedThisWindow: false, overLimitSeconds: 0 };
    for (const other of room.players) other.connection.send({ t: 'join', id: player.id });
    room.players.push(player);
    room.host ??= player.id;
    room.emptySince = null;
    this.sessions.set(player.session, { room, player });
    connection.send({ t: 'welcome', v: ROOM_PROTOCOL_VERSION, you: player.id, host: room.host, players: room.players.map(item => item.id), code, maxPlayers: LOCAL_RELAY_LIMITS.maxPlayers });
    return { ok: true, session: player.session, playerId: player.id };
  }

  hasSession(session: string, code: string): boolean {
    return this.sessions.get(session)?.room.code === code;
  }

  /** Takes the raw bytes so the size limit applies before any parsing. Returns false for an unknown session. */
  receive(session: string, raw: Buffer | string | { tooLarge: true }): boolean {
    const found = this.sessions.get(session);
    if (!found) return false;
    const { room, player } = found;
    const warn = (code: Extract<RoomServerMessage, { t: 'warn' }>['code']) => player.connection.send({ t: 'warn', code });
    if (!this.admitRate(room, player)) return true;
    if (typeof raw === 'object' && 'tooLarge' in raw) { warn('too-large'); return true; }
    if (Buffer.byteLength(raw) > LOCAL_RELAY_LIMITS.maxMessageBytes) { warn('too-large'); return true; }
    let message: RoomClientMessage;
    try {
      message = JSON.parse(raw.toString()) as RoomClientMessage;
      if (!message || typeof message !== 'object') throw new Error('not an object');
    } catch { warn('bad-message'); return true; }
    if (message.t === 'close') {
      if (player.id !== room.host) warn('not-host');
      else this.closeRoom(room, 'closed-by-host');
      return true;
    }
    if (message.t !== 'send' || typeof message.to !== 'string' || !message.to) { warn('bad-message'); return true; }
    room.lastMessageAt = this.now();
    const delivered: RoomServerMessage = { t: 'msg', from: player.id, d: message.d };
    if (message.to === 'all') {
      for (const other of room.players) if (other !== player) other.connection.send(delivered);
    } else {
      const target = message.to === 'host' ? room.host : message.to;
      // A player who just left is not an error: the sender learns of it from the `leave` message.
      if (target !== player.id) room.players.find(item => item.id === target)?.connection.send(delivered);
    }
    return true;
  }

  /** False when this message is over the limit. Sustained excess closes the connection. */
  private admitRate(room: Room, player: Player): boolean {
    const at = this.now();
    const elapsed = at - player.windowStart;
    if (elapsed >= 1000) {
      const over = player.windowCount > LOCAL_RELAY_LIMITS.messagesPerSecond;
      player.overLimitSeconds = over && elapsed < 2000 ? player.overLimitSeconds + 1 : 0;
      player.windowStart = at;
      player.windowCount = 0;
      player.warnedThisWindow = false;
    }
    player.windowCount += 1;
    if (player.windowCount <= LOCAL_RELAY_LIMITS.messagesPerSecond) return true;
    if (!player.warnedThisWindow) {
      player.warnedThisWindow = true;
      player.connection.send({ t: 'warn', code: 'too-fast' });
    }
    if (player.overLimitSeconds >= LOCAL_RELAY_LIMITS.sustainedOverLimitSeconds) this.dropPlayer(room, player);
    return false;
  }

  /** The transport went away, or the player chose to leave. */
  disconnect(session: string): void {
    const found = this.sessions.get(session);
    if (found) this.removePlayer(found.room, found.player);
  }

  private dropPlayer(room: Room, player: Player): void {
    this.removePlayer(room, player);
    player.connection.end();
  }

  private removePlayer(room: Room, player: Player): void {
    const index = room.players.indexOf(player);
    if (index < 0) return;
    room.players.splice(index, 1);
    this.sessions.delete(player.session);
    const wasHost = room.host === player.id;
    if (wasHost && !room.hostMigration) { this.closeRoom(room, 'host-left'); return; }
    for (const other of room.players) other.connection.send({ t: 'leave', id: player.id });
    if (wasHost) {
      // With migration on, an empty room waits for whoever returns, and they become host.
      room.host = room.players[0]?.id ?? null;
      if (room.host) for (const other of room.players) other.connection.send({ t: 'host', id: room.host });
    }
    if (!room.players.length) room.emptySince = this.now();
  }

  private closeRoom(room: Room, reason: RoomCloseReason): void {
    this.rooms.delete(room.code);
    this.closedCodes.add(room.code);
    if (this.closedCodes.size > LOCAL_RELAY_LIMITS.closedCodesKept) this.closedCodes.delete(this.closedCodes.values().next().value!);
    const players = room.players.splice(0);
    for (const player of players) {
      this.sessions.delete(player.session);
      player.connection.send({ t: 'closing', reason });
      player.connection.end();
    }
  }

  /** Closes idle, expired and empty rooms. Runs on a timer and before anything that counts rooms. */
  sweep(): void {
    const at = this.now();
    for (const room of [...this.rooms.values()]) {
      if (room.emptySince !== null && at - room.emptySince >= LOCAL_RELAY_LIMITS.emptyMs) this.closeRoom(room, 'idle');
      else if (at - room.createdAt >= LOCAL_RELAY_LIMITS.maxDurationMs) this.closeRoom(room, 'max-duration');
      else if (at - room.lastMessageAt >= LOCAL_RELAY_LIMITS.idleMs) this.closeRoom(room, 'idle');
    }
  }

  /** The daemon is stopping: connections just end, and each page reports a lost connection. */
  dispose(): void {
    const players = [...this.sessions.values()].map(({ player }) => player);
    this.sessions.clear();
    this.rooms.clear();
    for (const player of players) player.connection.end();
  }
}
