/**
 * Live rooms for web games. Added to a game with `pixo rooms add`; no dependencies.
 *
 *   const room = await createRoom();              // or joinRoom(code), or joinFromUrl()
 *   room.on('message', ({ from, data }) => { ... });
 *   room.send({ x: 1 });
 *
 * One player hosts and the server only relays, so a host can cheat: this is for
 * playing with friends, not ranked or prize play. There is no automatic reconnect;
 * a lost connection fires `closed`, and the game can offer joinRoom(room.code),
 * which returns as a new player.
 *
 * Only erasable TypeScript syntax is used: installing into a JavaScript project strips the types.
 */

const PROTOCOL_VERSION = 1;
const MAX_MESSAGE_BYTES = 16_384;
const CONNECT_TIMEOUT_MS = 15_000;
const INVITE_BASE_WAIT_MS = 2000;

export type RoomCloseReason =
  | 'host-left' | 'idle' | 'max-duration' | 'out-of-credits' | 'limit-reached' | 'removed' | 'closed-by-host'
  /** You called leave() or close(). */
  | 'left'
  /** The connection dropped. The room may still be open: joinRoom(code) returns as a new player. */
  | 'connection-lost';

export interface RoomEvents {
  message: { from: string; data: unknown };
  playerJoined: { id: string };
  playerLeft: { id: string };
  hostChanged: { id: string };
  closed: { reason: RoomCloseReason; message: string };
}

type ServerMessage =
  | { t: 'welcome'; v: number; you: string; host: string; players: string[]; code: string; maxPlayers: number }
  | { t: 'join'; id: string }
  | { t: 'leave'; id: string }
  | { t: 'host'; id: string }
  | { t: 'msg'; from: string; d: unknown }
  | { t: 'closing'; reason: RoomCloseReason }
  | { t: 'refused'; reason: string }
  | { t: 'warn'; code: string };

type ClientMessage = { t: 'send'; to: string; d: unknown } | { t: 'close' };

const CREATE_REFUSALS: Record<string, string> = {
  paused: 'Live rooms are not open yet. Try again later.',
  'game-unavailable': 'Rooms are not available for this game. It may not be published, or it may have been removed.',
  'out-of-credits': 'This game has used its free room time and its creator is out of credits, so new rooms cannot open.',
  'limit-reached': 'This game reached the monthly room spending limit its creator set, so new rooms cannot open.',
  'too-many-rooms': 'Too many rooms are open for this game. Close one or try again soon.',
  'protocol-mismatch': 'This copy of the game is out of date. Refresh the page.',
  unavailable: 'Rooms are unavailable right now. Try again in a minute.',
};

const JOIN_REFUSALS: Record<string, string> = {
  'room-not-found': 'No room has that code. Check the code, or ask the host for a new link.',
  'room-full': 'That room is full.',
  'room-closed': 'That room has closed. Ask the host to open a new one.',
  'protocol-mismatch': 'This copy of the game is out of date. Refresh the page.',
};

const CLOSE_MESSAGES: Record<RoomCloseReason, string> = {
  'host-left': 'The host left, so the room closed.',
  idle: 'The room closed because nobody played for a while.',
  'max-duration': 'The room reached its time limit and closed.',
  'out-of-credits': "The room closed because the game's creator ran out of credits.",
  'limit-reached': "The room closed because the game reached its creator's monthly spending limit.",
  removed: 'The room closed because this game is no longer available.',
  'closed-by-host': 'The host closed the room.',
  left: 'You left the room.',
  'connection-lost': 'The connection to the room was lost.',
};

const WARNINGS: Record<string, string> = {
  'too-large': 'A room message was dropped because it is over 16 KB. Send less at once.',
  'too-fast': 'Room messages were dropped because this player sent more than 60 a second. Send game state 10 to 30 times a second.',
  'not-host': 'Only the host can do that.',
  'bad-message': 'The room could not read a message.',
};

/** Thrown for every refusal. `code` is the machine-readable reason and `message` is safe to show players. */
export class RoomError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'RoomError';
    this.code = code;
  }
}

interface Transport {
  send(message: ClientMessage): void;
  /** Ends the connection. No further callbacks fire. */
  close(): void;
}

interface TransportHandlers {
  onMessage(message: ServerMessage): void;
  /** The connection ended without the page asking it to. */
  onEnd(): void;
}

interface Backend {
  kind: 'local' | 'hosted';
  create(hostMigration: boolean): Promise<{ code: string }>;
  connect(code: string, handlers: TransportHandlers): Transport;
  inviteBase(): Promise<string | null>;
}

