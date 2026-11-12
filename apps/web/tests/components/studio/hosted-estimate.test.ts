import { describe, expect, it } from 'vitest';
import { OPENPIXO_MODEL3D_PROMPT } from '@openpixo/contracts';
import { estimateGenerationCredits, estimatePromptTokens } from '../../../src/components/studio/hosted-estimate';

const service = { credits: 4, pricing: { longPromptTokens: 100, longPromptCredits: 1, maxPromptTokens: 300, extraReferenceCredits: 2 } };

describe('estimatePromptTokens', () => {
  it('counts about four other characters per token, rounding up', () => {
    expect(estimatePromptTokens('')).toBe(0);
    expect(estimatePromptTokens('abcd')).toBe(1);
    expect(estimatePromptTokens('abcde')).toBe(2);
  });

  it('counts each CJK, Hiragana, Katakana and Hangul character as one token', () => {
    expect(estimatePromptTokens('史莱姆')).toBe(3);
    expect(estimatePromptTokens('ひらカタ한글')).toBe(6);
    expect(estimatePromptTokens('史莱姆 abc')).toBe(4);
  });
});

describe('estimateGenerationCredits', () => {
  it('starts from the base price', () => {
    expect(estimateGenerationCredits(service, 'a slime', 0)).toBe(4);
  });

  it('adds the surcharge only above the long-prompt limit', () => {
    expect(estimateGenerationCredits(service, '像'.repeat(100), 0)).toBe(4);
    expect(estimateGenerationCredits(service, '像'.repeat(101), 0)).toBe(5);
    expect(estimateGenerationCredits(service, 'a'.repeat(400), 0)).toBe(4);
    expect(estimateGenerationCredits(service, 'a'.repeat(401), 0)).toBe(5);
  });

  it('charges only for references beyond the first', () => {
    expect(estimateGenerationCredits(service, 'a slime', 1)).toBe(4);
    expect(estimateGenerationCredits(service, 'a slime', 2)).toBe(6);
    expect(estimateGenerationCredits(service, 'a slime', 4)).toBe(10);
  });

  it('adds both together', () => {
    expect(estimateGenerationCredits(service, '像'.repeat(101), 3)).toBe(9);
  });

  it('gives a 3D model its base price, whatever the prompt and references would add elsewhere', () => {
    const model = { ...service, surface: 'model3d' as const, credits: 60 };
    expect(estimateGenerationCredits(model, OPENPIXO_MODEL3D_PROMPT, 1)).toBe(60);
    expect(estimateGenerationCredits(model, '像'.repeat(101), 4)).toBe(60);
  });
});
