/**
 * C15 (鸦堡 run, 2026-11-21): the user approved an 80-credit art card for 8 clips; the
 * turn made 1 clip, a hosted request then failed in the cloud and the turn ended. The
 * other 70 stayed bound to that finished turn, so the retry had to ask for the same
 * 7 clips again and the user approved the same art twice.
 *
 * The rule pinned here: what a run left of an approval carries over to the next run
 * when that run ended by failure, by a daemon shutdown, or after one of its paid art
 * requests did not deliver. A run that finished cleanly, or one the user stopped,
 * keeps it. Across every run it pays for, one approval never pays more than the
 * user approved, and a new approval replaces a carried one instead of adding to it.
 */
import Database from 'better-sqlite3';
import { renderArtBudgetTurnNote } from '@openpixo/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { artBudgetRunEndHook, ArtBudgetLedger, migrateArtBudget } from '../../src/game/art-budget.js';

describe('an approval a run could not finish', () => {
  let db: Database.Database;
  let ledger: ArtBudgetLedger;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec("CREATE TABLE projects(id TEXT PRIMARY KEY); INSERT INTO projects VALUES ('p1'); CREATE TABLE openpixo_cloud_jobs(request_id TEXT)");
    migrateArtBudget(db);
    ledger = new ArtBudgetLedger(db);
    ledger.setLimit('p1', 300);
  });
  afterEach(() => db.close());

  const reserve = (runId: string | null, requestId: string, credits: number, fingerprint = requestId) => ledger.reserve({
    projectId: 'p1', runId, fingerprint, quoteId: 'q', service: 'openpixo-walk-video', credits, requestId, requireApproval: true,
  });
  /** Reserved and then settled by the cloud: delivered and paid. */
  const made = (runId: string, requestId: string, credits: number) => {
    const result = reserve(runId, requestId, credits);
    if (result.ok) ledger.charged(requestId, credits);
    return result;
  };

  it('lets the next run spend what a failed run left, and no more than was approved in all', () => {
    ledger.approve('p1', 80);
    expect(reserve('a', 'idle', 10)).toMatchObject({ ok: true });
    ledger.runEnded({ projectId: 'p1', runId: 'a', status: 'failed' });
    expect(ledger.readApproval('p1')).toMatchObject({ approvedCredits: 80, usedCredits: 10, remainingCredits: 70, runId: null, carriedOver: true });
    // The retry claims the rest, like a fresh approval: one run at a time.
    for (let clip = 0; clip < 7; clip++) expect(reserve('b', `clip-${clip}`, 10)).toMatchObject({ ok: true });
    expect(reserve('c', 'other', 10)).toMatchObject({ ok: false, reason: 'approval' });
    expect(reserve('b', 'one-more', 1)).toMatchObject({ ok: false, reason: 'approval' });
    expect(ledger.readApproval('p1')).toMatchObject({ usedCredits: 80, remainingCredits: 0, runId: 'b', carriedOver: false });
    // Nothing left: the approval stays where it was spent.
    ledger.runEnded({ projectId: 'p1', runId: 'b', status: 'failed' });
    expect(ledger.readApproval('p1')).toMatchObject({ runId: 'b', remainingCredits: 0 });
    expect(ledger.read('p1')?.usedCredits).toBe(80);
  });

  it('carries over after a turn that ended normally once a paid request failed in the cloud', () => {
    ledger.approve('p1', 80);
    expect(reserve('a', 'idle', 10)).toMatchObject({ ok: true });
    // Priced in the cloud and refused before any charge (C14): no charge row, only the note.
    ledger.noteArtFailure('p1', 'a');
    ledger.runEnded({ projectId: 'p1', runId: 'a', status: 'succeeded' });
    expect(ledger.readApproval('p1')).toMatchObject({ remainingCredits: 70, runId: null, carriedOver: true });
    expect(reserve('b', 'combo1', 10)).toMatchObject({ ok: true });
  });

  it('carries over after a charge the cloud gave back, or one still open when the turn ended', () => {
    ledger.approve('p1', 30);
    expect(reserve('a', 'refunded', 10)).toMatchObject({ ok: true });
    ledger.released('refunded');
    ledger.runEnded({ projectId: 'p1', runId: 'a', status: 'succeeded' });
    expect(ledger.readApproval('p1')).toMatchObject({ usedCredits: 0, remainingCredits: 30, runId: null });

    expect(reserve('b', 'open', 10)).toMatchObject({ ok: true });
    ledger.runEnded({ projectId: 'p1', runId: 'b', status: 'succeeded' });
    // The open charge still counts as used until the cloud proves otherwise.
    expect(ledger.readApproval('p1')).toMatchObject({ usedCredits: 10, remainingCredits: 20, runId: null });
    // A repeat of that open request in the next run reuses its charge: counted once.
    expect(reserve('c', 'open-again', 10, 'open')).toMatchObject({ ok: true, reused: true });
    expect(ledger.readApproval('p1')).toMatchObject({ usedCredits: 10, remainingCredits: 20, runId: null });
  });

  it.each([
    ['a clean finish', { status: 'succeeded' }, false, false],
    ['a failure', { status: 'failed' }, false, true],
    ['a daemon shutdown', { status: 'canceled', cancelOrigin: 'daemon_shutdown' }, false, true],
    ['the user\'s stop, even after a failed request', { status: 'canceled', cancelOrigin: 'user_stop' }, true, false],
    ['project cleanup', { status: 'canceled', cancelOrigin: 'project_cleanup' }, false, false],
    ['a cancel of unknown origin', { status: 'canceled', cancelOrigin: null }, false, false],
  ] as const)('after %s, carries over: %s', (_label, end, artFailed, carries) => {
    ledger.approve('p1', 20);
    expect(made('a', 'first', 4)).toMatchObject({ ok: true });
    if (artFailed) ledger.noteArtFailure('p1', 'a');
    ledger.runEnded({ projectId: 'p1', runId: 'a', ...end });
    expect(ledger.readApproval('p1')?.runId).toBe(carries ? null : 'a');
    expect(reserve('b', 'second', 4)).toMatchObject({ ok: carries });
  });

  it('ignores the end of a run that does not hold the approval, and a failure noted by one', () => {
    ledger.approve('p1', 20);
    expect(made('a', 'first', 4)).toMatchObject({ ok: true });
    ledger.noteArtFailure('p1', 'other');
    ledger.runEnded({ projectId: 'p1', runId: 'other', status: 'failed' });
    ledger.runEnded({ projectId: null, runId: 'a', status: 'failed' });
    expect(ledger.readApproval('p1')).toMatchObject({ runId: 'a', carriedOver: false });
    ledger.runEnded({ projectId: 'p1', runId: 'a', status: 'succeeded' });
    expect(ledger.readApproval('p1')?.runId).toBe('a');
  });

  it('lets the same run take the rest back when it is resumed, and judges it on that attempt', () => {
    ledger.approve('p1', 20);
    expect(made('a', 'first', 4)).toMatchObject({ ok: true });
    ledger.noteArtFailure('p1', 'a');
    ledger.runEnded({ projectId: 'p1', runId: 'a', status: 'failed' });
    // The daemon's same-run retry resumes the run under its own id.
    expect(made('a', 'second', 4)).toMatchObject({ ok: true });
    expect(ledger.readApproval('p1')).toMatchObject({ usedCredits: 8, remainingCredits: 12, runId: 'a' });
    ledger.runEnded({ projectId: 'p1', runId: 'a', status: 'succeeded' });
    expect(ledger.readApproval('p1')?.runId).toBe('a');
  });

  it('is replaced by a new approval, never added to it', () => {
    ledger.approve('p1', 80);
    expect(reserve('a', 'idle', 10)).toMatchObject({ ok: true });
    ledger.runEnded({ projectId: 'p1', runId: 'a', status: 'failed' });
    ledger.approve('p1', 20);
    expect(ledger.readApproval('p1')).toMatchObject({ approvedCredits: 20, usedCredits: 0, remainingCredits: 20, runId: null, carriedOver: false });
    for (let clip = 0; clip < 2; clip++) expect(reserve('b', `clip-${clip}`, 10)).toMatchObject({ ok: true });
    expect(reserve('b', 'clip-2', 10)).toMatchObject({ ok: false, reason: 'approval' });
  });

  it('is decided when the run registry reports the end, from the run itself', () => {
    const onTerminal = artBudgetRunEndHook(ledger);
    ledger.approve('p1', 20);
    expect(made('a', 'first', 4)).toMatchObject({ ok: true });
    onTerminal({ id: 'a', projectId: 'p1', cancelOrigin: 'user_stop' }, 'canceled');
    expect(ledger.readApproval('p1')?.runId).toBe('a');
    onTerminal({ id: 'a', projectId: 'p1', cancelOrigin: null }, 'failed');
    expect(ledger.readApproval('p1')?.runId).toBeNull();
    // A run with no project, or a malformed one, is not the ledger's business.
    expect(() => onTerminal({ id: 'x' }, 'failed')).not.toThrow();
    expect(() => onTerminal(null as never, 'failed')).not.toThrow();
  });

  it('tells the next turn to finish the approved list instead of asking again', () => {
    ledger.approve('p1', 80);
    expect(reserve('a', 'idle', 10)).toMatchObject({ ok: true });
    ledger.runEnded({ projectId: 'p1', runId: 'a', status: 'failed' });
    const note = renderArtBudgetTurnNote(ledger.read('p1')!, { mode: 'ask', approval: ledger.readApproval('p1') });
    expect(note).toContain('70 can still be spent');
    expect(note).toContain('did not finish');
    expect(note).toContain('without a new art card');
    expect(note).not.toContain('no art is approved');
  });
});
