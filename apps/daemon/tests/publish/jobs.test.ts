import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { EngineProfile, PublishedGame, PublishPlan } from '@openpixo/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountError, PublishCloudError } from '../../src/account/errors.js';
import { PublishBuildError } from '../../src/publish/build.js';
import { extraGamePrice } from '../../src/publish/extra-game.js';
import { PublishJobs, type PublishJobsDeps, type PublishProjectContext } from '../../src/publish/jobs.js';
import { UPLOAD_ATTEMPTS, UPLOAD_CONCURRENCY, uploadUrl } from '../../src/publish/upload.js';
import { fakeAccount, fakeUploads, GAME, shareStatus, writeGameFiles } from './harness.js';

let root: string;
let uploads: Awaited<ReturnType<typeof fakeUploads>>;
let account: ReturnType<typeof fakeAccount>;
let build: ReturnType<typeof vi.fn<PublishJobsDeps['build']>>;
let saved: (string | null)[];
let sleeps: number[];
let existingShare: string | undefined;

const PROFILE = { engine: 'phaser', commands: { build: { argv: ['pnpm', 'run', 'build'], cwd: '.', timeoutMs: 120_000 } }, evidence: ['package.json'] } as unknown as EngineProfile;

function jobs(): PublishJobs {
  return new PublishJobs({ account, build, saveShareId: (_id, shareId) => { saved.push(shareId); },
    prepare: async (): Promise<PublishProjectContext> => ({ projectDir: root, profile: PROFILE, title: 'My game', ...(existingShare ? { shareId: existingShare } : {}) }),
    sleep: async ms => { sleeps.push(ms); } });
}

async function finish(queue: PublishJobs, request = {}) {
  queue.start('game', request);
  await queue.settled('game');
  return queue.get('game')!;
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'openpixo-publish-'));
  await writeGameFiles(root);
  uploads = await fakeUploads();
  account = fakeAccount(uploads.baseUrl);
  build = vi.fn<PublishJobsDeps['build']>(async () => {});
  saved = []; sleeps = []; existingShare = undefined;
});

afterEach(async () => {
  await uploads.close();
  await rm(root, { recursive: true, force: true });
});

it('builds, uploads every file with its token and activates the link', async () => {
  const queue = jobs();
  const started = queue.start('game', { title: 'Space rocks' });
  expect(started.phase).toBe('building');
  await queue.settled('game');
  expect(queue.get('game')).toMatchObject({ phase: 'done', filesDone: 3, filesTotal: 3 });
  expect(queue.get('game')).not.toHaveProperty('error');
  expect(queue.lastGame('game')).toEqual(GAME);
  expect(build).toHaveBeenCalledTimes(1);
  const [begin] = account.publishBegin.mock.calls[0]!;
  expect(begin).toMatchObject({ title: 'Space rocks' });
  expect(begin).not.toHaveProperty('shareId');
  expect(begin).not.toHaveProperty('acceptTerms');
  expect(begin.files.map(file => file.path)).toEqual(['assets/game.js', 'assets/hero sprite.png', 'index.html']);
  expect(uploads.accepted.get('assets/hero sprite.png')).toEqual({ sha256: createHash('sha256').update('png').digest('hex'), size: 3, authorization: 'Bearer upload-token' });
  expect(account.publishFinish).toHaveBeenCalledWith('share-1', 2);
  expect(saved).toEqual(['share-1']);
});

it('encodes each path segment and keeps the slashes', () => {
  expect(uploadUrl('https://up.example/x/', 3, 'assets/hero sprite#1.png')).toBe('https://up.example/x/3/assets/hero%20sprite%231.png');
});

it('sends the saved share id, so a new version keeps its link', async () => {
  existingShare = 'share-9';
  expect((await finish(jobs())).phase).toBe('done');
  expect(account.publishBegin.mock.calls[0]![0]).toMatchObject({ shareId: 'share-9' });
  expect(account.shareStatus).toHaveBeenCalledWith('share-9');
});

