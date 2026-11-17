import { describe, expect, it } from 'vitest';
import { nextStageOffer } from '../../../src/runtime/chat/next-stage';

const approved = { status: 'approved' as const, startedAt: 1, approvedAt: 2 };

describe('nextStageOffer', () => {
  it('offers the stage after a labelled build reply of an approved plan', () => {
    expect(nextStageOffer(approved, '阶段 2 / 共 4：敌人与升级\n做好了')).toEqual({ stage: 3, total: 4, locale: 'zh-CN' });
  });

  it('offers nothing while planning, without a label, or after the last stage', () => {
    expect(nextStageOffer({ status: 'planning', startedAt: 1 }, '阶段 2 / 共 4：x')).toBeNull();
    expect(nextStageOffer(approved, '剑光改亮了。')).toBeNull();
    expect(nextStageOffer(approved, 'Stage 4 of 4: the boss')).toBeNull();
    expect(nextStageOffer(null, '阶段 1 / 共 3：x')).toBeNull();
  });
});
