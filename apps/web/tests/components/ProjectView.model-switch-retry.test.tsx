// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectView } from '../../src/components/ProjectView';
import type { InlineModelSwitcher } from '../../src/components/InlineModelSwitcher';
import type { ChatPane } from '../../src/components/ChatPane';
import { streamViaDaemon } from '../../src/providers/daemon';
import type { AgentInfo, AppConfig, ChatMessage, Conversation, Project } from '../../src/types';

const surface = vi.hoisted(() => ({
  chat: null as ComponentProps<typeof ChatPane> | null,
  picker: null as ComponentProps<typeof InlineModelSwitcher> | null,
}));

vi.mock('../../src/analytics/provider', () => ({ useAnalytics: () => ({ track: vi.fn() }) }));
vi.mock('../../src/i18n', () => ({
  useI18n: () => ({ locale: 'en', setLocale: vi.fn(), t: (key: string) => key }),
  useT: () => (key: string) => key,
}));
vi.mock('../../src/router', () => ({ navigate: vi.fn() }));
vi.mock('../../src/providers/anthropic', () => ({ streamMessage: vi.fn() }));
vi.mock('../../src/providers/daemon', () => ({
  GENERIC_DAEMON_DISCONNECT_CODE: 'GENERIC_DAEMON_DISCONNECT',
  GENERIC_DAEMON_DISCONNECT_MESSAGE: 'daemon stream disconnected before run completed',
  fetchChatRunStatus: vi.fn().mockResolvedValue(null),
  listActiveChatRuns: vi.fn().mockResolvedValue([]),
  listProjectRuns: vi.fn().mockResolvedValue([]),
  publishDaemonRunFinishedEvent: vi.fn(),
  reattachDaemonRun: vi.fn(),
  streamViaDaemon: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/providers/project-events', () => ({ useProjectFileEvents: vi.fn() }));
vi.mock('../../src/providers/registry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/providers/registry')>()),
  fetchPreviewComments: vi.fn().mockResolvedValue([]),
  fetchProjectFiles: vi.fn().mockResolvedValue([]),
  fetchSkill: vi.fn().mockResolvedValue(null),
  getTemplate: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../src/state/projects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/state/projects')>()),
  listConversations: vi.fn(async () => [conversation, otherConversation]),
  listMessages: vi.fn(async (_projectId: string, conversationId: string) =>
    conversationId === conversation.id ? [userMessage, failedAssistant] : []),
  loadTabs: vi.fn().mockResolvedValue({ tabs: [], active: null }),
  patchConversation: vi.fn(),
  patchProject: vi.fn(),
  saveMessage: vi.fn().mockResolvedValue(null),
  saveTabs: vi.fn(),
}));
vi.mock('../../src/components/AppChromeHeader', () => ({
  AppChromeHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
}));
vi.mock('../../src/components/FileWorkspace', () => ({ FileWorkspace: () => null }));
vi.mock('../../src/components/Loading', () => ({ CenteredLoader: () => null }));

vi.mock('../../src/components/InlineModelSwitcher', () => ({
  InlineModelSwitcher: (props: ComponentProps<typeof InlineModelSwitcher>) => {
    surface.picker = props;
    return <><button type="button" onClick={() => {
      props.onModeChange('daemon');
      props.onAgentChange('claude');
      props.onAgentModelChange('claude', { model: 'sonnet-new', reasoning: 'high' });
    }}>choose new model</button>
      <button type="button" onClick={() => {
        props.onModeChange('api');
        props.onApiModelChange?.('gpt-own-key-new');
      }}>choose own-key model</button>
    </>;
  },
}));
vi.mock('../../src/components/ChatPane', () => ({
  ChatPane: (props: ComponentProps<typeof ChatPane>) => {
    surface.chat = props;
    return <section>
      {props.composerFooterAccessory}
      <output data-testid="conversation">{props.activeConversationId}</output>
      <button type="button" onClick={() => props.onSwitchModel?.(failedAssistant)}>
        switch failed model
      </button>
    </section>;
  },
}));

const project: Project = { id: 'model-project', name: 'Model project', skillId: null, createdAt: 1, updatedAt: 1 };
const conversation: Conversation = { id: 'model-conversation', projectId: project.id, title: 'Retry', createdAt: 1, updatedAt: 1 };
const otherConversation: Conversation = { ...conversation, id: 'other-conversation', title: 'Other', createdAt: 0, updatedAt: 0 };
const userMessage: ChatMessage = { id: 'user-1', role: 'user', content: 'build the game', createdAt: 1 };
const failedAssistant: ChatMessage = {
  id: 'assistant-failed', role: 'assistant', content: 'failed work', createdAt: 2,
  runId: 'failed-run', runStatus: 'failed', agentId: 'codex',
  events: [{ kind: 'status', label: 'error', detail: 'provider rejected model', code: 'AGENT_EXECUTION_FAILED' }],
};
const agents: AgentInfo[] = [
  { id: 'codex', name: 'Codex', bin: 'codex', available: true, models: [{ id: 'gpt-old', label: 'Old GPT' }] },
  { id: 'claude', name: 'Claude Code', bin: 'claude', available: true, models: [{ id: 'sonnet-new', label: 'New Sonnet' }] },
];
const initialConfig: AppConfig = {
  mode: 'daemon', apiProtocol: 'openai', apiKey: 'test-own-key', baseUrl: 'https://api.deepseek.com', model: '',
  agentId: 'codex', agentModels: { codex: { model: 'gpt-old' } }, skillId: null,
};

