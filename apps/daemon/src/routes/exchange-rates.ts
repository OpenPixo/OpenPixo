import type { Express } from 'express';
import { sendApiError } from '../http/api-errors.js';
import type { ExchangeRates } from '../exchange-rates/service.js';

export interface RegisterExchangeRatesRoutesDeps { exchangeRates: ExchangeRates }

/** Reference rates for local price estimates; display only, never used to bill. */
export function registerExchangeRatesRoutes(app: Express, { exchangeRates }: RegisterExchangeRatesRoutesDeps): void {
  app.get('/api/exchange-rates', async (_req, res) => {
    try {
      res.set('Cache-Control', 'no-store');
      res.json(await exchangeRates.latest());
    } catch {
      sendApiError(res, 503, 'UPSTREAM_UNAVAILABLE', 'Exchange rates are not available right now.');
    }
  });
}
