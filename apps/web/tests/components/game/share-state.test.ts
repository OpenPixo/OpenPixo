import { describe, expect, it } from 'vitest';
import type { PublishedGame, PublishJob, PublishPlan, PublishStatusResponse, RoomsUsage } from '@openpixo/contracts';
import {
  deriveShareView, extraGameOffer, extraGameShort, formatHours, freeMinutesLeft, isJobRunning, isShareableEngine, jobExtraGameCredits, limitReached,
  parseMonthlyLimit, publishSteps, safeHttpUrl, uploadFraction,
} from '../../../src/components/game/share-state';

const game = (over: Partial<PublishedGame> = {}): PublishedGame => ({
  shareId: 's1', url: 'https://play.example/s1', title: 'Slime Dash', version: 2, state: 'live',
  publishedAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-02T00:00:00Z', playsThisMonth: 3, ...over,
});
const job = (over: Partial<PublishJob> = {}): PublishJob => ({
  id: 'j1', phase: 'building', filesDone: 0, filesTotal: 0, startedAt: '2026-11-04T00:00:00Z', ...over,
});
const status = (over: Partial<PublishStatusResponse> = {}): PublishStatusResponse => ({
  available: true, game: null, job: null, termsAccepted: true, termsUrl: 'https://rules.example/', ...over,
});
const usage = (over: Partial<RoomsUsage> = {}): RoomsUsage => ({
  month: '2026-11', freeMinutesTotal: 600, freeMinutesUsed: 0, playerMinutes: 0, creditsCharged: 0, monthlyCreditLimit: 500, openRooms: 0, ...over,
});

describe('deriveShareView', () => {
  it('waits for the first status and reports a failed first read', () => {
    expect(deriveShareView(null).kind).toBe('loading');
    expect(deriveShareView(null, { loadFailed: true }).kind).toBe('unreachable');
  });

  it('keeps the last status when a later read fails', () => {
    expect(deriveShareView(status(), { loadFailed: true }).kind).toBe('form');
  });

  it('names each reason the cloud is not available', () => {
    expect(deriveShareView(status({ available: false, unavailableReason: 'signed_out' })).kind).toBe('signed-out');
    expect(deriveShareView(status({ available: false, unavailableReason: 'paused' })).kind).toBe('closed');
    expect(deriveShareView(status({ available: false, unavailableReason: 'no_cloud' })).kind).toBe('closed');
    expect(deriveShareView(status({ available: false, unavailableReason: 'engine_unsupported' })).kind).toBe('unsupported');
  });

  it('asks for a plan only where there is no link to keep', () => {
    const none = { planRequired: true, sku: null, maxLiveGames: 0, maxGameBytes: 0, liveGames: 0 };
    expect(deriveShareView(status({ publishPlan: none })).kind).toBe('plan-required');
    expect(deriveShareView(status({ game: game(), publishPlan: none }))).toMatchObject({ kind: 'live', updatesPaused: true, planLapsed: true });
    // Its own refusal is answered by the offer, not shown as a failure.
    expect(deriveShareView(status({ publishPlan: none, job: job({ phase: 'failed', error: { code: 'PUBLISH_PLAN_REQUIRED', message: 'x' } }) })).kind).toBe('plan-required');
    // A cloud without plan limits behaves as before.
    expect(deriveShareView(status()).kind).toBe('form');
  });

  it('asks for the rules only while they are not accepted', () => {
    expect(deriveShareView(status({ termsAccepted: false }))).toEqual({ kind: 'form', needsTerms: true });
    expect(deriveShareView(status())).toEqual({ kind: 'form', needsTerms: false });
  });

  it.each(['building', 'checking', 'uploading', 'activating'] as const)('shows a running %s job above every other state', phase => {
    const running = job({ phase });
    expect(deriveShareView(status({ job: running })).kind).toBe('publishing');
    expect(deriveShareView(status({ job: running, game: game() })).kind).toBe('publishing');
    expect(deriveShareView(status({ job: running, available: false, unavailableReason: 'signed_out' })).kind).toBe('publishing');
    expect(isJobRunning(running)).toBe(true);
  });

  it('treats a finished job as the state it left behind', () => {
    expect(isJobRunning(job({ phase: 'done' }))).toBe(false);
    expect(deriveShareView(status({ job: job({ phase: 'done' }), game: game() })).kind).toBe('live');
  });

  it('separates a live game from one under review or removed', () => {
    expect(deriveShareView(status({ game: game() }))).toMatchObject({ kind: 'live', updatesPaused: false, needsTerms: false });
    expect(deriveShareView(status({ game: game({ state: 'under_review' }) })).kind).toBe('under-review');
    expect(deriveShareView(status({ game: game({ state: 'removed' }) })).kind).toBe('removed');
  });

  it('keeps an existing link visible while sharing is paused, without offering updates', () => {
    expect(deriveShareView(status({ available: false, unavailableReason: 'paused', game: game() })))
      .toMatchObject({ kind: 'live', updatesPaused: true });
  });

  it('shows a failure, with the link it left working, until it is dismissed', () => {
    const failed = job({ phase: 'failed', error: { code: 'PUBLISH_REFUSED', message: 'Refused' } });
    expect(deriveShareView(status({ job: failed }))).toMatchObject({ kind: 'failed', game: null, canRetry: true });
    expect(deriveShareView(status({ job: failed, game: game() }))).toMatchObject({ kind: 'failed', game: { shareId: 's1' } });
    expect(deriveShareView(status({ job: failed }), { dismissedJobId: 'j1' }).kind).toBe('form');
    expect(deriveShareView(status({ job: failed, game: game() }), { dismissedJobId: 'j1' }).kind).toBe('live');
    expect(deriveShareView(status({ job: failed, game: game() }), { dismissedJobId: 'older' }).kind).toBe('failed');
  });

  it('answers a rules refusal with the checkbox, not a failure', () => {
    const refused = job({ phase: 'failed', error: { code: 'SHARE_TERMS_REQUIRED', message: 'Accept the rules' } });
    expect(deriveShareView(status({ job: refused, termsAccepted: false }))).toEqual({ kind: 'form', needsTerms: true });
  });

  it('does not offer a retry while sharing is paused', () => {
    const failed = job({ phase: 'failed' });
    expect(deriveShareView(status({ job: failed, game: game(), available: false, unavailableReason: 'paused' })))
      .toMatchObject({ kind: 'failed', canRetry: false });
  });

  it('prefers the removal over an older failure', () => {
    expect(deriveShareView(status({ job: job({ phase: 'failed' }), game: game({ state: 'removed' }) })).kind).toBe('removed');
  });
});

