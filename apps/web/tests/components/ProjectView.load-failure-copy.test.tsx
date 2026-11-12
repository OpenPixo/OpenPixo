// @vitest-environment jsdom

import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectView } from '../../src/components/ProjectView';
import { ProjectConversationsHttpError, ProjectMessageListError } from '../../src/state/projects';

const listConversations = vi.fn();
const listMessages = vi.fn();
const createConversation = vi.fn();

const harness = vi.hoisted(() => ({ error: null as string | null }));

vi.mock('../../src/i18n', () => ({
  useI18n: () => ({
    locale: 'en',
    setLocale: () => undefined,
    t: (value: string) => value,
  }),
  useT: () => ((value: string) => value),
}));

vi.mock('../../src/providers/anthropic', () => ({
  streamMessage: vi.fn(),
}));

vi.mock('../../src/providers/daemon', () => ({
  GENERIC_DAEMON_DISCONNECT_CODE: 'GENERIC_DAEMON_DISCONNECT',
  GENERIC_DAEMON_DISCONNECT_MESSAGE: 'daemon stream disconnected before run completed',
  fetchChatRunStatus: vi.fn().mockResolvedValue(null),
  fetchAmrWalletSnapshot: vi.fn().mockResolvedValue(null),
  listActiveChatRuns: vi.fn().mockResolvedValue([]),
  listProjectRuns: vi.fn().mockResolvedValue([]),
  publishDaemonRunFinishedEvent: vi.fn(),
  reattachDaemonRun: vi.fn(),
  streamViaDaemon: vi.fn(),
}));

vi.mock('../../src/providers/registry', () => ({
  deletePreviewComment: vi.fn(),
  fetchPreviewComments: vi.fn(),
  fetchProjectFiles: vi.fn().mockResolvedValue([]),
  fetchSkill: vi.fn().mockResolvedValue(null),
  patchPreviewCommentStatus: vi.fn(),
  upsertPreviewComment: vi.fn(),
  writeProjectTextFile: vi.fn(),
}));

vi.mock('../../src/providers/project-events', () => ({
  useProjectFileEvents: vi.fn(),
}));

vi.mock('../../src/router', () => ({
  navigate: vi.fn(),
}));

vi.mock('../../src/state/projects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/state/projects')>()),
  cacheTabsLocally: vi.fn((projectId: string, tabs: unknown) => ({ projectId, tabs })),
  createConversation: (...args: unknown[]) => createConversation(...args),
  deleteConversation: vi.fn(),
  getTemplate: vi.fn().mockResolvedValue(null),
  listConversations: (...args: unknown[]) => listConversations(...args),
  listMessages: (...args: unknown[]) => listMessages(...args),
  loadTabs: vi.fn().mockResolvedValue({ tabs: [], active: null, hasSavedState: false }),
  patchConversation: vi.fn(),
  patchProject: vi.fn(),
  persistTabsToDaemonNow: vi.fn(),
  saveMessage: vi.fn(),
  saveTabs: vi.fn(),
}));

vi.mock('../../src/components/AppChromeHeader', () => ({
  AppChromeHeader: () => null,
}));

vi.mock('../../src/components/ChatPane', () => ({
  ChatPane: ({ error }: { error: string | null }) => {
    harness.error = error;
    return null;
  },
}));

vi.mock('../../src/components/FileWorkspace', () => ({
  FileWorkspace: () => null,
}));

vi.mock('../../src/components/Loading', () => ({
  CenteredLoader: () => null,
}));

function renderView() {
  const project = { id: 'project-1', name: 'Project', skillId: null } as never;
  render(
    <ProjectView
      project={project}
      initialProjectDetail={{ project, resolvedDir: null }}
      routeConversationId={null}
      routeFileName={null}
      config={{ mode: 'daemon', agentId: 'agent-1', notifications: undefined, agentModels: {} } as never}
      agents={[{ id: 'agent-1', name: 'OpenCode', models: [] } as never]}
      skills={[]}
      designTemplates={[]}
      daemonLive
      onModeChange={() => {}}
      onAgentChange={() => {}}
      onAgentModelChange={() => {}}
      onRefreshAgents={() => {}}
      onOpenSettings={() => {}}
      onBack={() => {}}
      onClearPendingPrompt={() => {}}
      onTouchProject={() => {}}
      onProjectChange={() => {}}
      onProjectsRefresh={() => {}}
    />,
  );
}

describe('a failed conversation load speaks in product copy', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    harness.error = null;
  });

  function expectCopyAndLoggedDetail(detail: Error) {
    expect(harness.error).toBe('project.conversationsLoadFailed');
    expect(warn.mock.calls.some((call: unknown[]) => call.includes(detail))).toBe(true);
  }

  it('listing conversations: 403 is refused at once and shows the copy, with the detail in the log', async () => {
    const detail = new ProjectConversationsHttpError(403);
    listConversations.mockRejectedValue(detail);

    renderView();

    await waitFor(() => expect(harness.error).not.toBeNull());
    expectCopyAndLoggedDetail(detail);
  });

  it('reading a transcript: the daemon text stays out of the card', async () => {
    const detail = new ProjectMessageListError('messages 403 /private/transcript.db', 403, null, false);
    listConversations.mockResolvedValue([{ id: 'conv-1', title: 'Conversation' }]);
    listMessages.mockRejectedValue(detail);

    renderView();

    await waitFor(() => expect(harness.error).not.toBeNull());
    expectCopyAndLoggedDetail(detail);
  });

  it('seeding the first conversation: the failure shows the copy', async () => {
    const detail = new Error('conversations 500');
    listConversations.mockResolvedValue([]);
    createConversation.mockRejectedValue(detail);

    renderView();

    await waitFor(() => expect(harness.error).not.toBeNull());
    expectCopyAndLoggedDetail(detail);
  });
});