function pageUrl(): URL | null {
  const location = (globalThis as { location?: { href?: string } }).location;
  if (!location?.href) return null;
  try { return new URL(location.href); } catch { return null; }
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function createRefusal(reason: string): RoomError {
  return new RoomError(reason, CREATE_REFUSALS[reason] ?? CREATE_REFUSALS.unavailable!);
}

async function postCreate(url: string, hostMigration: boolean, unreachable: () => RoomError): Promise<{ code: string }> {
  let response: Response;
  try {
    response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ v: PROTOCOL_VERSION, ...(hostMigration ? { hostMigration: true } : {}) }) });
  } catch { throw unreachable(); }
  const result = await response.json().catch(() => null) as { ok?: boolean; code?: unknown; reason?: unknown } | null;
  if (result?.ok === true && typeof result.code === 'string') return { code: result.code };
  throw createRefusal(typeof result?.reason === 'string' ? result.reason : 'unavailable');
}

/** Local relay: POST to send, one Server-Sent Events stream to receive. Uses fetch so it also runs outside a browser. */
function localBackend(relay: string): Backend {
  const base = relay.replace(/\/+$/u, '');
  const unreachable = () => new RoomError('relay-unreachable',
    'Cannot reach the room test on this computer. Make sure OpenPixo is running, then run "pixo rooms test" for fresh links; they change when the app restarts.');
  return {
    kind: 'local',
    create: hostMigration => postCreate(`${base}/rooms`, hostMigration, unreachable),
    inviteBase: async () => null,
    connect(code, handlers) {
      const controller = new AbortController();
      let session: string | null = null;
      let closed = false;
      // Separate POSTs can overtake each other; the protocol promises order, so send one at a time.
      const queue: ClientMessage[] = [];
      let sending = false;
      const end = () => { if (!closed) { closed = true; controller.abort(); handlers.onEnd(); } };
      const flush = async () => {
        if (sending) return;
        sending = true;
        try {
          while (queue.length && session && !closed) {
            const response = await fetch(`${base}/rooms/${encodeURIComponent(code)}/send?session=${encodeURIComponent(session)}`,
              { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(queue.shift()), signal: controller.signal });
            if (response.status === 410) { end(); return; }
          }
        } catch { end(); }
        finally { sending = false; }
      };
      void (async () => {
        try {
          const response = await fetch(`${base}/rooms/${encodeURIComponent(code)}/events?v=${PROTOCOL_VERSION}`,
            { headers: { Accept: 'text/event-stream' }, signal: controller.signal });
          if (!response.ok || !response.body) throw new Error('stream refused');
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let boundary: number;
            while ((boundary = buffer.indexOf('\n\n')) >= 0) {
              const frame = buffer.slice(0, boundary);
              buffer = buffer.slice(boundary + 2);
              const data = frame.split('\n').filter(line => line.startsWith('data: ')).map(line => line.slice(6)).join('\n');
              if (!data) continue;
              if (frame.startsWith('event: session')) { session = (JSON.parse(data) as { session: string }).session; void flush(); }
              else handlers.onMessage(JSON.parse(data) as ServerMessage);
            }
          }
          end();
        } catch { end(); }
      })();
      return {
        send(message) { if (!closed) { queue.push(message); void flush(); } },
        close() { closed = true; controller.abort(); },
      };
    },
  };
}

/** Published games: same origin as the game, one WebSocket per player. */
function hostedBackend(page: URL): Backend {
  const unreachable = () => new RoomError('unavailable', 'Cannot reach the rooms server. Check your connection and try again.');
  let config: Promise<Record<string, unknown> | null> | undefined;
  return {
    kind: 'hosted',
    create: hostMigration => postCreate('/__rooms', hostMigration, unreachable),
    async inviteBase() {
      // The public link is the wrapper page with the Report button, not this game frame.
      config ??= fetch('/__openpixo/config.json').then(response => (response.ok ? response.json() as Promise<Record<string, unknown>> : null)).catch(() => null);
      const value = await config;
      return typeof value?.shareUrl === 'string' && value.shareUrl ? value.shareUrl : null;
    },
    connect(code, handlers) {
      const scheme = page.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(`${scheme}//${page.host}/__rooms/${encodeURIComponent(code)}?v=${PROTOCOL_VERSION}`);
      let closed = false;
      const pending: string[] = [];
      socket.addEventListener('open', () => { for (const text of pending.splice(0)) socket.send(text); });
      socket.addEventListener('message', event => {
        if (closed || typeof event.data !== 'string') return;
        let message: ServerMessage;
        try { message = JSON.parse(event.data) as ServerMessage; } catch { return; }
        handlers.onMessage(message);
      });
      socket.addEventListener('close', () => { if (!closed) { closed = true; handlers.onEnd(); } });
      return {
        send(message) {
          const text = JSON.stringify(message);
          if (socket.readyState === WebSocket.OPEN) socket.send(text);
          else if (socket.readyState === WebSocket.CONNECTING) pending.push(text);
        },
        close() { closed = true; socket.close(); },
      };
    },
  };
}

