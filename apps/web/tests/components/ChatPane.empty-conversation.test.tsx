// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { forwardRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatPane } from '../../src/components/ChatPane';
import { I18nProvider } from '../../src/i18n';

vi.mock('../../src/components/ChatComposer', () => ({
  ChatComposer: forwardRef(() => <div />),
}));
afterEach(cleanup);

describe('new game conversation localized guidance', () => {
  it.each([
    ['en', 'Start building with your agent', 'Describe a task, or reference project files and assets.'],
    ['zh-CN', '开始和 AI 一起做游戏', '描述想完成的任务，也可以引用项目文件或素材。'],
  ] as const)('shows a title and task hint in %s for an imported game with no media', (locale, title, hint) => {
    render(
      <I18nProvider initial={locale}>
        <ChatPane
          messages={[]}
          streaming={false}
          error={null}
          projectId="godot-game"
          projectFiles={['player.gd', 'main.tscn', 'project.godot'].map(name => ({
            name, kind: 'binary', size: 128, mtime: 1, mime: 'application/octet-stream',
          }))}
          projectMetadata={{ kind: 'prototype', importedFrom: 'folder' }}
          onEnsureProject={async () => 'godot-game'}
          onSend={vi.fn()}
          onStop={vi.fn()}
          conversations={[]}
          activeConversationId={null}
          onSelectConversation={vi.fn()}
          onDeleteConversation={vi.fn()}
        />
      </I18nProvider>,
    );
    expect(screen.getByRole('heading', { name: title })).toBeTruthy();
    expect(screen.getByText(hint)).toBeTruthy();
    expect(screen.queryByText('项目文件会显示在这里')).toBeNull();
    expect(screen.queryByText('Project files will appear here')).toBeNull();
  });
});
