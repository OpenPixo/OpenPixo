import { describe, expect, it } from 'vitest';
import {
  chooseOpenPixoAgentAutoModel,
  formatCostMultiplier,
  gamePlanStepOfReply,
  hostedModelCostMultiplier,
  hostedModelCostMultipliers,
  isOpenPixoAgentAutoModel,
  isRetiredOpenPixoAgentModel,
  OPENPIXO_AGENT_AUTO_PLAN_MODEL,
  OPENPIXO_AGENT_AUTO_PLAN_TURNS_PER_GAME,
  OPENPIXO_AGENT_DEFAULT_MODEL,
  typicalAgentTurnCreditsPerMillion,
} from '../src/index.js';

// The cloud's credits per million tokens on 2026-11-09 (US$ list price × 100 × markup 2).
const CATALOGUE = [
  { id: 'openpixo-agent-flash', creditsPerMillionTokens: { inputCacheMiss: 60, inputCacheHit: 1.2, output: 240 } },
  { id: 'openpixo-agent-glm-5-3-flash', creditsPerMillionTokens: { inputCacheMiss: 30, inputCacheHit: 6, output: 100 } },
  { id: 'openpixo-agent-hy4', creditsPerMillionTokens: { inputCacheMiss: 166.8, inputCacheHit: 8.4, output: 500.2 } },
  { id: 'openpixo-agent-gpt-6-luna', creditsPerMillionTokens: { inputCacheMiss: 20, inputCacheHit: 2, inputCacheWrite: 25, output: 100 } },
  { id: 'openpixo-agent-gpt-6-1-sol', creditsPerMillionTokens: { inputCacheMiss: 400, inputCacheHit: 20, inputCacheWrite: 500, output: 2000 } },
];

describe('hosted model cost multiplier', () => {
  it('weighs a typical turn as 85% cached input, 10% new input and 5% output', () => {
    expect(typicalAgentTurnCreditsPerMillion({ inputCacheMiss: 100, inputCacheHit: 10, output: 1000 })).toBeCloseTo(8.5 + 10 + 50);
    // New input costs the cache-write rate where a model bills one.
    expect(typicalAgentTurnCreditsPerMillion({ inputCacheMiss: 100, inputCacheHit: 10, inputCacheWrite: 200, output: 1000 })).toBeCloseTo(8.5 + 20 + 50);
  });

  it('compares every model in the catalogue with DeepSeek V4.1 Flash', () => {
    expect(OPENPIXO_AGENT_DEFAULT_MODEL).toBe('openpixo-agent-flash');
    const labels = Object.fromEntries([...hostedModelCostMultipliers(CATALOGUE)].map(([id, value]) => [id, formatCostMultiplier(value)]));
    expect(labels).toEqual({
      'openpixo-agent-flash': '1×',
      'openpixo-agent-glm-5-3-flash': '0.7×',
      'openpixo-agent-hy4': '2.6×',
      'openpixo-agent-gpt-6-luna': '0.5×',
      'openpixo-agent-gpt-6-1-sol': '8.8×',
    });
  });

  it('gives nothing for a model without prices, or for any model when the baseline has none', () => {
    expect(hostedModelCostMultiplier(undefined, CATALOGUE[0]!.creditsPerMillionTokens)).toBeNull();
    expect(hostedModelCostMultiplier({ inputCacheHit: 1, output: 1 }, CATALOGUE[0]!.creditsPerMillionTokens)).toBeNull();
    expect(hostedModelCostMultiplier(CATALOGUE[1]!.creditsPerMillionTokens, { inputCacheMiss: 0, inputCacheHit: 0, output: 0 })).toBeNull();
    const withoutPrices = hostedModelCostMultipliers([{ id: 'openpixo-agent-flash' }, CATALOGUE[2]!]);
    expect(withoutPrices.size).toBe(0);
    const partly = hostedModelCostMultipliers([CATALOGUE[0]!, { id: 'openpixo-agent-new' }]);
    expect([...partly.keys()]).toEqual(['openpixo-agent-flash']);
  });

  it('prints one decimal below ten, whole numbers from ten, and never zero', () => {
    expect(formatCostMultiplier(1)).toBe('1×');
    expect(formatCostMultiplier(0.48)).toBe('0.5×');
    expect(formatCostMultiplier(2.567)).toBe('2.6×');
    expect(formatCostMultiplier(3.04)).toBe('3×');
    expect(formatCostMultiplier(9.94)).toBe('9.9×');
    expect(formatCostMultiplier(9.96)).toBe('10×');
    expect(formatCostMultiplier(12.4)).toBe('12×');
    expect(formatCostMultiplier(0.01)).toBe('0.1×');
  });
});

