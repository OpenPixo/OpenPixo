// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  NextStepActions,
  PROJECT_CONTINUE_PROMPT,
} from '../../src/components/NextStepActions';
import { I18nProvider } from '../../src/i18n';
import { en } from '../../src/i18n/locales/en';
import type { Locale } from '../../src/i18n/types';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderActions(
  overrides: Partial<Parameters<typeof NextStepActions>[0]> = {},
  locale?: Locale,
) {
  const handlers = {
    onDownload: vi.fn(),
  };
  const ui = (
    <NextStepActions
      fileName="landing.html"
      onDownload={handlers.onDownload}
      {...overrides}
    />
  );
  render(locale ? <I18nProvider initial={locale}>{ui}</I18nProvider> : ui);
  return handlers;
}

function renderPlanActions(
  overrides: Partial<Parameters<typeof NextStepActions>[0]> = {},
  locale?: Locale,
) {
  return renderActions({ variant: 'plan', onPromptAction: vi.fn(), ...overrides }, locale);
}

describe('NextStepActions', () => {
  it('offers document handoff rows after plan mode produces only a document', () => {
    const onPromptAction = vi.fn();
    renderActions({
      variant: 'plan',
      fileName: 'plan.md',
      planFileName: 'plan.md',
      artifactFileName: null,
      onPromptAction,
    });

    expect(screen.getByText(en['nextStep.planGenerateTitle'])).toBeTruthy();
    expect(screen.getByText(en['nextStep.planImproveTitle'])).toBeTruthy();
    expect(screen.queryByText(en['nextStep.planImproveArtifactTitle'])).toBeNull();

    fireEvent.click(screen.getByTestId('next-step-plan-action-plan-generate-from-doc'));
    expect(onPromptAction).toHaveBeenLastCalledWith(
      expect.stringContaining('plan.md'),
      { sessionMode: 'design' },
    );

    fireEvent.click(screen.getByTestId('next-step-plan-action-plan-improve-doc'));
    expect(onPromptAction).toHaveBeenLastCalledWith(
      expect.stringContaining('plan.md'),
      { sessionMode: 'plan' },
    );
  });

  it('offers artifact refinement after plan mode produces only an artifact', () => {
    const onPromptAction = vi.fn();
    renderActions({
      variant: 'plan',
      fileName: 'index.html',
      planFileName: null,
      artifactFileName: 'index.html',
      onPromptAction,
    });

    expect(screen.queryByText(en['nextStep.planGenerateTitle'])).toBeNull();
    expect(screen.queryByText(en['nextStep.planImproveTitle'])).toBeNull();
    expect(screen.getByText(en['nextStep.planImproveArtifactTitle'])).toBeTruthy();

    fireEvent.click(screen.getByTestId('next-step-plan-action-plan-improve-artifact'));
    expect(onPromptAction).toHaveBeenLastCalledWith(
      expect.stringContaining('index.html'),
      { sessionMode: 'design' },
    );
  });

  it('offers a document/artifact merge when plan mode produces both', () => {
    const onPromptAction = vi.fn();
    renderActions({
      variant: 'plan',
      fileName: 'plan.md',
      planFileName: 'plan.md',
      artifactFileName: 'index.html',
      onPromptAction,
    });

    expect(screen.queryByText(en['nextStep.planGenerateTitle'])).toBeNull();
    expect(screen.queryByText(en['nextStep.planImproveTitle'])).toBeNull();
    expect(screen.getByText(en['nextStep.planMergeTitle'])).toBeTruthy();
    expect(screen.getByText(en['nextStep.planImproveArtifactTitle'])).toBeTruthy();

    fireEvent.click(screen.getByTestId('next-step-plan-action-plan-merge-doc-artifact'));
    expect(onPromptAction).toHaveBeenLastCalledWith(
      expect.stringContaining('plan.md'),
      { sessionMode: 'design' },
    );
    expect(onPromptAction.mock.calls.at(-1)?.[0]).toContain('index.html');
  });

  it('offers ordinary project recovery prompts for incomplete turns without artifacts', () => {
    const onPromptAction = vi.fn();
    renderActions({
      variant: 'project-incomplete',
      fileName: null,
      onPromptAction,
    });

    expect(screen.getByText(en['nextStep.projectContinueTitle'])).toBeTruthy();
    fireEvent.click(screen.getByTestId('next-step-project-action-project-continue'));
    expect(onPromptAction).toHaveBeenCalledWith(PROJECT_CONTINUE_PROMPT);
  });

  it('localizes incomplete-project recovery prompts in Chinese', () => {
    const onPromptAction = vi.fn();
    renderActions({
      variant: 'project-incomplete',
      fileName: null,
      onPromptAction,
    }, 'zh-CN');

    fireEvent.click(screen.getByTestId('next-step-project-action-project-continue'));
    expect(onPromptAction).toHaveBeenCalledWith(
      '从中断或未完成的那一轮继续。先阅读对话、当前项目文件和可见的错误，然后执行下一个具体步骤，并总结改了什么。',
    );
  });

  it('opens the More menu with Download on hover', () => {
    renderPlanActions();
    fireEvent.mouseEnter(screen.getByTestId('next-step-toolbox-more'));
    const menu = screen.getByTestId('next-step-more-menu');
    expect(menu).toBeTruthy();
    expect(screen.getByTestId('next-step-more-download')).toBeTruthy();
  });

  it('routes the retained Download action directly', () => {
    const h = renderPlanActions();
    fireEvent.mouseEnter(screen.getByTestId('next-step-toolbox-more'));
    fireEvent.click(screen.getByTestId('next-step-more-download'));
    expect(h.onDownload).toHaveBeenCalledWith('landing.html');
  });

  it('hides the More row when nothing behind it is wired', () => {
    renderPlanActions({
      onDownload: undefined,
    });
    expect(screen.queryByTestId('next-step-toolbox-more')).toBeNull();
  });
});