function ConfigOwner({ deferModelCommit = false }: { deferModelCommit?: boolean }) {
  const [config, setConfig] = useState(initialConfig);
  const [routeConversationId, setRouteConversationId] = useState(conversation.id);
  const pendingModel = useRef<(() => void) | null>(null);
  return <>
    <button type="button" onClick={() => pendingModel.current?.()}>commit selected model</button>
    <button type="button" onClick={() => setRouteConversationId(otherConversation.id)}>open other conversation</button>
    <button type="button" onClick={() => setRouteConversationId(conversation.id)}>return to failed conversation</button>
    <ProjectView
      project={project} routeFileName={null} routeConversationId={routeConversationId} config={config} agents={agents}
      skills={[]} designTemplates={[]} daemonLive
      onModeChange={(mode) => setConfig(current => ({ ...current, mode }))}
      onAgentChange={(agentId) => setConfig(current => ({ ...current, agentId }))}
      onAgentModelChange={(agentId, choice) => {
        const commit = () => setConfig(current => ({
          ...current, agentModels: { ...current.agentModels, [agentId]: choice },
        }));
        if (deferModelCommit) pendingModel.current = commit;
        else commit();
      }}
      onApiModelChange={(model) => {
        const commit = () => setConfig(current => ({ ...current, model }));
        if (deferModelCommit) pendingModel.current = commit;
        else commit();
      }}
      onRefreshAgents={vi.fn()} onOpenSettings={vi.fn()} onBack={vi.fn()}
      onClearPendingPrompt={vi.fn()} onTouchProject={vi.fn()}
      onProjectChange={vi.fn()} onProjectsRefresh={vi.fn()}
    />
  </>;
}

beforeEach(() => {
  surface.chat = null;
  surface.picker = null;
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function openFailedModelPicker() {
  await waitFor(() => expect(surface.chat?.activeConversationId).toBe(conversation.id));
  await waitFor(() => expect(surface.chat?.loading).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'switch failed model' }));
  expect(surface.picker?.openSignal).toBe(1);
  expect(surface.picker?.placement).toBe('up');
}

describe('ProjectView error-card model switch retry', () => {
  it('retries once with the newly committed agent, model, and reasoning instead of the previous selection', async () => {
    render(<ConfigOwner />);
    await openFailedModelPicker();
    fireEvent.click(screen.getByRole('button', { name: 'choose new model' }));
    await waitFor(() => expect(streamViaDaemon).toHaveBeenCalledOnce());
    expect(vi.mocked(streamViaDaemon).mock.calls[0]?.[0]).toMatchObject({
      agentId: 'claude', model: 'sonnet-new', reasoning: 'high',
    });
  });

  it('waits for the selected model to commit even if the agent commits first', async () => {
    render(<ConfigOwner deferModelCommit />);
    await openFailedModelPicker();
    fireEvent.click(screen.getByRole('button', { name: 'choose new model' }));
    expect(surface.picker?.config.agentId).toBe('claude');
    expect(surface.picker?.config.agentModels?.claude).toBeUndefined();
    expect(streamViaDaemon).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'commit selected model' }));
    await waitFor(() => expect(streamViaDaemon).toHaveBeenCalledOnce());
    expect(vi.mocked(streamViaDaemon).mock.calls[0]?.[0]).toMatchObject({
      agentId: 'claude', model: 'sonnet-new', reasoning: 'high',
    });
  });

  it('waits for an own-key model to commit before retrying through the local CLI', async () => {
    render(<ConfigOwner deferModelCommit />);
    await openFailedModelPicker();
    fireEvent.click(screen.getByRole('button', { name: 'choose own-key model' }));
    expect(surface.picker?.config.mode).toBe('api');
    expect(surface.picker?.config.model).toBe('');
    expect(streamViaDaemon).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'commit selected model' }));
    await waitFor(() => expect(streamViaDaemon).toHaveBeenCalledOnce());
    expect(vi.mocked(streamViaDaemon).mock.calls[0]?.[0]).toMatchObject({
      agentId: 'codex', model: 'gpt-own-key-new',
      analyticsHints: { runtimeType: 'byok', recoveryActionType: 'switch_model_retry' },
    });
  });

  it('cancels a pending model-switch retry when leaving its conversation', async () => {
    render(<ConfigOwner deferModelCommit />);
    await openFailedModelPicker();
    fireEvent.click(screen.getByRole('button', { name: 'choose new model' }));
    fireEvent.click(screen.getByRole('button', { name: 'open other conversation' }));
    await waitFor(() => expect(surface.chat?.activeConversationId).toBe(otherConversation.id));
    fireEvent.click(screen.getByRole('button', { name: 'commit selected model' }));
    expect(streamViaDaemon).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'return to failed conversation' }));
    await waitFor(() => expect(surface.chat?.activeConversationId).toBe(conversation.id));
    await waitFor(() => expect(surface.chat?.loading).toBe(false));
    expect(streamViaDaemon).not.toHaveBeenCalled();
  });
});