describe('Auto', () => {
  const planning = { planPending: true, lastPlanStep: 3, planTurnsUsed: 0, planModelOffered: true };

  it('writes the plan on Sonnet once the engine step has been shown', () => {
    expect(OPENPIXO_AGENT_AUTO_PLAN_MODEL).toBe('openpixo-agent-claude-sonnet-5-5');
    expect(chooseOpenPixoAgentAutoModel(planning)).toEqual({ model: OPENPIXO_AGENT_AUTO_PLAN_MODEL, planTurn: true });
    // Revising the written plan stays on Sonnet.
    expect(chooseOpenPixoAgentAutoModel({ ...planning, lastPlanStep: 4 }).planTurn).toBe(true);
  });

  it('runs every other turn on Flash', () => {
    const flash = { model: OPENPIXO_AGENT_DEFAULT_MODEL, planTurn: false };
    expect(chooseOpenPixoAgentAutoModel({ ...planning, lastPlanStep: 2 })).toEqual(flash);
    expect(chooseOpenPixoAgentAutoModel({ ...planning, lastPlanStep: null })).toEqual(flash);
    expect(chooseOpenPixoAgentAutoModel({ ...planning, planPending: false })).toEqual(flash);
  });

  it('stops after the per-game cap and when Sonnet is not on offer', () => {
    expect(chooseOpenPixoAgentAutoModel({ ...planning, planTurnsUsed: OPENPIXO_AGENT_AUTO_PLAN_TURNS_PER_GAME - 1 }).planTurn).toBe(true);
    expect(chooseOpenPixoAgentAutoModel({ ...planning, planTurnsUsed: OPENPIXO_AGENT_AUTO_PLAN_TURNS_PER_GAME }).planTurn).toBe(false);
    expect(chooseOpenPixoAgentAutoModel({ ...planning, planModelOffered: false }).model).toBe(OPENPIXO_AGENT_DEFAULT_MODEL);
  });

  it('knows its id with or without the provider prefix', () => {
    expect(isOpenPixoAgentAutoModel('openpixo-agent-auto')).toBe(true);
    expect(isOpenPixoAgentAutoModel('openpixo/openpixo-agent-auto')).toBe(true);
    expect(isOpenPixoAgentAutoModel('openpixo-agent-flash')).toBe(false);
    expect(isOpenPixoAgentAutoModel(null)).toBe(false);
  });
});

describe('planning step of a reply', () => {
  it('reads the label in either language near the start', () => {
    expect(gamePlanStepOfReply('第 3 步 / 共 5 步：引擎与技术\n\n我建议用 Phaser。')).toBe(3);
    expect(gamePlanStepOfReply('**第4步／共5步：计划**')).toBe(4);
    expect(gamePlanStepOfReply('## Step 2 of 5: Art\nHere are three samples.')).toBe(2);
    expect(gamePlanStepOfReply('step 1 of 5 — gameplay')).toBe(1);
  });

  it('ignores replies without a label, build stages and labels deep in the text', () => {
    expect(gamePlanStepOfReply('好的，我们来看看这个问题。')).toBeNull();
    expect(gamePlanStepOfReply('阶段 1 / 共 4：能玩的最小版本')).toBeNull();
    expect(gamePlanStepOfReply('Stage 2 of 4: enemies')).toBeNull();
    expect(gamePlanStepOfReply(`${'x'.repeat(300)} 第 4 步 / 共 5 步`)).toBeNull();
    expect(gamePlanStepOfReply('第 7 步 / 共 5 步')).toBeNull();
    expect(gamePlanStepOfReply(undefined)).toBeNull();
  });
});

describe('retired hosted models', () => {
  it('names DeepSeek V4 Pro as retired, with or without the provider prefix', () => {
    expect(isRetiredOpenPixoAgentModel('openpixo-agent-pro')).toBe(true);
    expect(isRetiredOpenPixoAgentModel('openpixo/openpixo-agent-pro')).toBe(true);
    expect(isRetiredOpenPixoAgentModel('openpixo-agent-flash')).toBe(false);
    expect(isRetiredOpenPixoAgentModel(undefined)).toBe(false);
  });
});
