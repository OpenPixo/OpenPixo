import { describe, expect, it } from 'vitest';
import {
  OPENPIXO_PLUGIN_SPEC_VERSION,
  MarketplacePluginEntrySchema,
  PluginManifestSchema,
  resolveLocalizedText,
} from '../src/plugins/index.js';

describe('recipe input translations', () => {
  const withInput = (input: Record<string, unknown>) => ({
    name: 'sample-recipe',
    version: '1.0.0',
    pixo: { kind: 'recipe', recipe: { surface: 'code', category: 'feature', inputs: [input] }, useCase: { query: 'Make it' } },
  });

  it('keeps translated labels, placeholders, option labels and free-text prefills', () => {
    const manifest = PluginManifestSchema.parse({
      ...withInput({ name: 'tone', label: 'Tone', label_i18n: { 'zh-CN': '基调' }, type: 'select', options: ['calm', 'tense'], default: 'calm', optionLabels_i18n: { 'zh-CN': { calm: '平静' } } }),
    });
    expect(manifest.pixo?.recipe?.inputs[0]).toMatchObject({ label_i18n: { 'zh-CN': '基调' }, optionLabels_i18n: { 'zh-CN': { calm: '平静' } } });

    expect(PluginManifestSchema.safeParse(withInput({
      name: 'theme', type: 'text', default: 'a fox', default_i18n: { 'zh-CN': '一只狐狸' },
      placeholder: 'a fox', placeholder_i18n: { 'zh-CN': '一只狐狸' },
    })).success).toBe(true);
  });

  it.each([
    ['an option the field does not have', { name: 'tone', type: 'select', options: ['calm'], optionLabels_i18n: { 'zh-CN': { renamed: '平静' } } }, 'translates an option'],
    ['a translated default on a select, which would send a value the recipe rejects', { name: 'tone', type: 'select', options: ['calm'], default: 'calm', default_i18n: { 'zh-CN': '平静' } }, 'default_i18n'],
    ['a translated default on a number', { name: 'bpm', type: 'number', default: 100, default_i18n: { 'zh-CN': '一百' } }, 'default_i18n'],
    ['a translated default with no default to translate', { name: 'theme', type: 'string', default_i18n: { 'zh-CN': '狐狸' } }, 'default_i18n'],
  ])('rejects %s', (_name, input, message) => {
    const result = PluginManifestSchema.safeParse(withInput(input));
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message).join('\n')).toContain(message);
  });
});

describe('plugin manifest localized text', () => {
  it('exports the current plugin spec version for manifests and registries', () => {
    expect(OPENPIXO_PLUGIN_SPEC_VERSION).toBe('1.0.0');
  });

  it('accepts legacy string use-case queries', () => {
    const manifest = PluginManifestSchema.parse({
      name: 'sample-plugin',
      version: '1.0.0',
      pixo: {
        useCase: {
          query: 'Make a {{topic}} brief.',
        },
      },
    });

    expect(manifest.pixo?.useCase?.query).toBe('Make a {{topic}} brief.');
  });

  it('accepts locale-map use-case queries', () => {
    const manifest = PluginManifestSchema.parse({
      name: 'sample-plugin',
      version: '1.0.0',
      pixo: {
        useCase: {
          query: {
            en: 'Make a {{topic}} brief.',
            'zh-CN': '围绕 {{topic}} 写一份简报。',
          },
        },
      },
    });

    expect(resolveLocalizedText(manifest.pixo?.useCase?.query, 'zh-CN')).toBe(
      '围绕 {{topic}} 写一份简报。',
    );
  });

  it('accepts a valid preview motion and rejects an invalid one', () => {
    const manifest = PluginManifestSchema.parse({
      name: 'sample-plugin',
      version: '1.0.0',
      pixo: {
        preview: { type: 'html', entry: './index.html', motion: 'deck' },
      },
    });
    expect(manifest.pixo?.preview?.motion).toBe('deck');

    expect(() =>
      PluginManifestSchema.parse({
        name: 'sample-plugin',
        version: '1.0.0',
        pixo: { preview: { type: 'html', motion: 'sideways' } },
      }),
    ).toThrow();
  });

  it('accepts localized title and description metadata', () => {
    const manifest = PluginManifestSchema.parse({
      name: 'sample-plugin',
      version: '1.0.0',
      title: 'Sample Plugin',
      title_i18n: {
        en: 'Sample Plugin',
        'zh-CN': '示例插件',
      },
      description: 'English fallback.',
      description_i18n: {
        en: 'English fallback.',
        'zh-CN': '中文描述。',
      },
    });

    expect(resolveLocalizedText(manifest.title_i18n, 'zh-CN')).toBe('示例插件');
    expect(resolveLocalizedText(manifest.description_i18n, 'zh-CN')).toBe('中文描述。');
  });

  it('accepts localized marketplace entry metadata', () => {
    const entry = MarketplacePluginEntrySchema.parse({
      name: 'openpixo/example-sample',
      license: 'MIT',
      source: 'github:example-org/plugins/examples/sample',
      version: '1.0.0',
      title: 'Sample',
      title_i18n: {
        en: 'Sample',
        'zh-CN': '示例',
      },
      description: 'English fallback.',
      description_i18n: {
        en: 'English fallback.',
        'zh-CN': '中文描述。',
      },
    });

    expect(resolveLocalizedText(entry.title_i18n, 'zh-CN')).toBe('示例');
    expect(resolveLocalizedText(entry.description_i18n, 'zh-CN')).toBe('中文描述。');
  });

  it('falls back from exact locale to base language, English, then first value', () => {
    expect(resolveLocalizedText({ en: 'English', zh: '中文' }, 'zh-CN')).toBe('中文');
    expect(resolveLocalizedText({ 'zh-CN': '中文' }, 'fr')).toBe('中文');
  });
});
