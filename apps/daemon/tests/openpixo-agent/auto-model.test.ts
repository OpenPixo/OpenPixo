import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { OPENPIXO_AGENT_AUTO_PLAN_MODEL, OPENPIXO_AGENT_AUTO_PLAN_TURNS_PER_GAME, OPENPIXO_AGENT_DEFAULT_MODEL } from '@openpixo/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, insertConversation, insertProject, openDatabase, upsertMessage } from '../../src/db.js';
import { autoPlanTurnsUsed, chooseOpenPixoAutoRunModel, latestGamePlanStep } from '../../src/openpixo-agent/auto-model.js';

describe('Auto picks the model for each run', () => {
  let root = '';
  let db: ReturnType<typeof openDatabase>;
  let position = 0;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'pixo-auto-model-'));
    db = openDatabase(root, { dataDir: path.join(root, 'data') });
    insertProject(db, { id: 'game', name: 'Game', metadata: { kind: 'other' }, createdAt: 1, updatedAt: 1 } as never);
    insertConversation(db, { id: 'chat', projectId: 'game', createdAt: 1, updatedAt: 1 });
    position = 0;
  });
  afterEach(async () => {
    closeDatabase();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  const reply = (content: string) => upsertMessage(db, 'chat', { id: `m${++position}`, role: 'assistant', content, createdAt: position });
  const choose = (runId: string, planPending = true, planModelOffered = true) =>
    chooseOpenPixoAutoRunModel(db, { runId, projectId: 'game', conversationId: 'chat', planPending, planModelOffered }, () => 5);

  it('reads the newest labelled planning reply, skipping a side answer', () => {
    reply('第 2 步 / 共 5 步：画风\n三张样图。');
    reply('第 3 步 / 共 5 步：引擎与技术\n建议用 Phaser。');
    reply('Sure, the slime can be green.');
    expect(latestGamePlanStep(db, 'chat')).toBe(3);
    expect(latestGamePlanStep(db, null)).toBeNull();
  });

  it('runs early planning and everything after it on Flash', () => {
    reply('第 2 步 / 共 5 步：画风');
    expect(choose('run-1')).toEqual({ model: OPENPIXO_AGENT_DEFAULT_MODEL, planTurn: false });
    reply('第 3 步 / 共 5 步：引擎与技术');
    expect(choose('run-2', false).model).toBe(OPENPIXO_AGENT_DEFAULT_MODEL);
    expect(choose('run-3', true, false).model).toBe(OPENPIXO_AGENT_DEFAULT_MODEL);
    expect(autoPlanTurnsUsed(db, 'game')).toBe(0);
  });

  it('writes the plan on the plan model, counts each run once and stops at the cap', () => {
    reply('第 3 步 / 共 5 步：引擎与技术');
    expect(choose('run-1')).toEqual({ model: OPENPIXO_AGENT_AUTO_PLAN_MODEL, planTurn: true });
    // A retry of the same run keeps its model and is not counted again.
    expect(choose('run-1')).toEqual({ model: OPENPIXO_AGENT_AUTO_PLAN_MODEL, planTurn: true });
    expect(autoPlanTurnsUsed(db, 'game')).toBe(1);
    for (let turn = 2; turn <= OPENPIXO_AGENT_AUTO_PLAN_TURNS_PER_GAME; turn++) expect(choose(`run-${turn}`).planTurn).toBe(true);
    expect(choose('run-over-cap')).toEqual({ model: OPENPIXO_AGENT_DEFAULT_MODEL, planTurn: false });
    expect(autoPlanTurnsUsed(db, 'game')).toBe(OPENPIXO_AGENT_AUTO_PLAN_TURNS_PER_GAME);
  });

  it('never uses the plan model for a run outside a project', () => {
    reply('第 3 步 / 共 5 步：引擎与技术');
    expect(chooseOpenPixoAutoRunModel(db, { runId: 'loose', projectId: null, conversationId: 'chat', planPending: true, planModelOffered: true }).model)
      .toBe(OPENPIXO_AGENT_DEFAULT_MODEL);
  });
});
