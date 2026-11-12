import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runAccountCli } from '../../src/account/account-cli.js';
import { runCreditsCli } from '../../src/account/credits-cli.js';
import { readOpenPixoCloudConfig } from '../../src/account/config.js';
import { ACCESS, BALANCE, CATALOG, CHECKOUT, LEDGER, PORTAL, REFRESH, USER, MemorySecretStore, accountHarness } from './fixtures.js';

const mocks = vi.hoisted(() => ({ question: vi.fn(), close: vi.fn(), delay: vi.fn() }));
vi.mock('node:readline/promises', () => ({ createInterface: () => ({ question: mocks.question, close: mocks.close, once: vi.fn() }) }));
vi.mock('node:timers/promises', () => ({ setTimeout: mocks.delay }));

const cleanup: Array<() => void | Promise<void>> = [];
let stdinDescriptor: PropertyDescriptor | undefined;
let initialExitCode: typeof process.exitCode;
beforeEach(() => {
  stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  initialExitCode = process.exitCode;
  process.exitCode = 0;
  vi.stubEnv('PIXO_API_TOKEN', 'local-test-api-token');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  mocks.question.mockReset().mockResolvedValue('654321');
  mocks.close.mockClear();
  mocks.delay.mockReset().mockRejectedValue(new Error('Unexpected extra polling.'));
});
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  if (stdinDescriptor) Object.defineProperty(process.stdin, 'isTTY', stdinDescriptor);
  else Reflect.deleteProperty(process.stdin, 'isTTY');
  process.exitCode = initialExitCode;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function harness(options: Parameters<typeof accountHarness>[0] = {}) {
  const h = await accountHarness(options); cleanup.push(h.close); return h;
}
function output() {
  return JSON.parse(String(vi.mocked(console.log).mock.calls.at(-1)?.[0])) as Record<string, any>;
}

describe('pixo account', () => {
  it('exposes status/login/logout help and machine-readable status', async () => {
    await runAccountCli(['--help']);
    const usage = String(vi.mocked(console.log).mock.calls[0]?.[0]);
    expect(usage).toContain('account login --email'); expect(usage).toContain('--google'); expect(usage).toContain('--json');
    const h = await harness();
    await runAccountCli(['status', '--daemon-url', h.url, '--json']);
    expect(output()).toEqual({ availability: 'available', signedIn: false, user: null });
  });

  it.each(['not_configured', 'secure_storage_unavailable'] as const)('prints the %s status body and exits zero', async (availability) => {
    vi.stubEnv('PIXO_CLOUD_URL', undefined);
    vi.stubEnv('PIXO_CLOUD_ANON_KEY', undefined);
    const store = new MemorySecretStore(); store.available = false;
    const h = await harness(availability === 'not_configured'
      ? { config: readOpenPixoCloudConfig() } : { secretStore: store });
    const expected = { availability, signedIn: false, user: null };
    expect(await h.json('/account')).toEqual({ status: 200, body: expected });
    await runAccountCli(['status', '--daemon-url', h.url, '--json']);
    expect(output()).toEqual(expected);
    expect(process.exitCode).toBe(0);
    expect(vi.mocked(console.log).mock.calls).toHaveLength(1);
    expect(h.cloud.requests).toHaveLength(0);
  });

  it('shows missing cloud configuration in human-readable account status', async () => {
    const h = await harness({ config: null });
    await runAccountCli(['status', '--daemon-url', h.url]);
    expect(String(vi.mocked(console.log).mock.calls[0]?.[0])).toContain('not configured');
    expect(process.exitCode).toBe(0);
  });

  it('reads the email code from an interactive stdin prompt and keeps JSON stdout clean', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    const h = await harness();
    await runAccountCli(['login', '--email', USER.email, '--daemon-url', h.url, '--json']);
    expect(output().signedIn).toBe(true);
    expect(h.cloud.requests.find((request) => request.url.pathname === '/auth/v1/verify')?.body)
      .toEqual({ email: USER.email, type: 'email', token: '654321' });
    expect(mocks.question).toHaveBeenCalledOnce(); expect(mocks.close).toHaveBeenCalledOnce();
    expect(vi.mocked(console.log).mock.calls).toHaveLength(1);
    const logged = JSON.stringify([...vi.mocked(console.log).mock.calls, ...vi.mocked(console.error).mock.calls, ...vi.mocked(process.stderr.write).mock.calls]);
    for (const secret of ['654321', ACCESS, REFRESH]) expect(logged).not.toContain(secret);
    await runAccountCli(['logout', '--daemon-url', h.url, '--json']);
    expect(output().signedIn).toBe(false);
  });

  it('rejects code argv and non-interactive email login before sending an OTP', async () => {
    const h = await harness();
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    await runAccountCli(['login', '--email', USER.email, '--daemon-url', h.url, '--json']);
    expect(output().error.code).toBe('BAD_REQUEST');
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    await runAccountCli(['login', '--email', USER.email, '--code', '654321', '--daemon-url', h.url, '--json']);
    expect(output().error.code).toBe('BAD_REQUEST');
    expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain('654321');
    expect(h.cloud.requests).toHaveLength(0);
    expect(mocks.question).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(5);
  });

  it('prints the Google URL on stderr in JSON mode and polls the daemon attempt', async () => {
    const h = await harness();
    mocks.delay.mockImplementationOnce(async () => {
      const url = vi.mocked(console.error).mock.calls.map((call) => String(call[0])).find((line) => line.startsWith(h.cloud.url))!;
      const callback = new URL(new URL(url).searchParams.get('redirect_to')!);
      callback.searchParams.set('code', 'cli-auth-code');
      const response = await h.request(`${callback.pathname}${callback.search}`, 'GET', undefined, true);
      expect(response.status).toBe(200); await response.text();
    });
    await runAccountCli(['login', '--google', '--no-browser', '--daemon-url', h.url, '--json']);
    expect(process.exitCode).toBe(0);
    expect(output().user.provider).toBe('google');
    expect(vi.mocked(console.log).mock.calls).toHaveLength(1);
    expect(mocks.delay).toHaveBeenCalledOnce();
  });
});

