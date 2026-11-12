import type { Express, NextFunction, Request, Response } from 'express';
import type { RoomServerMessage } from '@openpixo/contracts';
import { sendApiError } from '../http/api-errors.js';
import { validateLocalDaemonRequest } from '../http/local-daemon-request.js';
import { LOCAL_RELAY_LIMITS, LocalRoomsRelay } from '../rooms/relay.js';

export const LOCAL_ROOMS_RELAY_PATH = '/api/rooms/local';
/** A game far over the message limit is still answered with `too-large`, without buffering all of it. */
const BODY_READ_LIMIT = LOCAL_RELAY_LIMITS.maxMessageBytes + 1024;
const SWEEP_INTERVAL_MS = 5000;
const KEEPALIVE_INTERVAL_MS = 15_000;
/** A window that stopped reading must not grow the daemon's memory. */
const MAX_UNSENT_BYTES = 4 * 1024 * 1024;
const ROOM_CODE = /^[A-Z0-9]{6}$/u;

function readBody(req: Request): Promise<Buffer | { tooLarge: true }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size <= BODY_READ_LIMIT) chunks.push(chunk);
    });
    req.on('end', () => resolve(size > BODY_READ_LIMIT ? { tooLarge: true } : Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Game pages live on a dev-server origin, so this cannot use the daemon's same-origin
 * rule or a project token. Register it before the global `/api` origin guard and JSON
 * parser. The peer, Host and Origin must all be loopback, so a website the creator
 * happens to visit cannot reach it, and it holds nothing but test rooms.
 */
function loopbackOnly(req: Request, res: Response, next: NextFunction): void {
  const validation = validateLocalDaemonRequest(req);
  if (!validation.ok) { sendApiError(res, 403, 'FORBIDDEN', 'The local rooms relay only accepts pages running on this computer.'); return; }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Cache-Control', 'no-store');
  if (validation.origin) {
    res.setHeader('Access-Control-Allow-Origin', validation.origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '600');
    if (req.get('access-control-request-private-network')) res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
  if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
  next();
}

export interface LocalRoomsRelayHandle {
  relay: LocalRoomsRelay;
  stop: () => void;
}

export function registerLocalRoomsRelay(app: Express, relay: LocalRoomsRelay = new LocalRoomsRelay()): LocalRoomsRelayHandle {
  app.use(LOCAL_ROOMS_RELAY_PATH, loopbackOnly);

  app.post(`${LOCAL_ROOMS_RELAY_PATH}/rooms`, async (req, res) => {
    let request: unknown = null;
    try {
      const body = await readBody(req);
      if (Buffer.isBuffer(body)) request = JSON.parse(body.toString('utf8'));
    } catch { /* Answered below as a protocol mismatch. */ }
    res.json(relay.create(request as Parameters<LocalRoomsRelay['create']>[0]));
  });

  app.get(`${LOCAL_ROOMS_RELAY_PATH}/rooms/:code/events`, (req, res) => {
    const code = String(req.params.code);
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const write = (message: RoomServerMessage, event?: string) => {
      if (res.writableEnded || res.destroyed) return;
      res.write(`${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(message)}\n\n`);
      if (res.writableLength > MAX_UNSENT_BYTES) res.destroy();
    };
    // Sent ahead of `welcome`: posting needs the session, and a reply can arrive right after.
    const sessionFirst: RoomServerMessage[] = [];
    let sessionSent = false;
    const connection = {
      send(message: RoomServerMessage) { if (sessionSent) write(message); else sessionFirst.push(message); },
      end() { if (!res.writableEnded) res.end(); },
    };
    const result = ROOM_CODE.test(code)
      ? relay.join(code, Number(req.query.v), connection)
      : { ok: false as const, reason: 'room-not-found' as const };
    if (!result.ok) { write({ t: 'refused', reason: result.reason }); res.end(); return; }
    const session = result.session;
    res.write(`event: session\ndata: ${JSON.stringify({ session })}\n\n`);
    sessionSent = true;
    for (const message of sessionFirst) write(message);
    const keepalive = setInterval(() => { if (!res.writableEnded) res.write(': keepalive\n\n'); }, KEEPALIVE_INTERVAL_MS);
    keepalive.unref?.();
    res.on('close', () => {
      clearInterval(keepalive);
      relay.disconnect(session);
    });
  });

  app.post(`${LOCAL_ROOMS_RELAY_PATH}/rooms/:code/send`, async (req, res) => {
    const session = typeof req.query.session === 'string' ? req.query.session : '';
    const body = await readBody(req).catch(() => null);
    if (body === null) { res.sendStatus(400); return; }
    if (!relay.hasSession(session, String(req.params.code))) { res.status(410).json({ ok: false }); return; }
    relay.receive(session, body);
    res.sendStatus(204);
  });

  const sweeper = setInterval(() => relay.sweep(), SWEEP_INTERVAL_MS);
  sweeper.unref?.();
  return { relay, stop: () => { clearInterval(sweeper); relay.dispose(); } };
}
