import { describe, expect, it } from 'vitest';
import type { PromptTemplateSummary, SkillSummary } from '../../src/types';
import { ZH_CN_SKILL_COPY } from '../../src/i18n/content.zh-CN';
import {
  localizePromptTemplateSummary,
  localizeSkillDescription,
  localizeSkillName,
  localizeSkillPrompt,
  hasLocalizedContent,
} from '../../src/i18n/content';

describe('localized resource content', () => {
  it('prefers localized skill copy and falls back to normalized source fields', () => {
    const localizedSkill = {
      id: 'agent-browser',
      examplePrompt: '  English prompt from source.  ',
      description: '  English description from source.  ',
    } as unknown as SkillSummary;

    expect(localizeSkillPrompt('zh-CN', localizedSkill)).toBe(
      ZH_CN_SKILL_COPY['agent-browser']!.examplePrompt!,
    );
    expect(localizeSkillDescription('zh-CN', localizedSkill)).toBe(
      ZH_CN_SKILL_COPY['agent-browser']!.description!,
    );

    const userSkill = { ...localizedSkill, id: 'user-defined-skill' };
    expect(localizeSkillPrompt('zh-CN', userSkill)).toBe('English prompt from source.');
    expect(localizeSkillDescription('zh-CN', userSkill)).toBe(
      'English description from source.',
    );
  });

  it('uses inline skill display metadata before falling back to source fields', () => {
    const inlineSkill = {
      id: 'inline-skill',
      name: 'inline-skill',
      displayName: {
        en: 'Inline Skill',
        'zh-CN': '内联技能',
      },
      description: ' English description from source. ',
      descriptionI18n: {
        en: 'English inline description.',
        'zh-CN': '中文内联描述。',
      },
      examplePrompt: ' English prompt from source. ',
      examplePromptI18n: {
        en: 'English inline prompt.',
        'zh-CN': '中文内联 prompt。',
      },
    } as unknown as SkillSummary;

    expect(localizeSkillName('zh-CN', inlineSkill)).toBe('内联技能');
    expect(localizeSkillName('en', inlineSkill)).toBe('Inline Skill');
    expect(localizeSkillDescription('zh-CN', inlineSkill)).toBe('中文内联描述。');
    expect(localizeSkillDescription('en', inlineSkill)).toBe('English inline description.');
    expect(localizeSkillPrompt('zh-CN', inlineSkill)).toBe('中文内联 prompt。');
    expect(localizeSkillPrompt('en', inlineSkill)).toBe('English inline prompt.');
  });

  it('prefers localized prompt template fields and falls back to english fields and tags', () => {
    const translatedTemplate = {
      id: 'steam-capsule-key-art',
      surface: 'image',
      title: 'English title',
      summary: 'English summary',
      category: 'Concept Art',
      tags: ['3d-render', 'unknown-tag'],
      source: { repo: 'repo', license: 'MIT' },
    } satisfies PromptTemplateSummary;

    const localized = localizePromptTemplateSummary('zh-CN', translatedTemplate);
    expect(localized.title).toBe('Steam 胶囊图主视觉（无文字母版）');
    expect(localized.summary).toBe(
      '为 Steam 商店胶囊图生成无文字的主视觉母版：一张画即可干净裁切为页眉胶囊（460x215，上传 920x430）、主胶囊（616x353，上传 1232x706）、小胶囊（231x87，上传 462x174）和库胶囊（600x900）。预留平静的 Logo 区、单一清晰的主体剪影和强明暗对比，缩成小缩略图依然可读；Logo 之后再合成。',
    );
    expect(localized.category).toBe('概念设定');
    expect(localized.tags).toEqual(['3d 渲染', 'unknown-tag']);
    expect(
      localizePromptTemplateSummary('zh-CN', { ...translatedTemplate, category: 'Unknown category' }).category,
    ).toBe('Unknown category');

    const englishOnlyTemplate = {
      ...translatedTemplate,
      id: 'user-defined-prompt',
      title: ' English title from source ',
      summary: ' English summary from source ',
      category: 'General',
      tags: ['unknown-tag'],
    } satisfies PromptTemplateSummary;

    expect(localizePromptTemplateSummary('zh-CN', englishOnlyTemplate)).toMatchObject({
      title: ' English title from source ',
      summary: ' English summary from source ',
      category: '通用',
      tags: ['unknown-tag'],
    });
  });

  it('resolves a built-in-content bundle for the maintained Chinese locale', () => {
    expect(hasLocalizedContent('zh-CN')).toBe(true);
    expect(hasLocalizedContent('en')).toBe(false);
  });
});
