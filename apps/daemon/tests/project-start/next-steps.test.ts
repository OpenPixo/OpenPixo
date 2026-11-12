import { describe, expect, it } from 'vitest';
import type { DoctorCheck, EngineProfile, GameVerifyResult } from '@openpixo/contracts';
import { deriveProjectNextSteps, type ProjectStarterFacts } from '../../src/project-start/next-steps.js';

const check = (id: string, status: DoctorCheck['status'] = 'ok'): DoctorCheck => ({ id: `engine:${id}`, group: 'engines', status,
  title: { code: 'godot' }, detail: { code: 'available' }, fix: { kind: 'settings', value: 'gameEngines' } });
const profile = (engine: EngineProfile['engine'] = 'godot'): EngineProfile => ({ engine, detectorVersion: 1, confidence: 'certain',
  evidence: [], languages: [], assetRoots: [], importMetadata: 'none', detectedAt: 1,
  commands: { check: { argv: ['godot'], cwd: '.', timeoutMs: 1 }, run: { argv: ['godot'], cwd: '.', timeoutMs: 1 } },
  tools: [{ id: 'godot', resolved: true }] });
const verify = (status: GameVerifyResult['status'] = 'passed', ran = true): GameVerifyResult => ({ status, missingTools: [], screenshots: [], steps: ran ? [
  { name: 'run', status: 'passed', argv: ['godot'], exitCode: 0, durationMs: 1, logRef: 'ref', timedOut: false },
] : [] });
function facts(overrides: Partial<ProjectStarterFacts> = {}): ProjectStarterFacts {
  return { profile: profile(), doctor: { checks: [check('godot'), check('node', 'missing'), check('npm', 'missing')] },
    hasSucceededAgentRun: false, mediaAssetCount: 0, latestVerify: null, ...overrides };
}
const statuses = (input: ProjectStarterFacts) => deriveProjectNextSteps('game', undefined, input).steps.map(step => [step.id, step.status]);

describe('project starter checklist facts', () => {
  it('orders the five steps, ignores unrelated doctor checks and returns existing action descriptors', () => {
    const result = deriveProjectNextSteps('game', undefined, facts());
    expect(result.dismissed).toBe(false);
    expect(result.steps.map(step => step.id)).toEqual(['environment', 'run-game', 'agent-task', 'media-assets', 'verify']);
    expect(result.steps.map(step => step.status)).toEqual(['done', 'todo', 'todo', 'todo', 'todo']);
    expect(result.steps.map(step => step.action)).toEqual([
      { kind: 'open-settings', value: 'environment' }, { kind: 'run-game', value: 'game' },
      { kind: 'prefill-chat', value: expect.stringContaining('godot') }, { kind: 'open-tab', value: 'generate' }, { kind: 'verify', value: 'game' },
    ]);
  });
  it('marks all complete only from independently completed project facts', () => {
    expect(statuses(facts({ hasSucceededAgentRun: true, mediaAssetCount: 2, latestVerify: verify() })).map(([, status]) => status))
      .toEqual(['done', 'done', 'done', 'done', 'done']);
  });
  it('blocks dependent actions for a missing engine and preserves completed history', () => {
    expect(statuses(facts({ doctor: { checks: [check('godot', 'missing')] } })).map(([, status]) => status))
      .toEqual(['todo', 'blocked', 'todo', 'todo', 'blocked']);
    expect(statuses(facts({ doctor: { checks: [check('godot', 'error')] }, latestVerify: verify(), hasSucceededAgentRun: true, mediaAssetCount: 1 })).map(([, status]) => status))
      .toEqual(['blocked', 'done', 'done', 'done', 'done']);
  });
  it('requires node plus the actual package manager for web engines', () => {
    const web = { ...profile('phaser'), tools: [{ id: 'pnpm', resolved: true }], commands: { run: { argv: ['pnpm', 'run', 'dev'], cwd: '.', timeoutMs: 1 } } };
    expect(statuses(facts({ profile: web, doctor: { checks: [check('node'), check('npm', 'missing')] } }))[0]).toEqual(['environment', 'done']);
    expect(statuses(facts({ profile: { ...web, tools: [{ id: 'pnpm', resolved: false }] }, doctor: { checks: [check('node')] } }))[0]).toEqual(['environment', 'todo']);
    expect(statuses(facts({ profile: web, doctor: { checks: [check('node', 'missing')] } }))[1]).toEqual(['run-game', 'blocked']);
  });
  it('does not claim a check-only, failed, skipped or timed-out verification ran the game', () => {
    for (const latestVerify of [verify('passed', false), { ...verify(), steps: verify().steps.map(step => ({ ...step, status: 'failed' as const })) },
      { ...verify(), steps: verify().steps.map(step => ({ ...step, status: 'skipped' as const })) },
      { ...verify(), steps: verify().steps.map(step => ({ ...step, timedOut: true })) }]) {
      expect(statuses(facts({ latestVerify }))[1]).toEqual(['run-game', 'todo']);
    }
    expect(statuses(facts({ latestVerify: { ...verify(), steps: verify().steps.map(({ status: _status, ...step }) => step) } }))[1]).toEqual(['run-game', 'done']);
  });
  it('blocks unknown engines and unsupported runs, whichever folder the project lives in', () => {
    expect(statuses(facts({ profile: { ...profile('unknown'), tools: [], commands: {} }, doctor: { checks: [] } })).map(([, status]) => status))
      .toEqual(['blocked', 'blocked', 'todo', 'todo', 'blocked']);
    expect(statuses(facts())[1]).toEqual(['run-game', 'todo']);
    expect(statuses(facts())[4]).toEqual(['verify', 'todo']);
    expect(statuses(facts({ profile: { ...profile('unity'), tools: [{ id: 'unity', resolved: true }] } }))[1]).toEqual(['run-game', 'blocked']);
  });
  it('keeps observed game readiness complete after stop or a daemon restart without a latest verify', () => {
    expect(deriveProjectNextSteps('game', { kind: 'other', gameRunSucceededAt: 123 }, facts()).steps[1]!.status).toBe('done');
    expect(deriveProjectNextSteps('game', { kind: 'other', gameRunSucceededAt: Number.NaN }, facts()).steps[1]!.status).toBe('todo');
    expect(statuses(facts({ profile: { ...profile('web-generic'), tools: [{ id: 'npm', resolved: true }] }, doctor: { checks: [check('node'), check('npm')] } }))[1])
      .toEqual(['run-game', 'blocked']);
    expect(statuses(facts({ profile: { ...profile(), commands: { check: profile().commands.check! } } }))[1]).toEqual(['run-game', 'todo']);
  });
  it('reads dismissal as a preference without changing the project facts', () => {
    const result = deriveProjectNextSteps('game', { kind: 'other', starterChecklistDismissed: true }, facts());
    expect(result.dismissed).toBe(true);
    expect(result.steps.filter(step => step.status === 'done')).toHaveLength(1);
  });
});
