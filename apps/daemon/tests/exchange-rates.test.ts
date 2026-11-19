import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EXCHANGE_RATES_MAX_AGE_MS,
  EXCHANGE_RATES_RETRY_MS,
  ExchangeRates,
  ExchangeRatesUnavailableError,
} from '../src/exchange-rates/service.js';

const SOURCE = { amount: 1, base: 'USD', date: '2026-11-18', rates: { CNY: 6.6672, EUR: 0.91174, JPY: 159.42 } };
const dirs: string[] = [];

async function dataDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pixo-rates-'));
  dirs.push(dir);
  return dir;
}

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('ExchangeRates', () => {
  it('fetches USD rates once a day and keeps a copy in the data root', async () => {
    const dir = await dataDir();
    let now = Date.parse('2026-11-19T08:00:00Z');
    const fetch = vi.fn(async () => reply(SOURCE));
    const rates = new ExchangeRates({ dataDir: dir, fetch, now: () => now });

    const first = await rates.latest();
    expect(first).toMatchObject({ base: 'USD', date: '2026-11-18', stale: false });
    expect(first.rates).toMatchObject({ CNY: 6.6672, JPY: 159.42, USD: 1 });

    now += EXCHANGE_RATES_MAX_AGE_MS - 1;
    await rates.latest();
    expect(fetch).toHaveBeenCalledTimes(1);

    const saved = JSON.parse(await readFile(path.join(dir, 'exchange-rates.json'), 'utf8'));
    expect(saved.rates.EUR).toBe(0.91174);

    now += 2;
    await rates.latest();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('serves the saved copy, marked stale, when the source is down', async () => {
    const dir = await dataDir();
    let now = Date.parse('2026-11-19T08:00:00Z');
    await new ExchangeRates({ dataDir: dir, fetch: async () => reply(SOURCE), now: () => now }).latest();

    now += EXCHANGE_RATES_MAX_AGE_MS * 3;
    const offline = vi.fn(async () => { throw new Error('offline'); });
    const restarted = new ExchangeRates({ dataDir: dir, fetch: offline, now: () => now });
    const result = await restarted.latest();
    expect(result).toMatchObject({ stale: true, date: '2026-11-18' });
    expect(result.rates.JPY).toBe(159.42);

    // A failed refresh is not retried on every request.
    await restarted.latest();
    expect(offline).toHaveBeenCalledTimes(1);
    now += EXCHANGE_RATES_RETRY_MS;
    await restarted.latest();
    expect(offline).toHaveBeenCalledTimes(2);
  });

  it('refuses a body that is not a USD rate table, and says so when it has nothing', async () => {
    const dir = await dataDir();
    const bad = new ExchangeRates({ dataDir: dir, fetch: async () => reply({ base: 'EUR', date: '2026-11-18', rates: { USD: 1.1 } }) });
    await expect(bad.latest()).rejects.toBeInstanceOf(ExchangeRatesUnavailableError);

    const broken = new ExchangeRates({ dataDir: await dataDir(), fetch: async () => reply({ base: 'USD', date: '2026-11-18', rates: { JPY: -1, cny: 6 } }) });
    await expect(broken.latest()).rejects.toBeInstanceOf(ExchangeRatesUnavailableError);

    const down = new ExchangeRates({ dataDir: await dataDir(), fetch: async () => reply({}, 503) });
    await expect(down.latest()).rejects.toBeInstanceOf(ExchangeRatesUnavailableError);
  });
});