describe('pixo credits', () => {
  it('uses the same daemon routes for catalog, balance, history, checkout and portal', async () => {
    const h = await harness();
    const invoke = async (args: string[]) => {
      vi.mocked(console.log).mockClear();
      await runCreditsCli([...args, '--daemon-url', h.url, '--json']);
      expect(process.exitCode).toBe(0);
      expect(vi.mocked(console.log).mock.calls).toHaveLength(1);
      return output();
    };
    expect(await invoke(['catalog'])).toEqual(CATALOG);
    await h.signIn();
    expect(await invoke(['balance'])).toEqual(BALANCE);
    expect(await invoke(['history', '--limit', '7', '--cursor', 'page+two'])).toEqual(LEDGER);
    const ledger = h.cloud.requests.find((request) => request.url.pathname.endsWith('/credits-ledger'))!;
    expect(ledger.url.searchParams.get('limit')).toBe('7'); expect(ledger.url.searchParams.get('cursor')).toBe('page+two');
    expect(await invoke(['buy', 'credits_1000', '--no-browser'])).toEqual(CHECKOUT);
    expect(vi.mocked(console.error).mock.calls.some((call) => String(call[0]).includes('after payment is confirmed'))).toBe(true);
    expect(await invoke(['portal', '--no-browser'])).toEqual(PORTAL);
  });

  it('supports help and returns JSON errors for invalid limits and signed-out requests', async () => {
    await runCreditsCli(['--help']);
    expect(String(vi.mocked(console.log).mock.calls[0]?.[0])).toContain('credits buy <sku>');
    const h = await harness();
    await runCreditsCli(['history', '--limit', '101', '--daemon-url', h.url, '--json']);
    expect(output().error.code).toBe('BAD_REQUEST');
    expect(h.cloud.requests).toHaveLength(0);
    await runCreditsCli(['balance', '--daemon-url', h.url, '--json']);
    expect(output().error.code).toBe('ACCOUNT_SIGNED_OUT');
    expect(process.exitCode).toBe(5);
  });

  it('formats catalog prices in the currency minor unit, including zero-decimal currencies', async () => {
    const h = await harness();
    h.cloud.handlers.set('GET /functions/v1/catalog', () => ({ body: { ...CATALOG,
      topups: [{ ...CATALOG.topups[0], currency: 'jpy', amountMinor: 1000 }], plans: [] } }));
    await runCreditsCli(['catalog', '--daemon-url', h.url]);
    const text = String(vi.mocked(console.log).mock.calls.at(-1)?.[0]);
    expect(text).toContain('1,000');
    expect(text).not.toContain('10.00');
  });
});