describe('extra public games', () => {
  const full = (over: Partial<PublishPlan> = {}): PublishPlan => ({ planRequired: false, sku: 'plan_starter_monthly_v3', maxLiveGames: 10, maxGameBytes: 1, liveGames: 10, extraGameCredits: 100, extraGames: 0, ...over });
  const offer = { credits: 100, sku: 'plan_starter_monthly_v3', maxLiveGames: 10, refusedForCredits: false };

  it('offers the extra game before a publish when the count is full', () => {
    expect(deriveShareView(status({ publishPlan: full() }))).toEqual({ kind: 'form', needsTerms: false, extraGame: offer });
  });

  it('offers nothing while there is room, for an existing link, or from an old cloud', () => {
    expect(deriveShareView(status({ publishPlan: full({ liveGames: 9 }) }))).toEqual({ kind: 'form', needsTerms: false });
    expect(deriveShareView(status({ publishPlan: full(), game: game() })).kind).toBe('live');
    expect(extraGameOffer(status({ publishPlan: full(), game: game({ state: 'under_review' }) }))).toBeNull();
    expect(extraGameOffer(status({ publishPlan: full(), game: game({ state: 'removed', extraPaid: true }) }))).toBeNull();
    expect(extraGameOffer(status({ publishPlan: full(), game: game({ state: 'removed' }) }))).toEqual(offer);
    const { extraGameCredits: _price, ...old } = full();
    expect(deriveShareView(status({ publishPlan: old }))).toEqual({ kind: 'form', needsTerms: false });
    expect(extraGameOffer(status({ publishPlan: full({ planRequired: true }) }))).toBeNull();
  });

  it('answers the cloud refusal with the same offer, at the price it named', () => {
    const refused = job({ phase: 'failed', error: { code: 'PUBLISH_EXTRA_GAME_REQUIRED', message: 'x', credits: 120 } as PublishJob['error'] });
    // The count changed in another window: the plan read before still had room.
    expect(deriveShareView(status({ publishPlan: full({ liveGames: 9 }), job: refused }))).toEqual({ kind: 'form', needsTerms: false, extraGame: { ...offer, credits: 120 } });
    const noPrice = job({ phase: 'failed', error: { code: 'PUBLISH_EXTRA_GAME_REQUIRED', message: 'x' } });
    expect(extraGameOffer(status({ publishPlan: full(), job: noPrice }))?.credits).toBe(100);
    expect(jobExtraGameCredits(noPrice)).toBeNull();
    // Without any price there is nothing to offer, so the refusal shows as a failure.
    expect(deriveShareView(status({ job: noPrice })).kind).toBe('failed');
  });

  it('keeps the offer after a refusal for too few credits, and lets a top-up clear it', () => {
    const short = job({ phase: 'failed', error: { code: 'INSUFFICIENT_CREDITS', message: 'x' } });
    const view = deriveShareView(status({ publishPlan: full(), job: short }));
    expect(view).toEqual({ kind: 'form', needsTerms: false, extraGame: { ...offer, refusedForCredits: true } });
    const refused = { ...offer, refusedForCredits: true };
    expect(extraGameShort(refused, null)).toBe(true);
    expect(extraGameShort(refused, 150)).toBe(false);
    expect(extraGameShort(offer, 99)).toBe(true);
    expect(extraGameShort(offer, 100)).toBe(false);
    expect(extraGameShort(offer, undefined)).toBe(false);
    // Elsewhere too few credits is an ordinary failure.
    expect(deriveShareView(status({ job: short })).kind).toBe('failed');
  });
});

