import { vi } from 'vitest';
import type { OpenPixoAccountStatus, OpenPixoUser } from '@openpixo/contracts';

export type RouteReply = unknown | ((url: URL, init?: RequestInit) => unknown);

/** A JSON reply with a non-200 status, e.g. `httpError(400, { error: { code, message } })`. */
export class HttpReply {
  constructor(readonly status: number, readonly body: unknown) {}
}

export function accountError(status: number, code: string, retryAfterSec?: number) {
  return new HttpReply(status, { error: { code, message: code, ...(retryAfterSec ? { retryAfterSec } : {}) } });
}

export const TEST_USER: OpenPixoUser = {
  id: 'user-1',
  email: 'mina@example.com',
  provider: 'email',
  displayName: null,
  avatarUrl: null,
};

export const SIGNED_OUT: OpenPixoAccountStatus = { availability: 'available', signedIn: false, user: null };
export const SIGNED_IN: OpenPixoAccountStatus = { availability: 'available', signedIn: true, user: TEST_USER };
export const NOT_CONFIGURED: OpenPixoAccountStatus = { availability: 'not_configured', signedIn: false, user: null };

/**
 * A minimal Response: body reads resolve on microtasks only, so suites using
 * fake timers never wait on the platform's stream plumbing.
 */
function fakeResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => structuredClone(body) } as unknown as Response;
}

/**
 * Routes `fetch` by `"METHOD /path"`. An array value replies in order and
 * repeats its last entry; unknown routes answer 404.
 */
export function installAccountFetch(routes: Record<string, RouteReply | RouteReply[]>) {
  const cursors = new Map<string, number>();
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const key = `${(init?.method ?? 'GET').toUpperCase()} ${url.pathname}`;
    const route = routes[key];
    if (route === undefined) return fakeResponse(404, { error: { code: 'NOT_FOUND', message: key } });
    let reply: RouteReply = route;
    if (Array.isArray(route)) {
      const index = cursors.get(key) ?? 0;
      cursors.set(key, index + 1);
      reply = route[Math.min(index, route.length - 1)];
    }
    const value = typeof reply === 'function' ? await (reply as (url: URL, init?: RequestInit) => unknown)(url, init) : reply;
    if (value instanceof HttpReply) return fakeResponse(value.status, value.body);
    return fakeResponse(200, value);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

export function callsTo(fetchMock: ReturnType<typeof installAccountFetch>, method: string, path: string) {
  return fetchMock.mock.calls.filter(([input, init]) => {
    const url = new URL(String(input), 'http://localhost');
    return url.pathname === path && (init?.method ?? 'GET').toUpperCase() === method;
  });
}
