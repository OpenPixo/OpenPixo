// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InstalledPluginRecord } from '@openpixo/contracts';
import { ComposerPluginPreview } from '../../src/components/ComposerPluginPreview';
import { I18nProvider } from '../../src/i18n';

vi.mock('../../src/components/plugins-home/cards/PreviewSurface', () => ({
  PreviewSurface: ({ pluginTitle }: { pluginTitle: string }) => <div role="img" aria-label={pluginTitle} />,
}));

afterEach(cleanup);

describe('composer plugin preview', () => {
  it.each(['webgl', 'image', 'video', 'hyperframes', 'audio'])('keeps plugin details without an inherited %s kind label', kind => {
    const record: InstalledPluginRecord = {
      id: `game-tool-${kind}`,
      title: 'Game tool',
      version: '0.1.0',
      sourceKind: 'bundled',
      source: '/fixture',
      trust: 'bundled',
      capabilitiesGranted: [],
      manifest: {
        name: `game-tool-${kind}`,
        version: '0.1.0',
        title_i18n: { en: 'Game tool', 'zh-CN': '游戏工具' },
        description_i18n: { en: 'Project helper', 'zh-CN': '项目助手' },
        tags: [kind],
        pixo: { kind: 'scenario', mode: kind },
      },
      fsPath: '/fixture',
      installedAt: 0,
      updatedAt: 0,
    };
    const preview = (locale: 'en' | 'zh-CN') => (
      <I18nProvider initial={locale}>
        <ComposerPluginPreview record={record} locale={locale} />
      </I18nProvider>
    );
    const view = render(preview('en'));
    expect(screen.getByText('Game tool')).toBeTruthy();
    expect(screen.getByText('Project helper')).toBeTruthy();
    expect(screen.getByLabelText('Official')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Game tool' })).toBeTruthy();
    for (const label of ['WebGL', 'Image', 'Video', 'HyperFrames', 'Audio']) {
      expect(screen.queryByText(label, { exact: true })).toBeNull();
    }
    view.rerender(preview('zh-CN'));
    expect(screen.getByText('游戏工具')).toBeTruthy();
    expect(screen.getByText('项目助手')).toBeTruthy();
    expect(screen.getByRole('img', { name: '游戏工具' })).toBeTruthy();
    for (const label of ['WebGL', '图片', '视频', 'HyperFrames', '音频']) {
      expect(screen.queryByText(label, { exact: true })).toBeNull();
    }
  });
});
