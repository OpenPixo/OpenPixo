import express from 'express';
import { once } from 'node:events';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { OpenPixoAccountService, type OpenPixoAccountServiceOptions } from '../../src/account/service.js';
import type { SecretStore } from '../../src/account/secret-store.js';
import { registerOpenPixoAccountCallback, registerOpenPixoAccountRoutes } from '../../src/routes/openpixo-account.js';

export const ACCESS = 'fake-access-secret-do-not-return';
export const REFRESH = 'fake-refresh-secret-do-not-return';
export const ANON = 'fake-public-anon-key';
export const USER = { id: 'user-1', email: 'dev@example.com', user_metadata: { full_name: 'Game Developer' } };
export const BALANCE = { available: 900, reserved: 100, subscription: null };
export const LEDGER = { entries: [{ id: 'entry-1', kind: 'topup', amount: 1000, balanceAfter: 1000,
  createdAt: '2026-11-01T00:00:00.000Z', reference: 'order-1' }], nextCursor: 'next/page+cursor' };
export const CATALOG = { topups: [{ sku: 'credits_1000', credits: 1000, amountMinor: 1000, currency: 'usd', paymentMethods: ['card', 'alipay'] }],
  plans: [{ sku: 'monthly_2000', monthlyCredits: 2000, amountMinor: 1800, currency: 'usd', interval: 'month', paymentMethods: ['card'] }], purchasesPaused: false };
export const CHECKOUT = { checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_example#fidkdWxOYHwnPyd1blpxYHZxWjA0', checkoutId: 'cs_test_example' };
export const PORTAL = { url: 'https://billing.stripe.com/p/session/test_example' };

export function tokenResponse(access = ACCESS, refresh = REFRESH, expiresIn = 3600) {
  return { access_token: access, refresh_token: refresh, expires_in: expiresIn, token_type: 'bearer', user: USER };
}

export class MemorySecretStore implements SecretStore {
  available = true;
  value: string | null = null;
  probes = 0;
  reads = 0;
  clears = 0;
  writes: string[] = [];
  async isAvailable() { this.probes++; return this.available; }
  async read() { this.reads++; return this.value; }
  async write(value: string) { this.value = value; this.writes.push(value); }
  async clear() { this.value = null; this.clears++; }
}

export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

export interface CloudRequest { method: string; url: URL; body: Record<string, unknown>; headers: IncomingHttpHeaders }
interface CloudReply { status?: number; body?: unknown; raw?: string; disconnect?: boolean; headers?: Record<string, string> }
type CloudHandler = (request: CloudRequest) => CloudReply | Promise<CloudReply>;

async function listen(server: Server): Promise<string> {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected an HTTP port.');
  return `http://127.0.0.1:${address.port}`;
}

async function stop(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

export async function fakeSupabase() {
  const requests: CloudRequest[] = [];
  const handlers = new Map<string, CloudHandler>([
    ['POST /auth/v1/otp', () => ({ body: {} })],
    ['POST /auth/v1/verify', () => ({ body: tokenResponse() })],
    ['POST /auth/v1/token?grant_type=pkce', () => ({ body: tokenResponse() })],
    ['POST /auth/v1/token?grant_type=refresh_token', () => ({ body: tokenResponse('refreshed-access-secret', 'rotated-refresh-secret') })],
    ['GET /auth/v1/user', () => ({ body: USER })],
    ['POST /auth/v1/logout?scope=local', () => ({ status: 204 })],
    ['GET /functions/v1/catalog', () => ({ body: CATALOG })],
    ['GET /functions/v1/credits', () => ({ body: BALANCE })],
    ['GET /functions/v1/credits-ledger', () => ({ body: LEDGER })],
    ['POST /functions/v1/create-checkout', () => ({ body: CHECKOUT })],
    ['POST /functions/v1/billing-portal', () => ({ body: PORTAL })],
  ]);
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url!, 'http://127.0.0.1');
      let raw = '';
      for await (const chunk of req) raw += String(chunk);
      const request: CloudRequest = { method: req.method!, url, headers: req.headers, body: raw && String(req.headers['content-type'] ?? '').includes('json') ? JSON.parse(raw) as Record<string, unknown> : {} };
      requests.push(request);
      const key = `${req.method} ${url.pathname}${url.pathname.startsWith('/auth/') ? url.search : ''}`;
      const handler = handlers.get(key);
      const reply = handler ? await handler(request) : { status: 404, body: {} };
      if (reply.disconnect) { req.socket.destroy(); return; }
      res.writeHead(reply.status ?? 200, { 'Content-Type': 'application/json', ...reply.headers });
      res.end(reply.status === 204 ? undefined : reply.raw ?? JSON.stringify(reply.body ?? {}));
    } catch { res.writeHead(500).end(); }
  });
  const url = await listen(server);
  return { url, requests, handlers, close: () => stop(server) };
}

export async function accountHarness(options: Partial<Pick<OpenPixoAccountServiceOptions, 'config' | 'now' | 'secretStore'>> = {}) {
  const cloud = await fakeSupabase();
  const store = options.secretStore ?? new MemorySecretStore();
  let port = 0;
  const account = new OpenPixoAccountService({ dataRoot: path.join(tmpdir(), 'pixo-account-test'), port: () => port,
    config: { url: cloud.url, anonKey: ANON, agentUrl: `${cloud.url}/functions/v1` }, secretStore: store, ...options });
  const app = express();
  app.use(express.json());
  registerOpenPixoAccountCallback(app, { account });
  // Model production ordering: callback alone precedes the API token/origin guards.
  app.use('/api', (req, res, next) => {
    if (req.get('authorization') !== 'Bearer local-test-api-token' || req.get('origin') !== `http://127.0.0.1:${port}`) {
      res.status(403).json({ error: { code: 'FORBIDDEN' } }); return;
    }
    next();
  });
  registerOpenPixoAccountRoutes(app, { account });
  app.get('/api/local-feature', (_req, res) => { res.json({ local: true }); });
  const server = createServer(app);
  const url = await listen(server);
  port = Number(new URL(url).port);
  const request = (route: string, method = 'GET', body?: unknown, navigation = false) => fetch(`${url}${route}`, {
    method, headers: { ...(navigation ? {} : { authorization: 'Bearer local-test-api-token', origin: url }),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = async (route: string, method = 'GET', body?: unknown) => {
    const response = await request(`/api/openpixo${route}`, method, body);
    return { status: response.status, body: await response.json() as Record<string, any> };
  };
  const signIn = () => json('/account/email/verify', 'POST', { email: USER.email, code: '123456' });
  return { account, store, cloud, url, request, json, signIn, close: async () => { account.close(); await stop(server); await cloud.close(); } };
}
