// A local-currency estimate beside a US-dollar price. The currency comes from
// the region in the system's language tags (en-GB → GBP, zh-CN → CNY, ja-JP →
// JPY); a dollar region, or no region at all, shows the dollar price alone.
// Rates are the daemon's daily reference rates, so the line is an estimate:
// checkout charges the catalogue's own currency.

import type { ExchangeRatesResponse } from '@openpixo/contracts';

const EURO = ['AT', 'BE', 'CY', 'DE', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PT', 'SI', 'SK'];

/** Region (ISO 3166) → currency (ISO 4217), for the currencies the rates source publishes. */
const REGION_CURRENCY: Record<string, string> = {
  ...Object.fromEntries(EURO.map((region) => [region, 'EUR'])),
  AU: 'AUD', BG: 'BGN', BR: 'BRL', CA: 'CAD', CH: 'CHF', CN: 'CNY', CZ: 'CZK', DK: 'DKK',
  GB: 'GBP', HK: 'HKD', HU: 'HUF', ID: 'IDR', IL: 'ILS', IN: 'INR', IS: 'ISK', JP: 'JPY',
  KR: 'KRW', MX: 'MXN', MY: 'MYR', NO: 'NOK', NZ: 'NZD', PH: 'PHP', PL: 'PLN', RO: 'RON',
  SE: 'SEK', SG: 'SGD', TH: 'THB', TR: 'TRY', ZA: 'ZAR',
};

/** Language tags that name no region but are read in one place almost everywhere. */
const LANGUAGE_REGION: Record<string, string> = { ja: 'JP', ko: 'KR', 'zh-hans': 'CN', 'zh-hant': 'TW' };

/** The local currency for these language tags, or null when it is the dollar or unknown. */
export function localCurrency(languages: readonly string[]): string | null {
  for (const tag of languages) {
    const region = regionOf(tag);
    if (!region) continue;
    return REGION_CURRENCY[region] ?? null;
  }
  return null;
}

function regionOf(tag: string): string | null {
  try {
    const region = new Intl.Locale(tag).maximize().region;
    if (region && new Intl.Locale(tag).region) return region.toUpperCase();
  } catch {
    // Not a valid tag; fall through to the short list.
  }
  const lower = tag.toLowerCase();
  return LANGUAGE_REGION[lower] ?? LANGUAGE_REGION[lower.split('-')[0] ?? ''] ?? null;
}

/** The system's language tags, most preferred first. */
export function systemLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return [];
  return navigator.languages?.length ? navigator.languages : navigator.language ? [navigator.language] : [];
}

/**
 * "≈ ¥137" for a US-dollar amount in minor units, or null when there is no
 * local currency, no rate for it, or the price is not in dollars.
 */
export function localEstimate(
  amountMinor: number,
  priceCurrency: string,
  currency: string | null,
  rates: ExchangeRatesResponse | null,
  locale: string,
): string | null {
  if (!currency || !rates || priceCurrency.toUpperCase() !== rates.base) return null;
  const rate = rates.rates[currency];
  if (!rate || currency === rates.base) return null;
  const value = (amountMinor / 100) * rate;
  // Whole units read cleanly; small amounts keep two decimals ("€4.47").
  const digits = value >= 20 ? 0 : 2;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency', currency, currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: digits, maximumFractionDigits: digits,
    }).format(value);
  } catch {
    return null;
  }
}
