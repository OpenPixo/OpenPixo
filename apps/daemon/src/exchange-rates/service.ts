// Daily reference exchange rates for showing a local estimate beside a US-dollar
// price. The source is the European Central Bank's daily reference rates served
// by Frankfurter (no key, no account, and the request carries nothing about the
// user). Rates are cached in memory and in the daemon data root, refreshed at
// most once a day, and an old copy is served when a refresh fails, so prices
// keep their estimate offline. Nothing is billed from these numbers.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ExchangeRatesResponse } from '@openpixo/contracts';

export const EXCHANGE_RATES_SOURCE_URL = 'https://api.frankfurter.dev/v1/latest?base=USD';
export const EXCHANGE_RATES_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** After a failed refresh, wait this long before asking the source again. */
export const EXCHANGE_RATES_RETRY_MS = 15 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8_000;
const CACHE_FILE = 'exchange-rates.json';

export class ExchangeRatesUnavailableError extends Error {
  constructor() { super('Exchange rates are not available right now.'); }
}

export interface ExchangeRatesDeps {
  /** The resolved daemon data root (`RUNTIME_DATA_DIR`). */
  dataDir: string;
  fetch?: typeof fetch;
  now?: () => number;
  sourceUrl?: string;
}

interface Cached { date: string; fetchedAt: number; rates: Record<string, number> }

export class ExchangeRates {
  private readonly file: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly sourceUrl: string;
  private cached: Cached | null = null;
  private loadedFromDisk = false;
  private lastFailureAt = -Infinity;
  private inFlight: Promise<Cached | null> | null = null;

  constructor({ dataDir, fetch: fetchImpl = fetch, now = Date.now, sourceUrl = EXCHANGE_RATES_SOURCE_URL }: ExchangeRatesDeps) {
    this.file = path.join(dataDir, CACHE_FILE);
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.sourceUrl = sourceUrl;
  }

  async latest(): Promise<ExchangeRatesResponse> {
    if (!this.loadedFromDisk) { this.loadedFromDisk = true; this.cached = await this.readCache(); }
    const fresh = this.cached && this.now() - this.cached.fetchedAt < EXCHANGE_RATES_MAX_AGE_MS;
    const mayRetry = this.now() - this.lastFailureAt >= EXCHANGE_RATES_RETRY_MS;
    let stale = false;
    if (!fresh && mayRetry) {
      this.inFlight ??= this.refresh().finally(() => { this.inFlight = null; });
      const next = await this.inFlight;
      if (next) this.cached = next; else stale = true;
    } else if (!fresh) {
      stale = true;
    }
    if (!this.cached) throw new ExchangeRatesUnavailableError();
    return {
      base: 'USD',
      date: this.cached.date,
      fetchedAt: new Date(this.cached.fetchedAt).toISOString(),
      stale,
      rates: { ...this.cached.rates, USD: 1 },
    };
  }

  private async refresh(): Promise<Cached | null> {
    try {
      const response = await this.fetchImpl(this.sourceUrl, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`status ${response.status}`);
      const parsed = parseSource(await response.json());
      if (!parsed) throw new Error('unexpected body');
      const next: Cached = { ...parsed, fetchedAt: this.now() };
      await this.writeCache(next);
      return next;
    } catch {
      this.lastFailureAt = this.now();
      return null;
    }
  }

  private async readCache(): Promise<Cached | null> {
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8')) as Partial<Cached>;
      const rates = cleanRates(raw.rates);
      if (typeof raw.date !== 'string' || typeof raw.fetchedAt !== 'number' || !rates) return null;
      return { date: raw.date, fetchedAt: raw.fetchedAt, rates };
    } catch {
      return null;
    }
  }

  private async writeCache(value: Cached): Promise<void> {
    try {
      await mkdir(path.dirname(this.file), { recursive: true });
      const temp = `${this.file}.${process.pid}.tmp`;
      await writeFile(temp, JSON.stringify(value), 'utf8');
      await rename(temp, this.file);
    } catch {
      // The in-memory copy still serves this run; the next refresh writes again.
    }
  }
}

/** The source's `{ base, date, rates }`, kept only when it is a USD table of positive numbers. */
function parseSource(body: unknown): { date: string; rates: Record<string, number> } | null {
  if (!body || typeof body !== 'object') return null;
  const { base, date, rates } = body as Record<string, unknown>;
  const clean = cleanRates(rates);
  if (base !== 'USD' || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(date) || !clean) return null;
  return { date, rates: clean };
}

function cleanRates(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== 'object') return null;
  const rates: Record<string, number> = {};
  for (const [code, rate] of Object.entries(value as Record<string, unknown>)) {
    if (/^[A-Z]{3}$/u.test(code) && typeof rate === 'number' && Number.isFinite(rate) && rate > 0) rates[code] = rate;
  }
  return Object.keys(rates).length > 0 ? rates : null;
}
