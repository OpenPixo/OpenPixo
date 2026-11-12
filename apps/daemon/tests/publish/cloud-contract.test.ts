import { afterEach, beforeEach, expect, it } from 'vitest';
import { AccountError, PublishCloudError } from '../../src/account/errors.js';
import { accountHarness } from '../account/fixtures.js';
import { GAME, USAGE } from './harness.js';

/** The real account service against a fake Supabase: the exact requests and answers of the spec's cloud contract. */
let h: Awaited<ReturnType<typeof accountHarness>>;

const BEGIN = { shareId: 'share-1', version: 2, uploadBaseUrl: 'https://play.example/__upload/share-1', uploadToken: 'token', url: GAME.url };
const STATUS = { game: GAME, usage: USAGE, paused: { publish: false, rooms: true }, termsAccepted: true, termsUrl: 'https://openpixo.example/rules', limits: { maxPlayers: 8, creditsPerPlayerHour: 5 } };
const requestsTo = (name: string) => h.cloud.requests.filter(request => request.url.pathname === `/functions/v1/${name}`);

beforeEach(async () => {
  h = await accountHarness();
  await h.signIn();
});
afterEach(async () => { await h.close(); });

it('sends publish-begin with the signed-in session and keeps only the contract fields', async () => {
  h.cloud.handlers.set('POST /functions/v1/publish-begin', () => ({ body: { ...BEGIN, debug: 'secret' } }));
  const files = [{ path: 'index.html', size: 1, sha256: 'a'.repeat(64) }];
  expect(await h.account.publishBegin({ title: 'Game', acceptTerms: true, files })).toEqual(BEGIN);
  const [request] = requestsTo('publish-begin');
  expect(request!.headers.authorization).toMatch(/^Bearer /u);
  expect(request!.body).toEqual({ title: 'Game', acceptTerms: true, files });
});

it('reads a status with and without a share id', async () => {
  h.cloud.handlers.set('GET /functions/v1/share-status', () => ({ body: STATUS }));
  expect(await h.account.shareStatus('share 1')).toEqual(STATUS);
  expect(requestsTo('share-status')[0]!.url.search).toBe('?shareId=share%201');
  await h.account.shareStatus();
  expect(requestsTo('share-status')[1]!.url.search).toBe('');
});

it('accepts a status from before anything is published or the rules page exists', async () => {
  h.cloud.handlers.set('GET /functions/v1/share-status', () => ({ body: { ...STATUS, game: null, usage: null, termsUrl: '' } }));
  expect(await h.account.shareStatus()).toMatchObject({ game: null, usage: null, termsUrl: '' });
});

it('finishes, removes and sets a limit', async () => {
  h.cloud.handlers.set('POST /functions/v1/publish-finish', () => ({ body: { game: GAME } }));
  h.cloud.handlers.set('POST /functions/v1/share-remove', () => ({ body: { ok: true } }));
  h.cloud.handlers.set('POST /functions/v1/share-limit', () => ({ body: { usage: USAGE } }));
  expect(await h.account.publishFinish('share-1', 2)).toEqual(GAME);
  expect(requestsTo('publish-finish')[0]!.body).toEqual({ shareId: 'share-1', version: 2 });
  await h.account.shareRemove('share-1');
  expect(requestsTo('share-remove')[0]!.body).toEqual({ shareId: 'share-1' });
  expect(await h.account.shareLimit('share-1', 900)).toEqual(USAGE);
  expect(requestsTo('share-limit')[0]!.body).toEqual({ shareId: 'share-1', monthlyCreditLimit: 900 });
});

it('turns a refusal into a typed error that names the files', async () => {
  h.cloud.handlers.set('POST /functions/v1/publish-begin', () => ({ status: 422, body: { error: { code: 'PUBLISH_REFUSED', message: 'Password pages are not allowed.', refusedFiles: ['login.html', 7] } } }));
  const error = await h.account.publishBegin({ title: 'x', files: [] }).catch((caught: unknown) => caught) as PublishCloudError;
  expect(error).toBeInstanceOf(PublishCloudError);
  expect(error.response()).toEqual({ error: { code: 'PUBLISH_REFUSED', message: 'Password pages are not allowed.', refusedFiles: ['login.html'] } });
  expect(error.status).toBe(422);
});

it.each([
  ['PUBLISH_PAUSED', 503],
  ['PUBLISH_QUOTA', 429],
  ['SHARE_TERMS_REQUIRED', 409],
  ['SHARE_NOT_FOUND', 404],
  ['PUBLISH_PLAN_REQUIRED', 402],
  ['PUBLISH_EXTRA_GAME_REQUIRED', 402],
] as const)('maps %s to %i', async (code, status) => {
  h.cloud.handlers.set('POST /functions/v1/publish-begin', () => ({ status, body: { error: { code, message: 'x' } } }));
  await expect(h.account.publishBegin({ title: 'x', files: [] })).rejects.toMatchObject({ code, status });
});

it('forwards the extra-game agreement to publish-begin', async () => {
  h.cloud.handlers.set('POST /functions/v1/publish-begin', () => ({ body: BEGIN }));
  await h.account.publishBegin({ title: 'Game', payExtraGame: true, files: [] });
  expect(requestsTo('publish-begin')[0]!.body).toEqual({ title: 'Game', payExtraGame: true, files: [] });
});