it('skips the build when asked and uploads what is already there', async () => {
  const queue = jobs();
  expect(queue.start('game', { skipBuild: true }).phase).toBe('checking');
  await queue.settled('game');
  expect(build).not.toHaveBeenCalled();
  expect(queue.get('game')!.phase).toBe('done');
});

it('runs at most one job per project and shares the running one', async () => {
  const releases: (() => void)[] = [];
  build.mockImplementation(() => new Promise<void>(resolve => { releases.push(resolve); }));
  const queue = jobs();
  const first = queue.start('game', {});
  expect(queue.start('game', { title: 'Other' }).id).toBe(first.id);
  expect(queue.start('other-game', {}).id).not.toBe(first.id);
  await vi.waitFor(() => { expect(build).toHaveBeenCalledTimes(2); });
  expect(queue.running('game')).toBe(true);
  for (const release of releases) release();
  await Promise.all([queue.settled('game'), queue.settled('other-game')]);
  expect(account.publishBegin.mock.calls.map(([input]) => input.title)).toEqual(['My game', 'My game']);
  // Once it finished, the project can publish again as a new job.
  expect(queue.start('game', {}).id).not.toBe(first.id);
  await vi.waitFor(() => { expect(releases.length).toBe(3); });
  releases[2]!();
  await queue.settled('game');
});

it('reports a missing plan before building anything', async () => {
  account.shareStatus.mockResolvedValue(shareStatus({ publishPlan: { planRequired: true, sku: null, maxLiveGames: 0, maxGameBytes: 0, liveGames: 0 } }));
  const job = await finish(jobs());
  expect(job).toMatchObject({ phase: 'failed', error: { code: 'PUBLISH_PLAN_REQUIRED' } });
  expect(build).not.toHaveBeenCalled();
  expect(account.publishBegin).not.toHaveBeenCalled();
});

it('reports paused before building anything', async () => {
  account.shareStatus.mockResolvedValue(shareStatus({ paused: { publish: true, rooms: true } }));
  const job = await finish(jobs());
  expect(job).toMatchObject({ phase: 'failed', error: { code: 'PUBLISH_PAUSED' } });
  expect(build).not.toHaveBeenCalled();
  expect(account.publishBegin).not.toHaveBeenCalled();
});

it('asks for the sharing rules before building, and passes on an acceptance', async () => {
  account.shareStatus.mockResolvedValue(shareStatus({ termsAccepted: false }));
  expect(await finish(jobs())).toMatchObject({ phase: 'failed', error: { code: 'SHARE_TERMS_REQUIRED' } });
  expect(build).not.toHaveBeenCalled();
  expect((await finish(jobs(), { acceptTerms: true })).phase).toBe('done');
  expect(account.publishBegin.mock.calls[0]![0]).toMatchObject({ acceptTerms: true });
});

it('names the files a local check refuses, without contacting the upload server', async () => {
  await writeGameFiles(root, { 'dist/virus.exe': 'x' });
  const job = await finish(jobs());
  expect(job).toMatchObject({ phase: 'failed', error: { code: 'PUBLISH_REFUSED' }, refusedFiles: ['virus.exe'] });
  expect(account.publishBegin).not.toHaveBeenCalled();
});

it('names the files the server refuses', async () => {
  account.publishBegin.mockRejectedValue(new PublishCloudError('PUBLISH_REFUSED', 'These files are not allowed.', ['evil.html']));
  expect(await finish(jobs())).toMatchObject({ phase: 'failed', error: { code: 'PUBLISH_REFUSED', message: 'These files are not allowed.' }, refusedFiles: ['evil.html'] });
  expect(account.publishFinish).not.toHaveBeenCalled();
});

it.each([
  [new PublishCloudError('PUBLISH_QUOTA'), 'PUBLISH_QUOTA'],
  [new PublishCloudError('PUBLISH_PAUSED'), 'PUBLISH_PAUSED'],
  [new AccountError('ACCOUNT_SIGNED_OUT'), 'ACCOUNT_SIGNED_OUT'],
  [new AccountError('CLOUD_UNAVAILABLE'), 'CLOUD_UNAVAILABLE'],
])('reports %s from publish-begin', async (error, code) => {
  account.publishBegin.mockRejectedValue(error);
  expect(await finish(jobs())).toMatchObject({ phase: 'failed', error: { code } });
});

