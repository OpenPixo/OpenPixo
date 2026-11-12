import type { Express, NextFunction, Request, Response } from 'express';
import { AccountError, accountError } from '../account/errors.js';
import type { OpenPixoAccountService } from '../account/service.js';
import { record } from '../account/supabase.js';
import { sendApiError } from '../http/api-errors.js';
import { isLoopbackPeerAddress } from '../http/local-daemon-request.js';
import { isAgentToken } from '../http/tool-request-auth.js';

export interface RegisterOpenPixoAccountRoutesDeps { account: OpenPixoAccountService }

function callbackPage(ok: boolean, code: string): string {
  const expired = code === 'ACCOUNT_LOGIN_EXPIRED';
  const heading = ok ? 'Sign-in finished' : expired ? 'Sign-in expired' : 'Sign-in failed';
  const chinese = ok ? '登录已完成' : expired ? '登录已过期' : '登录未完成';
  return `<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${heading} · OpenPixo</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:36rem;margin:12vh auto;padding:24px;color:#20242b;background:#f6f7f9}h1{font-size:26px}p{margin:12px 0}</style>
<h1>${heading} / <span lang="zh-CN">${chinese}</span></h1>
<p>${ok ? 'You can close this tab and return to OpenPixo.' : 'Return to OpenPixo and start sign-in again.'}</p>
<p lang="zh-CN">${ok ? '请关闭此页面，返回 OpenPixo。' : '请返回 OpenPixo，重新发起登录。'}</p>
${ok ? '' : `<p>${code}</p>`}</html>`;
}

/** Register before API auth/origin middleware: only this GET has the loopback exception. */
export function registerOpenPixoAccountCallback(app: Express, { account }: RegisterOpenPixoAccountRoutesDeps): void {
  app.get('/api/openpixo/account/callback', async (req, res) => {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" });
    try {
      account.assertConfigured();
      if (!isLoopbackPeerAddress(req.socket.remoteAddress) || req.hostname !== '127.0.0.1') {
        throw new AccountError('ACCOUNT_LOGIN_FAILED');
      }
      await account.completeGoogle(req.query.attempt, req.query.code, req.query.error !== undefined);
      res.type('html').send(callbackPage(true, ''));
    } catch (error) {
      const failure = accountError(error);
      res.status(failure.status).type('html').send(callbackPage(false, failure.code));
    }
  });
}

export function registerOpenPixoAccountRoutes(app: Express, { account }: RegisterOpenPixoAccountRoutesDeps): void {
  app.use(['/api/openpixo/account', '/api/openpixo/credits', '/api/openpixo/cloud-media'], (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  const endpoint = (handler: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
    try {
      const result = await handler(req, res);
      if (!res.headersSent) res.json(result);
    } catch (error) {
      const failure = accountError(error);
      if (failure.retryAfterSec !== undefined) res.set('Retry-After', String(failure.retryAfterSec));
      res.status(failure.status).json(failure.response());
    }
  };

  app.get('/api/openpixo/account', endpoint(() => account.status()));
  app.post('/api/openpixo/account/sign-out', endpoint(() => account.signOut()));
  app.use(['/api/openpixo/account', '/api/openpixo/credits', '/api/openpixo/cloud-media'], (_req, res, next) => {
    try { account.assertConfigured(); next(); }
    catch (error) { const failure = accountError(error); res.status(failure.status).json(failure.response()); }
  });
  app.post('/api/openpixo/account/email/start', endpoint((req) => account.startEmail(record(req.body).email)));
  app.post('/api/openpixo/account/email/verify', endpoint((req) => {
    const input = record(req.body);
    return account.verifyEmail(input.email, input.code);
  }));
  app.post('/api/openpixo/account/google/start', endpoint(() => account.startGoogle()));
  app.get('/api/openpixo/account/google/attempts/:attemptId', endpoint((req) => account.googleAttempt(req.params.attemptId)));
  app.get('/api/openpixo/credits', endpoint(() => account.balance()));
  app.get('/api/openpixo/credits/ledger', endpoint(async (req, res) => {
    const rawLimit = req.query.limit;
    const limit = rawLimit === undefined ? 20 : typeof rawLimit === 'string' && /^\d{1,3}$/u.test(rawLimit) ? Number(rawLimit) : NaN;
    const cursor = req.query.cursor;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100
      || (cursor !== undefined && (typeof cursor !== 'string' || !cursor || cursor.length > 2048 || /[\x00-\x1f]/u.test(cursor)))) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'Use a limit from 1 to 100 and a valid optional cursor.');
    }
    return account.ledger(limit, cursor);
  }));
  app.get('/api/openpixo/credits/catalog', endpoint(() => account.catalog()));
  app.post('/api/openpixo/credits/checkout', endpoint((req) => account.checkout(record(req.body).sku)));
  app.post('/api/openpixo/credits/portal', endpoint(() => account.portal()));
  app.post('/api/openpixo/credits/plan-change/preview', endpoint((req) => account.planChangePreview(record(req.body).sku)));
  // These charge the saved card with no page in between, so only the user may call them, never a run's agent.
  const userOnly = (req: Request, res: Response, next: NextFunction) => {
    if (isAgentToken(req)) return sendApiError(res, 403, 'FORBIDDEN', 'Only the user can change plan.');
    next();
  };
  app.post('/api/openpixo/credits/plan-change', userOnly, endpoint((req) => {
    const input = record(req.body);
    return account.planChangeApply(input.sku, input.expectedChargeMinor);
  }));
  app.post('/api/openpixo/credits/plan-change/cancel', userOnly, endpoint(() => account.planChangeCancel()));
  // Says only that the balance may have moved; the UI re-reads it through the same route as everyone else.
  app.get('/api/openpixo/credits/events', (req, res) => {
    res.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    res.write(': connected\n\n');
    const stop = account.onCreditsChanged(() => { res.write('event: changed\ndata: {}\n\n'); });
    const heartbeat = setInterval(() => { res.write(': keep-alive\n\n'); }, 25_000);
    heartbeat.unref?.();
    req.on('close', () => { clearInterval(heartbeat); stop(); });
  });
  // Hosted generation: catalogue and quotes here; spending happens only through the
  // media generate route with a user-confirmed quote.
  app.get('/api/openpixo/cloud-media/services', endpoint(() => account.generationServices()));
  app.post('/api/openpixo/cloud-media/quote', endpoint((req) => {
    const input = record(req.body);
    return account.generationQuote(input.service, input.params);
  }));
  app.get('/api/openpixo/cloud-media/jobs/:jobId', endpoint(async (req) => {
    // The signed artifact URL stays inside the daemon.
    const { download: _download, ...job } = await account.generationJob(String(req.params.jobId));
    return job;
  }));
}