/** The order is in specs/current/publish-and-rooms.md: relay parameter, then hosted, then a loopback page explains itself. */
function chooseBackend(): Backend {
  const page = pageUrl();
  if (!page) throw new RoomError('no-page', 'Rooms need a web page to run in.');
  const relay = page.searchParams.get('pixoRooms');
  if (relay) {
    let parsed: URL | null = null;
    try { parsed = new URL(relay); } catch { /* Reported below. */ }
    // A link must not be able to point a player's game at someone else's server.
    if (parsed && parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname)) return localBackend(relay);
    if (isLoopbackHost(page.hostname)) throw new RoomError('relay-invalid', 'This test link does not point at this computer. Run "pixo rooms test" and open one of the links it prints.');
  }
  if (isLoopbackHost(page.hostname)) {
    throw new RoomError('relay-missing', 'While the game runs on this computer, rooms need a test link. Run "pixo rooms test" and open the two links it prints.');
  }
  return hostedBackend(page);
}

type Listener<K extends keyof RoomEvents> = (event: RoomEvents[K]) => void;

export class Room {
  readonly code: string;
  readonly you: string;
  private currentHost: string;
  private readonly members: string[];
  private readonly listeners: { [K in keyof RoomEvents]?: Set<Listener<K>> } = {};
  private readonly transport: Transport;
  private readonly backend: Backend;
  private invite: string | null = null;
  private ended = false;
  private warnedClosed = false;
  /** Holds what arrives before the game can have attached listeners. Null once released. */
  private held: (() => void)[] | null = [];

  /** @internal Use createRoom, joinRoom or joinFromUrl. */
  constructor(welcome: Extract<ServerMessage, { t: 'welcome' }>, transport: Transport, backend: Backend) {
    this.code = welcome.code;
    this.you = welcome.you;
    this.currentHost = welcome.host;
    this.members = [...welcome.players];
    this.transport = transport;
    this.backend = backend;
  }

  /** @internal */
  setInviteBase(base: string | null): void { this.invite = base; }

  /** @internal */
  release(): void {
    const held = this.held ?? [];
    this.held = null;
    for (const action of held) action();
  }

  /** The current host's player id. */
  get host(): string { return this.currentHost; }
  get isHost(): boolean { return this.currentHost === this.you; }
  /** Player ids in join order, including you. */
  get players(): string[] { return [...this.members]; }

  /** A link a friend can open to join this room. */
  inviteUrl(): string {
    if (this.backend.kind === 'hosted' && this.invite) return `${this.invite}/${this.code}`;
    // Local test links stay on the page so they keep their relay parameter.
    const url = new URL(pageUrl()?.href ?? '');
    url.hash = '';
    url.searchParams.set('room', this.code);
    return url.href;
  }

  on<K extends keyof RoomEvents>(event: K, listener: Listener<K>): () => void {
    const set = (this.listeners[event] ??= new Set() as never) as Set<Listener<K>>;
    set.add(listener);
    return () => { set.delete(listener); };
  }

  off<K extends keyof RoomEvents>(event: K, listener: Listener<K>): void {
    (this.listeners[event] as Set<Listener<K>> | undefined)?.delete(listener);
  }

  private emit<K extends keyof RoomEvents>(event: K, value: RoomEvents[K]): void {
    for (const listener of [...(this.listeners[event] as Set<Listener<K>> | undefined) ?? []]) {
      try { listener(value); } catch (error) { console.error(error); }
    }
  }

  /** Send to everyone else. */
  send(data: unknown): void { this.post('all', data); }
  /** Send to one player. */
  sendTo(playerId: string, data: unknown): void { this.post(playerId, data); }
  /** Send to the host. On the host itself this arrives as its own `message`, so one game loop handles every player's input. */
  sendToHost(data: unknown): void {
    if (this.isHost) {
      if (!this.ended) queueMicrotask(() => { if (!this.ended) this.emit('message', { from: this.you, data }); });
      return;
    }
    this.post('host', data);
  }

