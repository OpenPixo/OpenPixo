import { describe, expect, it } from 'vitest';
import { nextGameStage, parseGameStageLabel, renderNextStageKickoff } from '../src/api/game-stage.js';

describe('a build reply\'s stage label', () => {
  it('reads the label the agent opens a build reply with, in either language', () => {
    expect(parseGameStageLabel('阶段 2 / 共 4：敌人与升级\n\n做好了')).toEqual({ stage: 2, total: 4, locale: 'zh-CN' });
    expect(parseGameStageLabel('**阶段 1/共 3: 能玩的最小版本**')).toEqual({ stage: 1, total: 3, locale: 'zh-CN' });
    expect(parseGameStageLabel('## Stage 3 of 5: the boss')).toEqual({ stage: 3, total: 5, locale: 'en' });
  });

  it('ignores planning steps, impossible numbers and replies without a label', () => {
    expect(parseGameStageLabel('第 2 步 / 共 5 步：画风')).toBeNull();
    expect(parseGameStageLabel('阶段 5 / 共 3：x')).toBeNull();
    expect(parseGameStageLabel('剑光改亮了。')).toBeNull();
    expect(parseGameStageLabel(null)).toBeNull();
  });

  it('names the next stage, or none after the last', () => {
    expect(nextGameStage(null, 'zh-CN')).toEqual({ stage: 1, total: null, locale: 'zh-CN' });
    expect(nextGameStage({ stage: 2, total: 4, locale: 'en' }, 'zh-CN')).toEqual({ stage: 3, total: 4, locale: 'en' });
    expect(nextGameStage({ stage: 4, total: 4, locale: 'en' }, 'en')).toBeNull();
    expect(renderNextStageKickoff({ stage: 2, total: 3, locale: 'en' })).toBe('Continuing in this new conversation: Stage 1 is built and confirmed. Build stage 2 of 3 of the approved plan.');
    expect(renderNextStageKickoff({ stage: 4, total: 6, locale: 'zh-CN' })).toBe('在这个新对话里继续：阶段 1–3 已经做完并确认。请按已批准的计划制作阶段 4 / 共 6。');
  });
});