it('keeps the extra-game price and the cloud’s words', async () => {
  const message = 'Your Starter plan includes 10 public games and all are in use. Publish this one for 100 credits, charged once; updates stay free.';
  h.cloud.handlers.set('POST /functions/v1/publish-begin', () => ({ status: 402, body: { error: { code: 'PUBLISH_EXTRA_GAME_REQUIRED', credits: 100, message } } }));
  const error = await h.account.publishBegin({ title: 'x', payExtraGame: false, files: [] }).catch((caught: unknown) => caught) as PublishCloudError;
  expect(error).toBeInstanceOf(PublishCloudError);
  expect(error.status).toBe(402);
  expect(error.response()).toEqual({ error: { code: 'PUBLISH_EXTRA_GAME_REQUIRED', credits: 100, message } });
  expect(requestsTo('publish-begin')[0]!.body).toMatchObject({ payExtraGame: false });
});

it('uses its own extra-game words, with the price, for an unreadable cloud message', async () => {
  h.cloud.handlers.set('POST /functions/v1/publish-begin', () => ({ status: 402, body: { error: { code: 'PUBLISH_EXTRA_GAME_REQUIRED', credits: 100, message: 'x'.repeat(501) } } }));
  const error = await h.account.publishBegin({ title: 'x', files: [] }).catch((caught: unknown) => caught) as PublishCloudError;
  expect(error.message).toBe("Your plan's public games are all in use. Publishing this one costs 100 credits, charged once; updates stay free.");
});

it('maps too few credits for the charge to the account error', async () => {
  h.cloud.handlers.set('POST /functions/v1/publish-begin', () => ({ status: 402, body: { error: { code: 'INSUFFICIENT_CREDITS',
    message: 'Publishing this game costs 100 credits and you have 40. Buy credits, then publish again.' } } }));
  await expect(h.account.publishBegin({ title: 'x', payExtraGame: true, files: [] })).rejects.toMatchObject({ code: 'INSUFFICIENT_CREDITS', status: 402 });
});

it.each([[-1], [1.5], ['100'], [null]])('drops an unusable extra-game price %j', async credits => {
  h.cloud.handlers.set('POST /functions/v1/publish-begin', () => ({ status: 402, body: { error: { code: 'PUBLISH_EXTRA_GAME_REQUIRED', credits, message: 'x' } } }));
  const error = await h.account.publishBegin({ title: 'x', files: [] }).catch((caught: unknown) => caught) as PublishCloudError;
  expect(error.credits).toBeUndefined();
  expect(error.response().error).not.toHaveProperty('credits');
});

it('reads the extra-game plan fields and an extra game, and an older status without them', async () => {
  const plan = { planRequired: false, sku: 'plan_starter_monthly_v3', maxLiveGames: 10, maxGameBytes: 1, liveGames: 10 };
  h.cloud.handlers.set('GET /functions/v1/share-status', () => ({ body: { ...STATUS, game: { ...GAME, extraPaid: true }, publishPlan: { ...plan, extraGameCredits: 100, extraGames: 2 } } }));
  expect(await h.account.shareStatus()).toMatchObject({ game: { extraPaid: true }, publishPlan: { extraGameCredits: 100, extraGames: 2 } });
  h.cloud.handlers.set('GET /functions/v1/share-status', () => ({ body: { ...STATUS, publishPlan: plan } }));
  const old = await h.account.shareStatus();
  expect(old.publishPlan).toEqual(plan);
  expect(old.game).not.toHaveProperty('extraPaid');
});

it('uses its own words except where the cloud explains a refusal or quota', () => {
  expect(new PublishCloudError('SHARE_NOT_FOUND', 'select * from shares failed').message).not.toContain('select');
  expect(new PublishCloudError('PUBLISH_QUOTA', 'x'.repeat(501)).message).not.toContain('xxx');
  expect(new PublishCloudError('PUBLISH_QUOTA', '30 publishes a day.').message).toBe('30 publishes a day.');
});

it.each([
  ['a non-web upload target', { ...BEGIN, uploadBaseUrl: 'ftp://play.example' }],
  ['a cleartext upload target', { ...BEGIN, uploadBaseUrl: 'http://play.example' }],
  ['a missing token', { ...BEGIN, uploadToken: '' }],
  ['version zero', { ...BEGIN, version: 0 }],
  ['an unsafe share id', { ...BEGIN, shareId: '../other' }],
])('rejects a begin response with %s', async (_name, body) => {
  h.cloud.handlers.set('POST /functions/v1/publish-begin', () => ({ body }));
  await expect(h.account.publishBegin({ title: 'x', files: [] })).rejects.toBeInstanceOf(AccountError);
});

it('allows loopback upload targets for local Workers', async () => {
  const local = { ...BEGIN, uploadBaseUrl: 'http://localhost:8787/__upload/share-1', url: 'http://localhost:8787/share-1' };
  h.cloud.handlers.set('POST /functions/v1/publish-begin', () => ({ body: local }));
  expect(await h.account.publishBegin({ title: 'x', files: [] })).toEqual(local);
});
