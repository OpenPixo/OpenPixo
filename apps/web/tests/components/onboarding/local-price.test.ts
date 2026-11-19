import { describe, expect, it } from 'vitest';
import type { ExchangeRatesResponse } from '@openpixo/contracts';
import { localCurrency, localEstimate } from '../../../src/components/onboarding/local-price';
import { formatMinorAmount } from '../../../src/components/account/account-format';

const RATES: ExchangeRatesResponse = {
  base: 'USD', date: '2026-11-18', fetchedAt: '2026-11-19T08:00:00.000Z', stale: false,
  rates: { USD: 1, CNY: 6.6672, EUR: 0.91174, JPY: 159.42, GBP: 0.75939 },
};

describe('localCurrency', () => {
  it('reads the currency from the region of the first tag that names one', () => {
    expect(localCurrency(['zh-CN', 'en-US'])).toBe('CNY');
    expect(localCurrency(['ja-JP'])).toBe('JPY');
    expect(localCurrency(['de-DE'])).toBe('EUR');
    expect(localCurrency(['en', 'en-GB'])).toBe('GBP');
    expect(localCurrency(['ja'])).toBe('JPY');
  });

  it('shows no estimate for dollar regions, unknown regions or no region', () => {
    expect(localCurrency(['en-US'])).toBeNull();
    expect(localCurrency(['en'])).toBeNull();
    expect(localCurrency(['es-AR'])).toBeNull();
    expect(localCurrency([])).toBeNull();
  });
});

describe('localEstimate', () => {
  it('converts a dollar price with a plain symbol and no ISO or country prefix', () => {
    expect(localEstimate(1900, 'usd', 'CNY', RATES, 'zh-CN')).toBe('¥127');
    expect(localEstimate(1900, 'usd', 'JPY', RATES, 'en')).toBe('¥3,029');
    expect(localEstimate(490, 'usd', 'EUR', RATES, 'en')).toBe('€4.47');
    for (const text of [localEstimate(5900, 'usd', 'CNY', RATES, 'en'), localEstimate(5900, 'usd', 'JPY', RATES, 'zh-CN')]) {
      expect(text).not.toMatch(/CN¥|JP¥|RMB|CNY|JPY|US/);
    }
  });

  it('gives nothing without a rate, for the dollar itself, or for a non-dollar price', () => {
    expect(localEstimate(1900, 'usd', 'KRW', RATES, 'en')).toBeNull();
    expect(localEstimate(1900, 'usd', 'USD', RATES, 'en')).toBeNull();
    expect(localEstimate(1900, 'eur', 'CNY', RATES, 'en')).toBeNull();
    expect(localEstimate(1900, 'usd', 'CNY', null, 'en')).toBeNull();
  });
});

describe('formatMinorAmount', () => {
  it('writes dollars as "$" in every UI locale', () => {
    expect(formatMinorAmount(490, 'usd', 'en')).toBe('$4.90');
    expect(formatMinorAmount(490, 'usd', 'zh-CN')).toBe('$4.90');
  });
});
