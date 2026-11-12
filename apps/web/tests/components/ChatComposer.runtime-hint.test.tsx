// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RUNTIME_CAPABILITY_MATRIX } from '@openpixo/contracts';
import { ChatComposer } from '../../src/components/ChatComposer';
import { I18nProvider } from '../../src/i18n';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

it('shows the approval hint inside the composer only for unsupported runtimes and reuses the session fetch', async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => Response.json(
    input === '/api/agents/capabilities'
      ? { matrix: RUNTIME_CAPABILITY_MATRIX, runtimes: {} }
      : {},
  ));
  vi.stubGlobal('fetch', fetchMock);
  const hint = "This runtime won't ask for approval. It runs tools without confirmation.";
  const composer = (agentId: string, locale: 'en' | 'zh-CN' = 'en') => (
    <I18nProvider initial={locale}>
      <ChatComposer
        agentId={agentId}
        projectId="project-1"
        projectFiles={[]}
        streaming={false}
        onEnsureProject={async () => 'project-1'}
        onSend={vi.fn()}
        onStop={vi.fn()}
      />
    </I18nProvider>
  );
  const { rerender, unmount } = render(composer('opencode'));
  expect(await within(screen.getByTestId('chat-composer')).findByText(hint)).toBeTruthy();
  rerender(composer('codex'));
  expect(screen.queryByText(hint)).toBeNull();
  rerender(composer('unknown-runtime'));
  expect(screen.queryByText(hint)).toBeNull();
  unmount();
  render(composer('opencode', 'zh-CN'));
  expect(await screen.findByText('此运行时不会请求批准，工具会直接执行。')).toBeTruthy();
  expect(fetchMock.mock.calls.filter(([input]) => input === '/api/agents/capabilities')).toHaveLength(1);
});
