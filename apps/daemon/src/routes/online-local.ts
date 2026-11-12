import type { Express, NextFunction, Request, Response } from 'express';
import { ONLINE_MAX_DOC_BYTES, type OnlineErrorCode, type OnlineResponse } from '@openpixo/contracts';
import { sendApiError } from '../http/api-errors.js';
import { validateLocalDaemonRequest } from '../http/local-daemon-request.js';
import type { OnlineEmulator } from '../online/emulator.js';

export const LOCAL_ONLINE_EMULATOR_PATH = '/api/online/local';
/** A document far over the limit is still answered with `too-large`, without buffering all of it. */
const BODY_READ_LIMIT = ONLINE_MAX_DOC_BYTES + 8192;

/** HTTP statuses for refusals; the SDK reads the JSON body either way. */
const STATUS: Record<OnlineErrorCode, number> = {
  'read-only': 403, paused: 503, 'too-large': 413, 'too-fast': 429, 'bad-request': 400, 'not-found': 404,
  'match-expired': 409, unauthorized: 401, 'protocol-mismatch': 400, unavailable: 503,
};

/** The emulator's base URL for one project. The SDK posts to `<base>/v1`. */
export function localOnlineEmulatorUrl(port: number, projectId: string): string {
  return `http://127.0.0.1:${port}${LOCAL_ONLINE_EMULATOR_PATH}/${encodeURIComponent(projectId)}`;
}

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
 * Game pages live on a dev-server origin, so this cannot use the daemon's same-origin rule or a
 * project token; it has the local rooms relay's rule instead. Register it before the global
 * `/api` origin guard and JSON parser. Peer, Host and Origin must all be loopback, so a website
 * the creator happens to visit cannot reach it, and it holds nothing but test data.
 */
function loopbackOnly(req: Request, res: Response, next: NextFunction): void {
  const validation = validateLocalDaemonRequest(req);
  if (!validation.ok) { sendApiError(res, 403, 'FORBIDDEN', 'The local online test only accepts pages running on this computer.'); return; }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Cache-Control', 'no-store');
  if (validation.origin) {
    res.setHeader('Access-Control-Allow-Origin', validation.origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '600');
    if (req.get('access-control-request-private-network')) res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
  if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
  next();
}

export function registerLocalOnlineEmulator(app: Express, deps: { emulator: OnlineEmulator; hasProject: (projectId: string) => boolean }): void {
  app.use(LOCAL_ONLINE_EMULATOR_PATH, loopbackOnly);

  app.post(`${LOCAL_ONLINE_EMULATOR_PATH}/:projectId/v1`, async (req, res) => {
    const reply = (body: OnlineResponse) => { res.status(body.ok ? 200 : STATUS[body.error.code] ?? 400).json(body); };
    const projectId = String(req.params.projectId);
    if (!deps.hasProject(projectId)) {
      reply({ ok: false, error: { code: 'not-found', message: 'This test link is for a project that no longer exists. Run "pixo online test" again.' } });
      return;
    }
    let request: unknown = null;
    try {
      const body = await readBody(req);
      if (!Buffer.isBuffer(body)) { reply({ ok: false, error: { code: 'too-large', message: `A request can be at most ${BODY_READ_LIMIT} bytes.` } }); return; }
      request = JSON.parse(body.toString('utf8'));
    } catch {
      reply({ ok: false, error: { code: 'bad-request', message: 'The request was not JSON.' } });
      return;
    }
    const header = req.get('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() || null : null;
    reply(deps.emulator.handle(projectId, request, token));
  });
}