  private post(to: string, data: unknown): void {
    if (this.ended) {
      if (!this.warnedClosed) { this.warnedClosed = true; console.warn('This room has closed, so messages are no longer sent.'); }
      return;
    }
    const message: ClientMessage = { t: 'send', to, d: data };
    const bytes = new TextEncoder().encode(JSON.stringify(message)).length;
    if (bytes > MAX_MESSAGE_BYTES) {
      throw new RoomError('too-large', `This room message is ${bytes} bytes and the limit is ${MAX_MESSAGE_BYTES}. Send less at once, or split it up.`);
    }
    this.transport.send(message);
  }

  /** Host only: end the room for everyone. */
  close(): void {
    if (this.ended) return;
    if (!this.isHost) throw new RoomError('not-host', 'Only the host can close the room. Use leave() to go by yourself.');
    this.transport.send({ t: 'close' });
  }

  /** Leave the room. If you are the host and migration is off, this ends it for everyone. */
  leave(): void {
    if (this.ended) return;
    this.release();
    this.transport.close();
    this.finish('left');
  }

  /** @internal */
  receive(message: ServerMessage): void {
    if (this.held) { this.held.push(() => this.receive(message)); return; }
    switch (message.t) {
      case 'join':
        if (!this.members.includes(message.id)) this.members.push(message.id);
        this.emit('playerJoined', { id: message.id });
        break;
      case 'leave': {
        const index = this.members.indexOf(message.id);
        if (index >= 0) this.members.splice(index, 1);
        this.emit('playerLeft', { id: message.id });
        break;
      }
      case 'host':
        this.currentHost = message.id;
        this.emit('hostChanged', { id: message.id });
        break;
      case 'msg':
        this.emit('message', { from: message.from, data: message.d });
        break;
      case 'closing':
        this.transport.close();
        this.finish(message.reason);
        break;
      case 'warn':
        console.warn(WARNINGS[message.code] ?? `Room warning: ${message.code}`);
        break;
      default:
        break;
    }
  }

  /** @internal */
  finish(reason: RoomCloseReason): void {
    if (this.held) { this.held.push(() => this.finish(reason)); return; }
    if (this.ended) return;
    this.ended = true;
    this.emit('closed', { reason, message: CLOSE_MESSAGES[reason] ?? `The room closed (${reason}).` });
  }
}

function connectRoom(code: string, backend: Backend): Promise<Room> {
  return new Promise((resolve, reject) => {
    let room: Room | null = null;
    let settled = false;
    const fail = (error: RoomError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      transport.close();
      reject(error);
    };
    const lost = () => new RoomError('connection-failed', backend.kind === 'local'
      ? 'Could not join the test room. Make sure OpenPixo is running, then run "pixo rooms test" for fresh links.'
      : 'Could not join that room. The code may be wrong, or the connection failed. Check it and try again.');
    const timer = setTimeout(() => fail(lost()), CONNECT_TIMEOUT_MS);
    const transport = backend.connect(code, {
      onMessage(message) {
        if (room) { room.receive(message); return; }
        if (message.t === 'refused') { fail(new RoomError(message.reason, JOIN_REFUSALS[message.reason] ?? 'Could not join that room.')); return; }
        if (message.t !== 'welcome' || settled) return;
        settled = true;
        clearTimeout(timer);
        const opened = new Room(message, transport, backend);
        room = opened;
        // inviteUrl() is synchronous, so its base is read now. It is optional and must not fail the join.
        void Promise.race([backend.inviteBase().catch(() => null), new Promise<null>(done => { setTimeout(() => done(null), INVITE_BASE_WAIT_MS); })]).then(base => {
          opened.setInviteBase(base);
          resolve(opened);
          // A macrotask runs after the caller's `await` continuation, which is where it attaches listeners.
          setTimeout(() => opened.release(), 0);
        });
      },
      onEnd() {
        if (room) room.finish('connection-lost');
        else fail(lost());
      },
    });
  });
}

/** Opens a new room and joins it as host. Pass `hostMigration: true` to keep the room open when the host leaves. */
export async function createRoom(options: { hostMigration?: boolean } = {}): Promise<Room> {
  const backend = chooseBackend();
  const { code } = await backend.create(options.hostMigration === true);
  return connectRoom(code, backend);
}

/** Joins a room by its 6-character code. Capitals and spaces do not matter. */
export async function joinRoom(code: string): Promise<Room> {
  const normalized = String(code).trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/u.test(normalized)) throw new RoomError('room-not-found', 'Room codes are 6 letters and numbers. Check the code and try again.');
  return connectRoom(normalized, chooseBackend());
}

/** Joins the room in this page's `?room=` link. Resolves to null when the link names no room. */
export async function joinFromUrl(): Promise<Room | null> {
  const code = pageUrl()?.searchParams.get('room');
  return code ? joinRoom(code) : null;
}