/**
 * 稿子第 41 / 42 格 —— 回合末尾三行**由 agent 现写**的行为引导。
 *
 * 产品裁决(2026-08-26):固定的工具箱目录不要了,换成 agent 生成的三条行为引导。
 * 这一族的判据全在这里:
 *   · 三条建议照原样出成三行,不是菜单;
 *   · 点一条 = 把那句话**直接发出去**(所以行尾没有 `›`);
 *   · 旧会话(没有建议)这一行**干脆不出** —— 不退回工具箱、不出空壳。
 */
describe('NextStepActions · 三条行为引导', () => {
  const THREE = ['再加一页订单列表', '把商品卡换成两列布局', '补一套深色模式'];

  function renderSuggestions(
    suggestions: string[] | undefined,
    overrides: Partial<Parameters<typeof NextStepActions>[0]> = {},
  ) {
    const onSuggestion = vi.fn();
    renderActions({ suggestions, onSuggestion, ...overrides });
    return { onSuggestion };
  }

  it('把三条建议出成三行', () => {
    renderSuggestions(THREE);
    const list = screen.getByTestId('next-step-suggestions');
    for (const text of THREE) expect(within(list).getByText(text)).toBeTruthy();
    expect(within(list).getAllByRole('button')).toHaveLength(3);
  });

  it('每行一枚箭头,没有分类图标、没有行尾 chevron', () => {
    renderSuggestions(THREE);
    const row = screen.getByTestId('next-step-suggestion-0');
    // 稿子 `.nexts button` 里只有一个 svg —— 同一枚箭头。多出来的那个就是
    // 「点开还有下一层」的承诺,而这一行点下去是直接发送,没有下一层。
    expect(row.querySelectorAll('svg')).toHaveLength(1);
  });

  it('点一条就把那句话发出去 —— 不是打开菜单、也不是填草稿', () => {
    const { onSuggestion } = renderSuggestions(THREE);
    fireEvent.click(screen.getByTestId('next-step-suggestion-1'));
    expect(onSuggestion).toHaveBeenCalledTimes(1);
    expect(onSuggestion).toHaveBeenCalledWith('把商品卡换成两列布局');
  });

  it('旧会话(没有建议)整块不出 —— 不退回工具箱、不出空壳', () => {
    renderSuggestions(undefined);
    expect(screen.queryByTestId('next-step-actions')).toBeNull();
    expect(screen.queryByTestId('next-step-suggestions')).toBeNull();
    // 工具箱那一档已经不在 `default` 上了,不能因为「没有建议」又退回去
    expect(screen.queryByTestId('next-step-toolbox-more')).toBeNull();
  });

  it('空数组同理', () => {
    renderSuggestions([]);
    expect(screen.queryByTestId('next-step-actions')).toBeNull();
  });

  it('全是空白字符时也不出', () => {
    renderSuggestions(['  ', '\n']);
    expect(screen.queryByTestId('next-step-actions')).toBeNull();
  });

  it('没有接发送回调时不出 —— 出了也点不动', () => {
    renderActions({ suggestions: THREE, onSuggestion: undefined });
    expect(screen.queryByTestId('next-step-actions')).toBeNull();
  });

  it('模型给多于三条时只出前三条', () => {
    renderSuggestions([...THREE, '再来一条', '还有一条']);
    expect(within(screen.getByTestId('next-step-suggestions')).getAllByRole('button')).toHaveLength(3);
    expect(screen.queryByText('再来一条')).toBeNull();
  });

  it('模型只给一条时就出一条,不补空行', () => {
    renderSuggestions(['补一套深色模式']);
    const list = screen.getByTestId('next-step-suggestions');
    expect(within(list).getAllByRole('button')).toHaveLength(1);
    expect(within(list).getByText('补一套深色模式')).toBeTruthy();
  });
});
