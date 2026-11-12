import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StartGoogleSignInResponse } from '@openpixo/contracts';
import { readOpenPixoCloudConfig } from '../../src/account/config.js';
import { OpenPixoAccountService } from '../../src/account/service.js';
import { ACCESS, ANON, BALANCE, CATALOG, CHECKOUT, LEDGER, PORTAL, REFRESH, USER,
  MemorySecretStore, accountHarness, deferred, tokenResponse } from './fixtures.js';

const cleanup: Array<() => void | Promise<void>> = [];
async function harness(options: Parameters<typeof accountHarness>[0] = {}) {
  const result = await accountHarness(options);
  cleanup.push(result.close);
  return result;
}
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('OpenPixo account HTTP client', () => {
  it('starts and verifies email OTP, projects the user, and restores the encrypted-store session', async () => {
    const h = await harness();
    expect((await h.json('/account')).body).toEqual({ availability: 'available', signedIn: false, user: null });
    expect(await h.json('/account/email/start', 'POST', { email: ' Dev@Example.com ' })).toEqual({ status: 200, body: { resendAfterSec: 60 } });
    const verified = await h.signIn();
    expect(verified.status).toBe(200);
    expect(verified.body).toEqual({ availability: 'available', signedIn: true,
      user: { id: USER.id, email: USER.email, provider: 'email', displayName: 'Game Developer', avatarUrl: null } });
    expect(h.cloud.requests[0]?.body).toEqual({ email: USER.email, create_user: true });
    expect(h.cloud.requests[1]?.body).toEqual({ type: 'email', email: USER.email, token: '123456' });
    expect(h.cloud.requests[2]?.url.pathname).toBe('/auth/v1/user');
    expect(h.cloud.requests[2]?.headers.authorization).toBe(`Bearer ${ACCESS}`);
    for (const request of h.cloud.requests) expect(request.headers.apikey).toBe(ANON);
    h.account.close();
    const restored = new OpenPixoAccountService({ dataRoot: process.env.PIXO_DATA_DIR!, port: () => 1234,
      config: { url: h.cloud.url, anonKey: ANON, agentUrl: `${h.cloud.url}/functions/v1` }, secretStore: h.store });
    cleanup.push(() => restored.close());
    expect(await restored.status()).toEqual(verified.body);
  });

  it('validates email/code input and serializes the per-address courtesy cooldown', async () => {
    let now = Date.now();
    const h = await harness({ now: () => now });
    expect((await h.json('/account/email/start', 'POST', { email: 'invalid' })).body.error.code).toBe('ACCOUNT_EMAIL_INVALID');
    expect((await h.json('/account/email/start', 'POST', { email: 'dev\u0000@example.com' })).body.error.code).toBe('ACCOUNT_EMAIL_INVALID');
    expect((await h.json('/account/email/verify', 'POST', { email: USER.email, code: 'bad-code' })).body.error.code).toBe('ACCOUNT_OTP_INVALID');
    expect(h.cloud.requests).toHaveLength(0);
    const results = await Promise.all([
      h.json('/account/email/start', 'POST', { email: USER.email }),
      h.json('/account/email/start', 'POST', { email: 'DEV@example.com' }),
    ]);
    expect(results.map((item) => item.status).sort()).toEqual([200, 429]);
    expect(results.find((item) => item.status === 429)?.body.error.retryAfterSec).toBe(60);
    expect(h.cloud.requests).toHaveLength(1);
    now += 59_999;
    const waiting = await h.request('/api/openpixo/account/email/start', 'POST', { email: USER.email });
    expect(waiting.status).toBe(429);
    expect(waiting.headers.get('retry-after')).toBe('1');
    now++;
    expect((await h.json('/account/email/start', 'POST', { email: USER.email })).status).toBe(200);
  });

  it('maps GoTrue invalid OTP, rate limits, and network failures without forwarding messages', async () => {
    const h = await harness();
    h.cloud.handlers.set('POST /auth/v1/verify', () => ({ status: 403, body: { error_code: 'otp_expired', msg: ACCESS } }));
    expect((await h.signIn()).body.error.code).toBe('ACCOUNT_OTP_INVALID');
    h.cloud.handlers.set('POST /auth/v1/otp', () => ({ status: 429, body: { error_code: 'over_email_send_rate_limit', msg: REFRESH } }));
    expect((await h.json('/account/email/start', 'POST', { email: USER.email })).body.error.code).toBe('ACCOUNT_OTP_RATE_LIMITED');
    h.cloud.handlers.set('POST /auth/v1/verify', () => ({ disconnect: true }));
    expect((await h.signIn()).body.error.code).toBe('CLOUD_UNAVAILABLE');
  });

  it('uses PKCE and a daemon loopback callback; rejects unknown attempts and replays', async () => {
    const h = await harness();
    const start = (await h.json('/account/google/start', 'POST')).body as unknown as StartGoogleSignInResponse;
    const authorize = new URL(start.authorizeUrl);
    const callback = new URL(authorize.searchParams.get('redirect_to')!);
    expect(authorize.pathname).toBe('/auth/v1/authorize');
    expect(authorize.searchParams.get('provider')).toBe('google');
    expect(authorize.searchParams.get('code_challenge_method')).toBe('s256');
    expect(callback.origin).toBe(h.url);
    expect(callback.pathname).toBe('/api/openpixo/account/callback');
    expect(callback.searchParams.get('attempt')).toBe(start.attemptId);
    expect(Date.parse(start.expiresAt) - Date.now()).toBeGreaterThan(599_000);
    expect((await h.json(`/account/google/attempts/${start.attemptId}`)).body).toEqual({ state: 'pending', error: null, account: null });
    expect((await h.request('/api/openpixo/account', 'GET', undefined, true)).status).toBe(403);
    const unknown = await h.request('/api/openpixo/account/callback?attempt=unknown&code=unused', 'GET', undefined, true);
    expect(unknown.status).toBe(410);
    expect(h.cloud.requests).toHaveLength(0);
    callback.searchParams.set('code', 'one-use-auth-code');
    const response = await h.request(`${callback.pathname}${callback.search}`, 'GET', undefined, true);
    expect(response.status).toBe(200);
    const page = await response.text();
    expect(page).toContain('Sign-in finished');
    expect(page).toContain('登录已完成');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    const exchange = h.cloud.requests.find((request) => request.url.searchParams.get('grant_type') === 'pkce')!;
    expect(exchange.body.auth_code).toBe('one-use-auth-code');
    expect(exchange.body.code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(createHash('sha256').update(String(exchange.body.code_verifier)).digest('base64url')).toBe(authorize.searchParams.get('code_challenge'));
    const poll = await h.json(`/account/google/attempts/${start.attemptId}`);
    expect(poll.body.state).toBe('completed');
    expect(poll.body.account.user.provider).toBe('google');
    expect((await h.request(`${callback.pathname}${callback.search}`, 'GET', undefined, true)).status).toBe(400);
    expect(h.cloud.requests.filter((request) => request.url.searchParams.get('grant_type') === 'pkce')).toHaveLength(1);
    for (const output of [JSON.stringify(start), JSON.stringify(poll.body), page]) {
      expect(output).not.toContain(ACCESS); expect(output).not.toContain(REFRESH); expect(output).not.toContain(String(exchange.body.code_verifier));
    }
  });

  it('expires attempts at exactly ten minutes and consumes failed provider callbacks', async () => {
    let now = Date.now();
    const h = await harness({ now: () => now });
    const start = (await h.json('/account/google/start', 'POST')).body;
    now += 600_000;
    expect((await h.json(`/account/google/attempts/${start.attemptId}`)).body.state).toBe('expired');
    const expired = await h.request(`/api/openpixo/account/callback?attempt=${start.attemptId}&code=late`, 'GET', undefined, true);
    expect(expired.status).toBe(410);
    expect(await expired.text()).toContain('登录已过期');
    const second = (await h.json('/account/google/start', 'POST')).body;
    const denied = `/api/openpixo/account/callback?attempt=${second.attemptId}&error=access_denied&error_description=${ACCESS}`;
    const failed = await h.request(denied, 'GET', undefined, true);
    expect(failed.status).toBe(400);
    expect(await failed.text()).not.toContain(ACCESS);
    expect((await h.json(`/account/google/attempts/${second.attemptId}`)).body).toEqual({ state: 'failed', error: 'ACCOUNT_LOGIN_FAILED', account: null });
    expect((await h.request(`/api/openpixo/account/callback?attempt=${second.attemptId}&code=replay`, 'GET', undefined, true)).status).toBe(400);
    expect(h.cloud.requests).toHaveLength(0);
  });

  it('allows only one callback exchange, even when callbacks arrive concurrently', async () => {
    const h = await harness();
    const entered = deferred(); const release = deferred();
    h.cloud.handlers.set('POST /auth/v1/token?grant_type=pkce', async () => {
      entered.resolve(); await release.promise; return { body: tokenResponse() };
    });
    const start = await h.account.startGoogle();
    const first = h.account.completeGoogle(start.attemptId, 'first-code');
    await entered.promise;
    await expect(h.account.completeGoogle(start.attemptId, 'replay-code')).rejects.toMatchObject({ code: 'ACCOUNT_LOGIN_FAILED' });
    release.resolve(); await first;
    expect(h.cloud.requests.filter((request) => request.url.searchParams.get('grant_type') === 'pkce')).toHaveLength(1);
  });

  it('refreshes proactively before expiry and serializes timer and concurrent API refreshes', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    const h = await harness();
    h.cloud.handlers.set('POST /auth/v1/verify', () => ({ body: tokenResponse(ACCESS, REFRESH, 300) }));
    const entered = deferred(); const release = deferred();
    h.cloud.handlers.set('POST /auth/v1/token?grant_type=refresh_token', async (request) => {
      expect(request.body).toEqual({ refresh_token: REFRESH });
      entered.resolve(); await release.promise;
      return { body: tokenResponse('refreshed-access-secret', 'rotated-refresh-secret') };
    });
    await h.signIn();
    await vi.advanceTimersByTimeAsync(239_999);
    expect(h.cloud.requests.filter((request) => request.url.searchParams.get('grant_type') === 'refresh_token')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    await entered.promise;
    const requests = Promise.all([h.account.status(), h.account.balance(), h.account.balance()]);
    release.resolve();
    const results = await requests;
    expect(results[1]).toEqual(BALANCE);
    expect(h.cloud.requests.filter((request) => request.url.searchParams.get('grant_type') === 'refresh_token')).toHaveLength(1);
    for (const request of h.cloud.requests.filter((request) => request.url.pathname === '/functions/v1/credits')) {
      expect(request.headers.authorization).toBe('Bearer refreshed-access-secret');
    }
    expect((h.store as MemorySecretStore).value).toContain('rotated-refresh-secret');
  });

  it.each([{ error: 'invalid_grant' }, { error_code: 'refresh_token_not_found' }, { error_code: 'refresh_token_already_used' }])(
    'clears an invalid refresh and reports signed out: %j', async (failure) => {
      let now = Date.now();
      const h = await harness({ now: () => now });
      await h.signIn();
      h.cloud.handlers.set('POST /auth/v1/token?grant_type=refresh_token', () => ({ status: 400, body: failure }));
      now += 3_540_000;
      expect((await h.json('/account')).body).toEqual({ availability: 'available', signedIn: false, user: null });
      expect((h.store as MemorySecretStore).value).toBeNull();
      expect((await h.json('/credits')).body.error.code).toBe('ACCOUNT_SIGNED_OUT');
    },
  );

  it('keeps the session on a transient refresh failure and recovers on retry', async () => {
    let now = Date.now();
    const h = await harness({ now: () => now });
    await h.signIn();
    h.cloud.handlers.set('POST /auth/v1/token?grant_type=refresh_token', () => ({ status: 503, body: { msg: REFRESH } }));
    now += 3_540_000;
    expect(await h.json('/account')).toMatchObject({ status: 200, body: { availability: 'available', signedIn: true, user: { id: USER.id } } });
    expect((await h.json('/credits')).body.error.code).toBe('CLOUD_UNAVAILABLE');
    expect((h.store as MemorySecretStore).value).not.toBeNull();
    h.cloud.handlers.set('POST /auth/v1/token?grant_type=refresh_token', () => ({ body: tokenResponse('retry-access', 'retry-refresh') }));
    expect((await h.json('/credits')).body).toEqual(BALANCE);
  });

  it('signs out locally even when remote logout fails, and invalidates pending Google sign-in', async () => {
    const h = await harness();
    await h.signIn();
    const google = await h.account.startGoogle();
    h.cloud.handlers.set('POST /auth/v1/logout?scope=local', () => ({ status: 503, body: { error: ACCESS } }));
    expect((await h.json('/account/sign-out', 'POST')).body.signedIn).toBe(false);
    expect((h.store as MemorySecretStore).value).toBeNull();
    expect((await h.json('/account')).body.signedIn).toBe(false);
    expect(h.cloud.requests.find((request) => request.url.pathname === '/auth/v1/logout')?.headers.authorization).toBe(`Bearer ${ACCESS}`);
    await expect(h.account.completeGoogle(google.attemptId, 'old-code')).rejects.toMatchObject({ code: 'ACCOUNT_LOGIN_FAILED' });
  });

  it('does not resurrect a session when logout races a pending token exchange', async () => {
    const h = await harness();
    const entered = deferred(); const release = deferred();
    h.cloud.handlers.set('POST /auth/v1/verify', async () => {
      entered.resolve(); await release.promise; return { body: tokenResponse() };
    });
    const login = h.signIn();
    await entered.promise;
    await h.account.signOut();
    release.resolve();
    expect((await login).body.error.code).toBe('ACCOUNT_LOGIN_FAILED');
    expect((await h.account.status()).signedIn).toBe(false);
    expect((h.store as MemorySecretStore).value).toBeNull();
  });

  it('reports HTTP 200 not_configured status when cloud environment is missing and refuses cloud actions', async () => {
    expect(readOpenPixoCloudConfig({ PIXO_CLOUD_URL: 'https://example.supabase.co' })).toBeNull();
    expect(readOpenPixoCloudConfig({ PIXO_CLOUD_ANON_KEY: ANON })).toBeNull();
    expect(readOpenPixoCloudConfig({ PIXO_CLOUD_URL: 'https://example.supabase.co/', PIXO_CLOUD_ANON_KEY: ANON }))
      .toEqual({ url: 'https://example.supabase.co', anonKey: ANON, agentUrl: 'https://example.supabase.co/functions/v1' });
    expect(readOpenPixoCloudConfig({ PIXO_CLOUD_URL: 'http://public.example', PIXO_CLOUD_ANON_KEY: ANON })).toBeNull();
    vi.stubEnv('PIXO_CLOUD_URL', undefined);
    vi.stubEnv('PIXO_CLOUD_ANON_KEY', undefined);
    const h = await harness({ config: readOpenPixoCloudConfig() });
    const status = { availability: 'not_configured', signedIn: false, user: null };
    expect(await h.account.status()).toEqual(status);
    expect(await h.json('/account')).toEqual({ status: 200, body: status });
    const routes = [ ['POST', '/account/email/start'], ['POST', '/account/email/verify'],
      ['POST', '/account/google/start'], ['GET', '/account/google/attempts/unknown'],
      ['GET', '/credits'], ['GET', '/credits/ledger'], ['GET', '/credits/catalog'], ['POST', '/credits/checkout'], ['POST', '/credits/portal'] ];
    for (const [method, route] of routes) {
      const result = await h.json(route!, method!);
      expect(result).toMatchObject({ status: 503, body: { error: { code: 'ACCOUNT_NOT_CONFIGURED' } } });
    }
    const callback = await h.request('/api/openpixo/account/callback?attempt=unknown', 'GET', undefined, true);
    expect(callback.status).toBe(503); expect(await callback.text()).toContain('ACCOUNT_NOT_CONFIGURED');
    expect((await h.request('/api/local-feature')).status).toBe(200);
    expect(h.cloud.requests).toHaveLength(0);
    expect((h.store as MemorySecretStore).probes).toBe(0);
  });

  it('signs out and removes persisted local state without cloud configuration or secure-store availability', async () => {
    const store = new MemorySecretStore();
    store.available = false;
    store.value = JSON.stringify({ accessToken: ACCESS, refreshToken: REFRESH });
    const h = await harness({ config: null, secretStore: store });
    expect(await h.json('/account/sign-out', 'POST')).toEqual({ status: 200,
      body: { availability: 'not_configured', signedIn: false, user: null } });
    expect(store.value).toBeNull();
    expect(store.clears).toBe(1);
    expect(store.probes).toBe(0);
    expect(h.cloud.requests).toHaveLength(0);
  });

  it.each([false, true])('a refresh started during an account switch cannot replace or clear the new account (invalid grant: %s)', async (invalidGrant) => {
    let now = Date.now();
    const h = await harness({ now: () => now });
    await h.signIn();
    const loginEntered = deferred(); const loginRelease = deferred();
    const refreshEntered = deferred(); const refreshRelease = deferred();
    h.cloud.handlers.set('POST /auth/v1/verify', async () => {
      loginEntered.resolve(); await loginRelease.promise;
      return { body: tokenResponse('second-account-access', 'second-account-refresh') };
    });
    h.cloud.handlers.set('GET /auth/v1/user', (request) => ({ body: request.headers.authorization === 'Bearer second-account-access'
      ? { ...USER, id: 'user-2', email: 'second@example.com' } : USER }));
    h.cloud.handlers.set('POST /auth/v1/token?grant_type=refresh_token', async () => {
      refreshEntered.resolve(); await refreshRelease.promise;
      return invalidGrant ? { status: 400, body: { error: 'invalid_grant' } }
        : { body: tokenResponse('old-account-refreshed-access', 'old-account-refreshed-refresh') };
    });
    const login = h.account.verifyEmail('second@example.com', '123456');
    await loginEntered.promise;
    now += 3_540_000;
    const balance = h.account.balance();
    await refreshEntered.promise;
    loginRelease.resolve();
    expect((await login).user?.id).toBe('user-2');
    refreshRelease.resolve();
    expect(await balance).toEqual(BALANCE);
    expect((await h.account.status()).user?.id).toBe('user-2');
    expect(h.cloud.requests.filter((request) => request.url.pathname.endsWith('/credits')).at(-1)?.headers.authorization).toBe('Bearer second-account-access');
    expect(JSON.parse((h.store as MemorySecretStore).value!).user.id).toBe('user-2');
  });

  it('refuses old-account credits that finish after a Google account switch', async () => {
    const h = await harness(); await h.signIn();
    const start = await h.account.startGoogle();
    const entered = deferred(); const release = deferred();
    h.cloud.handlers.set('GET /functions/v1/credits', async () => { entered.resolve(); await release.promise; return { body: BALANCE }; });
    const oldBalance = h.json('/credits');
    await entered.promise;
    h.cloud.handlers.set('POST /auth/v1/token?grant_type=pkce', () => ({ body: tokenResponse('google-account-access', 'google-account-refresh') }));
    h.cloud.handlers.set('GET /auth/v1/user', () => ({ body: { ...USER, id: 'google-user-2', email: 'google@example.com' } }));
    await h.account.completeGoogle(start.attemptId, 'new-account-code');
    release.resolve();
    expect((await oldBalance).body.error.code).toBe('ACCOUNT_SIGNED_OUT');
    expect((await h.account.status()).user?.id).toBe('google-user-2');
  });

  it('refuses sign-in when OS secure storage is unavailable, while the public catalog works', async () => {
    const store = new MemorySecretStore(); store.available = false;
    const h = await harness({ secretStore: store });
    const status = { availability: 'secure_storage_unavailable', signedIn: false, user: null };
    expect(await h.json('/account')).toEqual({ status: 200, body: status });
    for (const route of ['/account/email/start', '/account/email/verify', '/account/google/start']) {
      expect((await h.json(route, 'POST', { email: USER.email, code: '123456' })).body.error.code).toBe('ACCOUNT_SECURE_STORAGE_UNAVAILABLE');
    }
    for (const [method, route] of [['GET', '/account/google/attempts/unknown'], ['GET', '/credits'], ['GET', '/credits/ledger'],
      ['POST', '/credits/checkout'], ['POST', '/credits/portal']]) {
      expect(await h.json(route!, method!, method === 'POST' ? { sku: 'credits_1000' } : undefined))
        .toMatchObject({ status: 503, body: { error: { code: 'ACCOUNT_SECURE_STORAGE_UNAVAILABLE' } } });
    }
    expect(await h.json('/account/sign-out', 'POST')).toEqual({ status: 200, body: status });
    expect(store.clears).toBe(1);
    expect((await h.json('/credits/catalog')).body).toEqual(CATALOG);
    expect(store.writes).toHaveLength(0);
    expect(h.cloud.requests).toHaveLength(1);
  });
});

describe('OpenPixo credits proxy', () => {
  it('proxies balances, paginated history, checkout SKU and portal with the current bearer token', async () => {
    const h = await harness();
    expect((await h.json('/credits')).body.error.code).toBe('ACCOUNT_SIGNED_OUT');
    expect((await h.json('/credits/catalog')).body).toEqual(CATALOG);
    expect(h.cloud.requests[0]?.headers.authorization).toBeUndefined();
    await h.signIn();
    expect((await h.json('/credits')).body).toEqual(BALANCE);
    expect((await h.json('/credits/ledger?limit=5&cursor=page%2Fone%2Btwo')).body).toEqual(LEDGER);
    expect((await h.json('/credits/checkout', 'POST', { sku: 'credits_1000', amount: 1, credits: 99999, user_id: 'attacker' })).body).toEqual(CHECKOUT);
    expect((await h.json('/credits/portal', 'POST')).body).toEqual(PORTAL);
    const history = h.cloud.requests.find((request) => request.url.pathname.endsWith('/credits-ledger'))!;
    expect(history.url.searchParams.get('limit')).toBe('5');
    expect(history.url.searchParams.get('cursor')).toBe('page/one+two');
    expect(h.cloud.requests.find((request) => request.url.pathname.endsWith('/create-checkout'))?.body).toEqual({ sku: 'credits_1000' });
    for (const request of h.cloud.requests.filter((request) => request.url.pathname.startsWith('/functions/') && !request.url.pathname.endsWith('/catalog'))) {
      expect(request.headers.apikey).toBe(ANON); expect(request.headers.authorization).toBe(`Bearer ${ACCESS}`);
    }
  });

  it('rejects invalid inputs and unsafe checkout links before clients can open them', async () => {
    const h = await harness(); await h.signIn();
    const count = h.cloud.requests.length;
    for (const query of ['limit=0', 'limit=101', 'limit=1.5', 'limit=2&limit=3', 'cursor=']) {
      expect((await h.json(`/credits/ledger?${query}`)).body.error.code).toBe('BAD_REQUEST');
    }
    expect((await h.json('/credits/checkout', 'POST', { sku: '../not-a-sku' })).body.error.code).toBe('BILLING_SKU_UNKNOWN');
    expect(h.cloud.requests).toHaveLength(count);
    h.cloud.handlers.set('POST /functions/v1/create-checkout', () => ({ body: { ...CHECKOUT, checkoutUrl: 'javascript:alert(1)' } }));
    expect((await h.json('/credits/checkout', 'POST', { sku: 'credits_1000' })).body.error.code).toBe('CLOUD_UNAVAILABLE');
  });

  it('maps cloud error codes, unknown/non-JSON failures and network failures', async () => {
    const h = await harness(); await h.signIn();
    for (const code of ['BILLING_SKU_UNKNOWN', 'BILLING_PAUSED', 'CLOUD_UNAVAILABLE']) {
      h.cloud.handlers.set('POST /functions/v1/create-checkout', () => ({ status: 400, body: { error: { code, message: ACCESS } } }));
      const result = await h.json('/credits/checkout', 'POST', { sku: 'credits_1000' });
      expect(result.body.error.code).toBe(code); expect(JSON.stringify(result.body)).not.toContain(ACCESS);
    }
    h.cloud.handlers.set('GET /functions/v1/credits', () => ({ status: 502, body: { error: { code: 'PROVIDER_SECRET', message: REFRESH } } }));
    expect((await h.json('/credits')).body.error.code).toBe('CLOUD_UNAVAILABLE');
    h.cloud.handlers.set('GET /functions/v1/credits', () => ({ status: 502, raw: `<html>${ACCESS}</html>` }));
    const nonJson = await h.json('/credits');
    expect(nonJson.body.error.code).toBe('CLOUD_UNAVAILABLE');
    expect(JSON.stringify(nonJson.body)).not.toContain(ACCESS);
    h.cloud.handlers.set('GET /functions/v1/credits', () => ({ disconnect: true }));
    expect((await h.json('/credits')).body.error.code).toBe('CLOUD_UNAVAILABLE');
    h.cloud.handlers.set('GET /functions/v1/credits', () => ({ status: 401, body: { error: { code: 'ACCOUNT_SIGNED_OUT', message: REFRESH } } }));
    expect((await h.json('/credits')).body.error.code).toBe('ACCOUNT_SIGNED_OUT');
    expect((await h.account.status()).signedIn).toBe(false);
  });

  it('never forwards auth tokens or logs provider/secure-store failures, including extra cloud fields', async () => {
    const logs = [vi.spyOn(console, 'log').mockImplementation(() => {}), vi.spyOn(console, 'warn').mockImplementation(() => {}),
      vi.spyOn(console, 'error').mockImplementation(() => {}), vi.spyOn(console, 'info').mockImplementation(() => {}), vi.spyOn(console, 'debug').mockImplementation(() => {})];
    const h = await harness();
    const outputs = [JSON.stringify((await h.signIn()).body)];
    h.cloud.handlers.set('GET /functions/v1/credits', () => ({ body: { ...BALANCE, access_token: ACCESS, refresh_token: REFRESH } }));
    h.cloud.handlers.set('GET /functions/v1/credits-ledger', () => ({ body: { ...LEDGER, access_token: ACCESS,
      entries: LEDGER.entries.map((entry) => ({ ...entry, refreshToken: REFRESH })) } }));
    for (const route of ['/account', '/credits', '/credits/ledger', '/credits/catalog']) outputs.push(JSON.stringify((await h.json(route)).body));
    h.cloud.handlers.set('POST /functions/v1/create-checkout', () => ({ status: 400, body: { error: { code: 'BILLING_PAUSED', message: `${ACCESS} ${REFRESH}` } } }));
    outputs.push(JSON.stringify((await h.json('/credits/checkout', 'POST', { sku: 'credits_1000' })).body));
    vi.spyOn(h.store, 'write').mockRejectedValue(new Error(`${ACCESS} ${REFRESH}`));
    outputs.push(JSON.stringify((await h.signIn()).body));
    expect(outputs.at(-1)).toContain('ACCOUNT_SECURE_STORAGE_UNAVAILABLE');
    const combined = outputs.join('\n') + logs.flatMap((log) => log.mock.calls).map((line) => JSON.stringify(line)).join('\n');
    for (const secret of [ACCESS, REFRESH, ANON]) expect(combined).not.toContain(secret);
    for (const value of Object.values(process.env)) {
      expect(value).not.toContain(ACCESS); expect(value).not.toContain(REFRESH);
    }
  });
});