it('starts a new link when the saved one no longer exists', async () => {
  existingShare = 'gone';
  account.publishBegin.mockRejectedValueOnce(new PublishCloudError('SHARE_NOT_FOUND'));
  const job = await finish(jobs());
  expect(job.phase).toBe('done');
  expect(account.publishBegin.mock.calls[0]![0]).toMatchObject({ shareId: 'gone' });
  expect(account.publishBegin.mock.calls[1]![0]).not.toHaveProperty('shareId');
  expect(saved).toEqual([null, 'share-1']);
});

it('shows a failed build with its reason and uploads nothing', async () => {
  build.mockRejectedValue(new PublishBuildError('The game failed to build.\nsrc/main.ts(1): error'));
  expect(await finish(jobs())).toMatchObject({ phase: 'failed', error: { code: 'PUBLISH_BUILD_FAILED', message: expect.stringContaining('src/main.ts(1)') } });
  expect(account.publishBegin).not.toHaveBeenCalled();
});

it('reports a build that left no output', async () => {
  await rm(path.join(root, 'dist'), { recursive: true });
  expect(await finish(jobs())).toMatchObject({ phase: 'failed', error: { code: 'PUBLISH_NO_OUTPUT' } });
});

it('retries transient upload failures with backoff, then succeeds', async () => {
  uploads.setScript((relative, attempt) => {
    if (relative !== 'index.html') return 204;
    return attempt === 1 ? 503 : attempt === 2 ? 'destroy' : attempt === 3 ? 429 : 204;
  });
  const job = await finish(jobs());
  expect(job).toMatchObject({ phase: 'done', filesDone: 3 });
  expect(uploads.attempts.get('index.html')).toBe(4);
  expect(sleeps).toEqual([500, 1000, 2000]);
});

it('fails an interrupted upload, keeps the link for a retry and never activates', async () => {
  uploads.setScript(relative => (relative === 'assets/game.js' ? 'destroy' : 204));
  const job = await finish(jobs());
  expect(job).toMatchObject({ phase: 'failed', error: { code: 'PUBLISH_UPLOAD_FAILED', message: expect.stringContaining('previous version') } });
  expect(uploads.attempts.get('assets/game.js')).toBe(UPLOAD_ATTEMPTS);
  expect(account.publishFinish).not.toHaveBeenCalled();
  expect(saved).toEqual(['share-1']);

  // The creator publishes again, on the saved link, and it finishes.
  uploads.setScript(() => 204);
  existingShare = 'share-1';
  expect((await finish(jobs())).phase).toBe('done');
  expect(account.publishBegin.mock.lastCall![0]).toMatchObject({ shareId: 'share-1' });
});

it.each([[401, 'expired'], [403, 'expired'], [422, 'could not be uploaded']])('stops at once on a permanent %i', async (status, message) => {
  uploads.setScript(() => status);
  const job = await finish(jobs());
  expect(job).toMatchObject({ phase: 'failed', error: { code: 'PUBLISH_UPLOAD_REJECTED', message: expect.stringContaining(message) } });
  expect(Math.max(...uploads.attempts.values())).toBe(1);
  expect(sleeps).toEqual([]);
  // The Share dialog shows this message as given, so it may not carry an HTTP status.
  expect(job.error!.message).not.toContain(String(status));
});

it('does not show a creator an internal failure', async () => {
  const queue = new PublishJobs({ account: account as never, build: async () => {}, saveShareId: () => {},
    prepare: async () => { throw new Error('EPERM: operation not permitted, open C:\\Users\\someone\\secret'); } });
  queue.start('p', {});
  await queue.settled('p');
  expect(queue.get('p')).toMatchObject({ phase: 'failed', error: { code: 'PUBLISH_FAILED', message: 'Something went wrong while publishing. Your public link, if you have one, still shows the previous version. Try again.' } });
});

