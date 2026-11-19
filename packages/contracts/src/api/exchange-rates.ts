/**
 * Reference exchange rates the app uses to show a local estimate next to a
 * US-dollar price. Display only: checkout always charges the catalogue's own
 * currency, and nothing is priced or billed from these numbers.
 */
export interface ExchangeRatesResponse {
  /** Every rate is units of that currency per one `base` unit. */
  base: 'USD';
  /** The day the source published these rates (YYYY-MM-DD). */
  date: string;
  /** When the daemon last fetched them (ISO 8601). */
  fetchedAt: string;
  /** True when the latest refresh failed and an older copy is served. */
  stale: boolean;
  /** ISO 4217 code → units per US dollar. */
  rates: Record<string, number>;
}
