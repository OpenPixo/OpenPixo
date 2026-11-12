// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react';
import { forwardRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatPane } from '../../src/components/ChatPane';
import { I18nProvider } from '../../src/i18n';
import type { ProjectMetadata } from '../../src/types';

vi.mock('../../src/components/ChatComposer', () => ({
  ChatComposer: forwardRef(({ placeholderScenarios }: {
    placeholderScenarios: Array<{ id: string; text: string }>;
  }, _ref) => (
    <ul aria-label="Task suggestions">
      {placeholderScenarios.map(scenario => <li key={scenario.id}>{scenario.text}</li>)}
    </ul>
  )),
}));

afterEach(cleanup);

const metadataVariants: Array<ProjectMetadata | undefined> = [
  undefined,
  { kind: 'image' },
  { kind: 'video' },
  { kind: 'video', videoModel: 'hyperframes-html' },
  { kind: 'audio' },
];

describe('game task suggestions', () => {
  it.each([
    ['en', [/player/i, /error log/i, /run the game/i, /recipe/i]],
    ['zh-CN', [/角色/, /错误日志/, /运行游戏/, /配方/]],
  ] as const)('offers localized game tasks for every saved project kind in %s', (locale, tasks) => {
    const pane = (projectMetadata: ProjectMetadata | undefined) => (
      <I18nProvider initial={locale}>
        <ChatPane
          messages={[]}
          streaming={false}
          error={null}
          projectId="game"
          projectFiles={[]}
          projectMetadata={projectMetadata}
          onEnsureProject={async () => 'game'}
          onSend={vi.fn()}
          onStop={vi.fn()}
          conversations={[]}
          activeConversationId={null}
          onSelectConversation={vi.fn()}
          onDeleteConversation={vi.fn()}
        />
      </I18nProvider>
    );
    const view = render(pane(undefined));
    let firstSuggestions: string[] | undefined;
    for (const metadata of metadataVariants) {
      view.rerender(pane(metadata));
      const suggestions = within(screen.getByRole('list', { name: 'Task suggestions' })).getAllByRole('listitem');
      expect(suggestions).toHaveLength(4);
      tasks.forEach((task, index) => expect(suggestions[index]?.textContent).toMatch(task));
      const texts = suggestions.map(item => item.textContent ?? '');
      firstSuggestions ??= texts;
      expect(texts).toEqual(firstSuggestions);
    }
  });
});