it('lists a file the upload server refuses by name, without retrying', async () => {
  uploads.setScript(relative => (relative === 'index.html'
    ? { status: 422, body: { error: { code: 'PUBLISH_REFUSED', message: 'index.html contains a password field, which is not allowed.', refusedFiles: ['index.html'] } } }
    : 204));
  expect(await finish(jobs())).toMatchObject({ phase: 'failed', refusedFiles: ['index.html'],
    error: { code: 'PUBLISH_REFUSED', message: 'index.html contains a password field, which is not allowed.' } });
  expect(uploads.attempts.get('index.html')).toBe(1);
  expect(account.publishFinish).not.toHaveBeenCalled();
});

it('notices a file that changed after it was hashed', async () => {
  build.mockImplementation(async () => {});
  account.publishBegin.mockImplementation(async input => {
    await writeGameFiles(root, { 'dist/assets/game.js': 'changed!' });
    return { shareId: input.shareId ?? 'share-1', version: 2, uploadBaseUrl: uploads.baseUrl, uploadToken: 't', url: GAME.url };
  });
  expect(await finish(jobs())).toMatchObject({ phase: 'failed', error: { code: 'PUBLISH_FILES_CHANGED', message: expect.stringContaining('assets/game.js') } });
});

it('keeps uploads within the concurrency bound', async () => {
  const many: Record<string, string> = { 'dist/index.html': 'x' };
  for (let index = 0; index < 30; index += 1) many[`dist/assets/${index}.png`] = 'x'.repeat(1000);
  await writeGameFiles(root, many);
  expect((await finish(jobs())).filesDone).toBe(33);
  expect(uploads.peak).toBeLessThanOrEqual(UPLOAD_CONCURRENCY);
});

it('stops uploading on dispose', async () => {
  const queue = jobs();
  let stop!: () => void;
  const reached = new Promise<void>(resolve => { stop = resolve; });
  account.publishBegin.mockImplementation(async input => { stop(); await new Promise(resolve => setImmediate(resolve));
    return { shareId: input.shareId ?? 'share-1', version: 2, uploadBaseUrl: uploads.baseUrl, uploadToken: 't', url: GAME.url }; });
  uploads.setScript(() => 'destroy');
  queue.start('game', {});
  await reached;
  await queue.dispose();
  expect(queue.get('game')).toMatchObject({ phase: 'failed', error: { code: 'PUBLISH_UPLOAD_FAILED' } });
  expect(account.publishFinish).not.toHaveBeenCalled();
});

