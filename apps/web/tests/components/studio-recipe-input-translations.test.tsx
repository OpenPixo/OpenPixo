// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PluginManifestSchema, type RecipeDetail } from '@openpixo/contracts';
import { RecipeRunner } from '../../src/components/studio/RecipeRunner';
import { I18nProvider } from '../../src/i18n';

const THEME = 'a fox exploring an overgrown temple';
const THEME_ZH = '一只探索荒草丛生的神庙的狐狸';
const SCOPE = 'coins and a goal flag';
const OTHER_SCOPE = 'coins, patrolling enemies and a goal flag';

function recipe(): RecipeDetail {
  return {
    id: 'starter', title: 'Starter', description: 'A starter', version: '1.0.0',
    surface: 'code', category: 'starter', engines: ['any'], requires: [],
    manifest: PluginManifestSchema.parse({
      specVersion: '1.0.0', name: 'test/starter', version: '1.0.0',
      pixo: {
        kind: 'recipe',
        recipe: { surface: 'code', category: 'starter', inputs: [
          { name: 'theme', label: 'Theme', label_i18n: { 'zh-CN': '主题' }, type: 'string', default: THEME, default_i18n: { 'zh-CN': THEME_ZH } },
          { name: 'scope', label: 'Scope', label_i18n: { 'zh-CN': '范围' }, type: 'select', options: [SCOPE, OTHER_SCOPE], default: SCOPE,
            optionLabels_i18n: { 'zh-CN': { [SCOPE]: '金币和终点旗帜', [OTHER_SCOPE]: '金币、巡逻敌人和终点旗帜' } } },
          { name: 'mood', label: 'Mood and setting', label_i18n: { 'zh-CN': '情绪和场景' }, type: 'string',
            placeholder: 'calm, curious exploration', placeholder_i18n: { 'zh-CN': '平静而好奇地探索' } },
          { name: 'file', label: 'File name', label_i18n: { 'zh-CN': '文件名' }, type: 'string', placeholder: 'village_theme' },
          { name: 'format', label: 'Format', label_i18n: { 'zh-CN': '格式' }, type: 'select', options: ['ogg', 'wav'], default: 'ogg' },
        ] },
        useCase: { query: 'Make {{theme}} {{scope}} {{mood}} {{file}} {{format}}' },
      },
    }),
  };
}

function renderRecipe(locale: 'en' | 'zh-CN') {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: 'started', runId: 'r1', missingSkills: [] }),
    { headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);
  render(<I18nProvider initial={locale}><RecipeRunner
    projectId="game" detail={recipe()} files={[]} characters={[]} referencePaths={[]}
    onUnavailable={vi.fn()} onAdopted={vi.fn(async () => {})} onOpenFile={vi.fn()} onOpenExtensions={vi.fn()}
  /></I18nProvider>);
  return fetchMock;
}

async function submittedInputs(fetchMock: ReturnType<typeof renderRecipe>, submit: string) {
  fireEvent.click(screen.getByRole('button', { name: submit }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  return (JSON.parse(String(init.body)) as { inputs: Record<string, unknown> }).inputs;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('recipe inputs in the app language', () => {
  it('reads in Simplified Chinese and still sends the option values the recipe accepts', async () => {
    const fetchMock = renderRecipe('zh-CN');

    expect((screen.getByLabelText('主题') as HTMLInputElement).value).toBe(THEME_ZH);
    expect(screen.getByLabelText('情绪和场景')).toHaveAttribute('placeholder', '平静而好奇地探索');
    expect(screen.getByLabelText('文件名')).toHaveAttribute('placeholder', 'village_theme');
    expect(screen.getByRole('option', { name: '金币和终点旗帜' })).toHaveValue(SCOPE);
    expect(screen.getByRole('option', { name: 'ogg' })).toHaveValue('ogg');
    expect(screen.queryByText('Theme')).toBeNull();
    expect(screen.queryByRole('option', { name: SCOPE })).toBeNull();

    fireEvent.change(screen.getByLabelText('范围'), { target: { value: OTHER_SCOPE } });

    expect(await submittedInputs(fetchMock, '生成')).toMatchObject({ theme: THEME_ZH, scope: OTHER_SCOPE, format: 'ogg' });
  });

  it('leaves English exactly as the manifest wrote it', async () => {
    const fetchMock = renderRecipe('en');

    expect((screen.getByLabelText('Theme') as HTMLInputElement).value).toBe(THEME);
    expect(screen.getByLabelText('Mood and setting')).toHaveAttribute('placeholder', 'calm, curious exploration');
    expect(screen.getByRole('option', { name: SCOPE })).toHaveValue(SCOPE);
    expect(screen.queryByText('主题')).toBeNull();

    expect(await submittedInputs(fetchMock, 'Generate')).toMatchObject({ theme: THEME, scope: SCOPE, format: 'ogg' });
  });
});
