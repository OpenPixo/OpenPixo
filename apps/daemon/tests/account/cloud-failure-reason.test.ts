import { afterEach, describe, expect, it, vi } from 'vitest';
import { creditsSummary } from '../../src/account/credits.js';
import { AccountError } from '../../src/account/errors.js';
import { SupabaseClient } from '../../src/account/supabase.js';

const client = new SupabaseClient({ url: 'https://cloud.example', anonKey: 'anon' } as ConstructorParameters<typeof SupabaseClient>[0]);
const failure = async (run: () => Promise<unknown> | unknown): Promise<AccountError> => {
  try { await run(); } catch (error) { return error as AccountError; }
  throw new Error('expected a failure');
};
const answer = (status: number, body: unknown) => vi.stubGlobal('fetch', vi.fn(async () => Response.json(body, { status })));

afterEach(() => vi.unstubAllGlobals());

// Billing retries key on CLOUD_UNAVAILABLE, so the code stays the same in every case. The reason
// only separates "we could not reach the cloud" from "the cloud answered with a failure".
describe('why the cloud request failed', () => {
  it('leaves an unreachable cloud without a reason, so it can blame the connection', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    const error = await failure(() => client.edge('credits', 'GET'));
    expect(error.code).toBe('CLOUD_UNAVAILABLE');
    expect(error.response().error.reason).toBeUndefined();
  });

  it('marks a failure the cloud itself reported', async () => {
    answer(503, { error: { code: 'CLOUD_UNAVAILABLE', message: 'Cloud service unavailable.' } });
    const error = await failure(() => client.edge('create-checkout', 'POST', { sku: 'topup_1000' }));
    expect(error.code).toBe('CLOUD_UNAVAILABLE');
    expect(error.response().error.reason).toBe('service');
    expect(error.message).not.toMatch(/connection|network/iu);
  });

  it('marks an answer with no usable error code', async () => {
    answer(500, { message: 'boom' });
    const error = await failure(() => client.edge('credits', 'GET'));
    expect(error.code).toBe('CLOUD_UNAVAILABLE');
    expect(error.response().error.reason).toBe('service');
  });

  it('marks a reply the daemon cannot read', async () => {
    const error = await failure(() => creditsSummary({ available: 'lots', reserved: 0, subscription: null }));
    expect(error.code).toBe('CLOUD_UNAVAILABLE');
    expect(error.response().error.reason).toBe('service');
  });

  it('keeps other known errors unchanged', async () => {
    answer(503, { error: { code: 'BILLING_PAUSED', message: 'Paused.' } });
    const error = await failure(() => client.edge('create-checkout', 'POST', { sku: 'topup_1000' }));
    expect(error.response().error).toEqual({ code: 'BILLING_PAUSED', message: 'New purchases are temporarily paused.' });
  });
});