describe('extra public games', () => {
  const FULL: PublishPlan = { planRequired: false, sku: 'plan_starter_monthly_v3', maxLiveGames: 10, maxGameBytes: 104_857_600, liveGames: 10, extraGameCredits: 100, extraGames: 0 };

  it('asks for the one-time charge before building a new link on a full plan', async () => {
    account.shareStatus.mockResolvedValue(shareStatus({ publishPlan: FULL }));
    const job = await finish(jobs());
    expect(job).toMatchObject({ phase: 'failed', error: { code: 'PUBLISH_EXTRA_GAME_REQUIRED', credits: 100, message: expect.stringContaining('100 credits, charged once') } });
    expect(build).not.toHaveBeenCalled();
    expect(account.publishBegin).not.toHaveBeenCalled();
  });

  it('passes the creator agreement to publish-begin', async () => {
    account.shareStatus.mockResolvedValue(shareStatus({ publishPlan: FULL }));
    expect((await finish(jobs(), { payExtraGame: true })).phase).toBe('done');
    expect(account.publishBegin.mock.calls[0]![0]).toMatchObject({ payExtraGame: true });
  });

  it('always tells the cloud whether the creator agreed, so it never mistakes this app for an old one', async () => {
    expect((await finish(jobs())).phase).toBe('done');
    expect(account.publishBegin.mock.calls[0]![0].payExtraGame).toBe(false);
    // The retry as a new link after a lost share keeps the field too.
    existingShare = 'gone';
    account.publishBegin.mockReset();
    account.publishBegin.mockRejectedValueOnce(new PublishCloudError('SHARE_NOT_FOUND'))
      .mockResolvedValueOnce({ shareId: 'share-2', version: 1, uploadBaseUrl: uploads.baseUrl, uploadToken: 't', url: GAME.url });
    expect((await finish(jobs(), { payExtraGame: true })).phase).toBe('done');
    expect(account.publishBegin.mock.calls.map(([input]) => input.payExtraGame)).toEqual([true, true]);
  });

  it('updates a live link on a full plan without asking', async () => {
    existingShare = 'share-1';
    account.shareStatus.mockResolvedValue(shareStatus({ game: GAME, publishPlan: FULL }));
    expect((await finish(jobs())).phase).toBe('done');
    expect(account.publishBegin.mock.calls[0]![0].payExtraGame).toBe(false);
  });

  it('keeps an old cloud on its own refusal', async () => {
    const { extraGameCredits: _price, extraGames: _extra, ...old } = FULL;
    account.shareStatus.mockResolvedValue(shareStatus({ publishPlan: old }));
    account.publishBegin.mockRejectedValue(new PublishCloudError('PUBLISH_QUOTA', 'Your plan allows 10 live games.'));
    expect(await finish(jobs())).toMatchObject({ phase: 'failed', error: { code: 'PUBLISH_QUOTA', message: 'Your plan allows 10 live games.' } });
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('keeps the price when the cloud refuses because the count changed elsewhere', async () => {
    account.publishBegin.mockRejectedValue(new PublishCloudError('PUBLISH_EXTRA_GAME_REQUIRED', 'All 10 games are in use. This one costs 120 credits.', undefined, 120));
    const job = await finish(jobs());
    expect(job).toMatchObject({ phase: 'failed', error: { code: 'PUBLISH_EXTRA_GAME_REQUIRED', credits: 120, message: 'All 10 games are in use. This one costs 120 credits.' } });
  });

  it('says the price in its own words when the cloud gave none', async () => {
    account.publishBegin.mockRejectedValue(new PublishCloudError('PUBLISH_EXTRA_GAME_REQUIRED', undefined, undefined, 120));
    expect((await finish(jobs())).error!.message).toContain('120 credits, charged once');
  });

  it('reports too few credits for the charge as the account error the dialog answers with Buy credits', async () => {
    account.shareStatus.mockResolvedValue(shareStatus({ publishPlan: FULL }));
    account.publishBegin.mockRejectedValue(new AccountError('INSUFFICIENT_CREDITS'));
    expect(await finish(jobs(), { payExtraGame: true })).toMatchObject({ phase: 'failed', error: { code: 'INSUFFICIENT_CREDITS' } });
  });
});

describe('extraGamePrice', () => {
  const plan: PublishPlan = { planRequired: false, sku: 'plan_starter_monthly_v3', maxLiveGames: 10, maxGameBytes: 1, liveGames: 10, extraGameCredits: 100 };
  const removed: PublishedGame = { ...GAME, state: 'removed' };
  const cases: [string, PublishPlan | undefined, PublishedGame | null, number | null][] = [
    ['a new link on a full plan', plan, null, 100],
    ['a removed link that was not paid', plan, removed, 100],
    ['a plan with room left', { ...plan, liveGames: 9 }, null, null],
    ['an update of a live link', plan, GAME, null],
    ['an update of a link under review', plan, { ...GAME, state: 'under_review' }, null],
    ['a removed link paid as extra', plan, { ...removed, extraPaid: true }, null],
    ['a cloud without extra games', { planRequired: false, sku: 'plan_starter_monthly_v3', maxLiveGames: 10, maxGameBytes: 1, liveGames: 10 }, null, null],
    ['no subscription', { ...plan, planRequired: true }, null, null],
    ['no plan answer', undefined, null, null],
  ];

  it.each(cases)('%s', (_name, value, game, price) => {
    expect(extraGamePrice(value, game)).toBe(price);
  });
});
