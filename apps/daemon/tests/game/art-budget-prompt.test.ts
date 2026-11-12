import { composeOpenPixoGamePrompt } from '@openpixo/contracts';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { artBudgetRunFacts, ArtBudgetLedger, migrateArtBudget } from '../../src/game/art-budget.js';
import { computeStableSectionHashes } from '../../src/runtimes/stable-prompt-sections.js';
import { composeGameSystemPrompt } from '../../src/game/prompt.js';

const approved = { kind: 'other', gamePlan: { status: 'approved', startedAt: 1, approvedAt: 2 } } as never;
const planning = { kind: 'other', gamePlan: { status: 'planning', startedAt: 1 } } as never;

describe('what a run is told about the art budget', () => {
  let db: Database.Database;
  let ledger: ArtBudgetLedger;
  const signedIn = async () => true;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec("CREATE TABLE projects(id TEXT PRIMARY KEY); INSERT INTO projects VALUES ('p1'); CREATE TABLE openpixo_cloud_jobs(request_id TEXT)");
    migrateArtBudget(db);
    ledger = new ArtBudgetLedger(db);
  });
  afterEach(() => db.close());

  const facts = (over: Partial<Parameters<typeof artBudgetRunFacts>[0]> = {}) =>
    artBudgetRunFacts({ ledger, hasSession: signedIn, projectId: 'p1', metadata: approved, ...over });
  const charge = (requestId: string, fingerprint: string, credits: number) => ledger.reserve({
    projectId: 'p1', runId: 'run', fingerprint, quoteId: 'quote', service: 'openpixo-image', credits, requestId,
  });

  it('says nothing with a budget of 0 or signed out', async () => {
    const none = { budgetImages: false, budgetUnset: false, turnNote: '' };
    // 0 is the user saying the agent spends no credits: not an invitation to ask again.
    ledger.setLimit('p1', 0);
    expect(await facts()).toEqual(none);
    expect(await facts({ hasSession: async () => false })).toEqual(none);
    ledger.setLimit('p1', 100);
    expect(await facts({ hasSession: async () => false })).toEqual(none);
    expect(await facts({ hasSession: async () => { throw new Error('no storage'); } })).toEqual(none);
    expect(await facts({ projectId: null })).toEqual(none);
  });

  /*
   * 2026-11-10 beginner audit: signed in with only credits and no budget yet, the agent
   * said 「在设置里连接 Codex 或填入图片 API key」. Credits could pay; the prompt never said so.
   */
  it('says when credits could pay once the user sets a budget', async () => {
    expect(await facts()).toEqual({ budgetImages: false, budgetUnset: true, turnNote: '' });
    expect(await facts({ hasSession: async () => false })).toMatchObject({ budgetUnset: false });
    const result = await facts();
    const prompt = composeGameSystemPrompt({
      baseDir: '/game',
      mediaExecution: { mode: 'enabled', usableProviders: [], budgetImages: result.budgetImages, budgetUnset: result.budgetUnset } as never,
    });
    const rule = prompt.slice(prompt.indexOf('**No image model can run right now**')).split('\n')[0];
    expect(rule).toContain('美术预算');
    expect(rule).not.toContain('Codex');
    expect(prompt).not.toContain('还没有连接图片生成器');
  });

  it('offers a budget the user set while planning, for the style samples', async () => {
    // Owner decision 2026-11-10; the plan gate still allows only a few images then.
    expect(await facts({ metadata: planning })).toEqual({ budgetImages: false, budgetUnset: true, turnNote: '' });
    ledger.setLimit('p1', 20);
    const result = await facts({ metadata: planning });
    expect(result.budgetImages).toBe(true);
    expect(result.turnNote).toContain('0 of 20 credits used, 20 left');
  });

  it('offers hosted images while budget remains, and states this turn\'s figures', async () => {
    ledger.setLimit('p1', 100);
    charge('r1', 'f1', 12);
    const result = await facts();
    expect(result.budgetImages).toBe(true);
    expect(result.turnNote).toContain('12 of 100 credits used, 88 left');
  });

  it('tells the run whether it must ask first, and what the user approved', async () => {
    ledger.setLimit('p1', 100);
    expect((await facts()).turnNote).toContain('no art is approved for this turn');
    ledger.approve('p1', 20);
    expect((await facts()).turnNote).toContain('approved up to 20 credits');
    // Claimed by an earlier run: this one has nothing approved.
    ledger.reserve({ projectId: 'p1', runId: 'earlier', fingerprint: 'f', quoteId: 'q', service: 'openpixo-image', credits: 4, requestId: 'r', requireApproval: true });
    expect((await facts()).turnNote).toContain('no art is approved for this turn');
    expect((await facts({ metadata: planning })).turnNote).toContain('need no art card');
    ledger.setMode('p1', 'auto');
    expect((await facts()).turnNote).toContain('without asking');
  });

  it('claims an approval for one run only, within what it approved', () => {
    ledger.setLimit('p1', 100);
    const reserve = (runId: string | null, requestId: string, credits: number) => ledger.reserve({ projectId: 'p1', runId, fingerprint: requestId, quoteId: 'q',
      service: 'openpixo-image', credits, requestId, requireApproval: true });
    expect(reserve('a', 'r0', 4)).toMatchObject({ ok: false, reason: 'approval', approval: null });
    ledger.approve('p1', 8);
    expect(reserve(null, 'r1', 4)).toMatchObject({ ok: false, reason: 'approval' });
    expect(reserve('a', 'r2', 9)).toMatchObject({ ok: false, reason: 'approval' });
    expect(ledger.readApproval('p1')?.runId).toBeNull();
    expect(reserve('a', 'r3', 4)).toMatchObject({ ok: true });
    expect(reserve('b', 'r4', 4)).toMatchObject({ ok: false, reason: 'approval' });
    expect(reserve('a', 'r5', 4)).toMatchObject({ ok: true });
    expect(reserve('a', 'r6', 1)).toMatchObject({ ok: false, reason: 'approval' });
    expect(ledger.readApproval('p1')).toMatchObject({ approvedCredits: 8, usedCredits: 8, remainingCredits: 0, runId: 'a' });
    // Without the requirement, as in auto mode, only the budget counts.
    expect(reserve('b', 'r7', 4)).toMatchObject({ ok: false });
    expect(ledger.reserve({ projectId: 'p1', runId: 'b', fingerprint: 'r8', quoteId: 'q', service: 'openpixo-image', credits: 4, requestId: 'r8' })).toMatchObject({ ok: true });
    expect(ledger.read('p1')?.usedCredits).toBe(12);
  });

  it('keeps the mode apart from the budget, so choosing one sets no budget', () => {
    expect(ledger.readMode('p1')).toBe('ask');
    ledger.setMode('p1', 'auto');
    expect(ledger.readMode('p1')).toBe('auto');
    expect(ledger.read('p1')).toBeNull();
  });

  it('applies to a project with no plan state too', async () => {
    ledger.setLimit('p1', 100);
    expect((await facts({ metadata: { kind: 'other' } as never })).budgetImages).toBe(true);
  });

  it('stops offering once used up, and tells the agent what to say instead', async () => {
    ledger.setLimit('p1', 10);
    charge('r1', 'f1', 10);
    const result = await facts();
    expect(result.budgetImages).toBe(false);
    expect(result.turnNote).toContain('raise-art-budget');
    const prompt = composeGameSystemPrompt({ baseDir: '/game', mediaExecution: { mode: 'enabled', usableProviders: [], budgetImages: result.budgetImages } as never });
    expect(prompt).not.toContain('`openpixo-image`');
    expect(prompt).toContain('No image model can run right now');
  });

  it('does not move the cached prefix as credits are spent', async () => {
    ledger.setLimit('p1', 100);
    const before = await facts();
    charge('r1', 'f1', 40);
    const after = await facts();
    expect(after.turnNote).not.toBe(before.turnNote);
    const prompt = (budgetImages: boolean) => composeOpenPixoGamePrompt({
      mediaContractBlock: composeGameSystemPrompt({ baseDir: '/game', mediaExecution: { mode: 'enabled', usableProviders: [], budgetImages } as never }),
    });
    expect(prompt(after.budgetImages)).toBe(prompt(before.budgetImages));
    const sections = (budgetImages: boolean) => computeStableSectionHashes({ mediaExecution: { mode: 'enabled', usableProviders: [], budgetImages } });
    expect(sections(after.budgetImages)).toEqual(sections(before.budgetImages));
    // It does move when hosted models come or go, so a resumed session is told.
    expect(sections(true)).not.toEqual(sections(false));
  });

  it('never releases a settled charge, and counts what the cloud really charged', () => {
    ledger.setLimit('p1', 100);
    charge('r1', 'f1', 4);
    ledger.charged('r1', 5);
    ledger.released('r1');
    expect(ledger.read('p1')).toMatchObject({ spentCredits: 5, reservedCredits: 0, usedCredits: 5, remainingCredits: 95 });
  });

  it('gives back a reservation only when nothing was sent', () => {
    ledger.setLimit('p1', 100);
    charge('sent', 'f1', 4);
    charge('unsent', 'f2', 4);
    db.prepare('INSERT INTO openpixo_cloud_jobs (request_id) VALUES (?)').run('sent');
    ledger.releaseIfNeverSubmitted('sent');
    ledger.releaseIfNeverSubmitted('unsent');
    expect(ledger.read('p1')).toMatchObject({ reservedCredits: 4, usedCredits: 4 });
  });

  it('a budget lowered below what was used leaves nothing, not a negative', () => {
    ledger.setLimit('p1', 100);
    charge('r1', 'f1', 40);
    ledger.setLimit('p1', 10);
    expect(ledger.read('p1')).toMatchObject({ limitCredits: 10, usedCredits: 40, remainingCredits: 0 });
  });

  it('goes away with its project', () => {
    db.pragma('foreign_keys = ON');
    ledger.setLimit('p1', 100);
    charge('r1', 'f1', 4);
    db.prepare("DELETE FROM projects WHERE id = 'p1'").run();
    expect(ledger.read('p1')).toBeNull();
    expect(db.prepare('SELECT COUNT(*) AS n FROM project_art_budget_charges').get()).toEqual({ n: 0 });
  });
});