describe('publish progress', () => {
  it('marks steps done, current and pending from the phase', () => {
    expect(publishSteps(job({ phase: 'uploading' })).map(step => step.state)).toEqual(['done', 'done', 'current', 'pending']);
    expect(publishSteps(job({ phase: 'building' })).map(step => step.state)).toEqual(['current', 'pending', 'pending', 'pending']);
    expect(publishSteps(job({ phase: 'activating' })).at(-1)).toEqual({ phase: 'activating', state: 'current' });
  });

  it('measures only an upload with files', () => {
    expect(uploadFraction(job({ phase: 'uploading', filesDone: 1, filesTotal: 4 }))).toBe(0.25);
    expect(uploadFraction(job({ phase: 'uploading', filesDone: 9, filesTotal: 4 }))).toBe(1);
    expect(uploadFraction(job({ phase: 'uploading' }))).toBeNull();
    expect(uploadFraction(job({ phase: 'checking', filesTotal: 4 }))).toBeNull();
  });
});

describe('parseMonthlyLimit', () => {
  it.each([['500', 500], ['0', 0], [' 42 ', 42], ['10000000', 10_000_000]])('accepts %j', (input, expected) => {
    expect(parseMonthlyLimit(input)).toBe(expected);
  });

  it.each(['', '   ', 'abc', '-5', '1.5', '1e3', '12 000', '10000001', '99999999999999999999'])('refuses %j', input => {
    expect(parseMonthlyLimit(input)).toBeNull();
  });
});

describe('usage numbers', () => {
  it('rounds free hours down and never below zero', () => {
    expect(formatHours(600)).toBe('10');
    expect(formatHours(450)).toBe('7.5');
    expect(formatHours(5)).toBe('0');
    expect(formatHours(-30)).toBe('0');
    expect(freeMinutesLeft(usage({ freeMinutesUsed: 150 }))).toBe(450);
    expect(freeMinutesLeft(usage({ freeMinutesUsed: 700 }))).toBe(0);
  });

  it('knows when the limit is reached', () => {
    expect(limitReached(usage({ creditsCharged: 499 }))).toBe(false);
    expect(limitReached(usage({ creditsCharged: 500 }))).toBe(true);
  });
});

describe('small guards', () => {
  it('shares web engines only', () => {
    for (const engine of ['phaser', 'threejs', 'web-generic'] as const) expect(isShareableEngine(engine)).toBe(true);
    for (const engine of ['godot', 'unity', 'unreal', 'cocos-creator', 'bevy', 'rpg-maker', 'unknown'] as const) expect(isShareableEngine(engine)).toBe(false);
  });

  it('accepts only credential-free http(s) URLs', () => {
    expect(safeHttpUrl('https://play.example/s1')).toBe('https://play.example/s1');
    expect(safeHttpUrl('http://localhost:8787/s1')).toBe('http://localhost:8787/s1');
    for (const value of ['', null, undefined, 'javascript:alert(1)', 'file:///c:/x', 'not a url', 'https://user:pw@play.example/']) {
      expect(safeHttpUrl(value)).toBeNull();
    }
  });
});
