// @vitest-environment jsdom
//
// 2026-11-18: on 我的游戏 the 新建项目 button opened an inherited media-project form
// (媒体 / 新建图片, a model picker, a leftover visibility line) while the sidebar's
// 新建游戏 opened the game setup. Both now open the game setup.

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EntryShell } from '../../src/components/EntryShell';
import { I18nProvider } from '../../src/i18n';
import type { AgentInfo, AppConfig, Project } from '../../src/types';

const originalFetch = globalThis.fetch;
const originalResizeObserver = globalThis.ResizeObserver;

class ResizeObserverMock {
  observe() {}
  disconnect() {}
  unobserve() {}
}

const agent: AgentInfo = { id: 'claude-code', name: 'Claude Code', bin: 'claude', available: true, version: '1.0.0', models: [] };
const game: Project = { id: 'game-1', name: 'Jumping Cat', skillId: null, createdAt: 1, updatedAt: 1 };

beforeEach(() => {
  globalThis.ResizeObserver = ResizeObserverMock as typeof ResizeObserver;
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ context: null, projects: [], plugins: [], templates: [], styles: [], locations: [] }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })) as typeof fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  globalThis.ResizeObserver = originalResizeObserver;
  vi.unstubAllGlobals();
});

describe('我的游戏 new button', () => {
  it('opens the game setup, not a media-project form', async () => {
    window.history.replaceState(null, '', '/projects');
    render(
      <I18nProvider initial="en">
        <EntryShell
          skills={[]}
          projects={[game]}
          config={{ mode: 'daemon', agentId: 'claude-code', agentModels: {}, apiProtocol: 'anthropic', apiProtocolConfigs: {}, apiKey: '', baseUrl: '', model: '', theme: 'system' } as unknown as AppConfig}
          agents={[agent]}
          daemonLive
          onModeChange={vi.fn()} onAgentChange={vi.fn()} onAgentModelChange={vi.fn()} onApiProtocolChange={vi.fn()}
          onApiModelChange={vi.fn()} onConfigPersist={vi.fn()} onRefreshAgents={vi.fn(() => [agent])}
          onCreateProject={vi.fn(() => Promise.resolve(true))}
          onBeginProjectCreation={() => ({ projectId: 'p', rollback: () => undefined })}
          onCreatePluginShareProject={vi.fn()} onOpenProject={vi.fn()} onDeleteProject={vi.fn()}
          onDuplicateProject={vi.fn(async () => {})} onRenameProject={vi.fn()} onOpenSettings={vi.fn()}
          onCompleteOnboarding={vi.fn()}
          onImportFolderResponse={vi.fn(async () => {})}
        />
      </I18nProvider>,
    );

    const button = await screen.findByTestId('designs-new-project');
    expect(button.textContent).toContain('New game');
    fireEvent.click(button);

    expect(screen.queryByTestId('new-project-modal')).toBeNull();
    expect(await screen.findByText(/Step 1 of/)).toBeTruthy();
  });
});
