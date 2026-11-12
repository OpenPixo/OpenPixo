// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { forwardRef, type ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ChatRunStatusResponse } from '@openpixo/contracts';
import { ProjectView } from '../../src/components/ProjectView';
import { I18nProvider } from '../../src/i18n';
import { en } from '../../src/i18n/locales/en';
import { streamViaDaemon, reattachDaemonRun } from '../../src/providers/daemon';
import type { AppConfig, ChatMessage, Project, ProjectFile } from '../../src/types';

import type { ProjectEvent } from '../../src/providers/project-events';

const observedChat = vi.hoisted(() => ({ messages: [] as ChatMessage[], proofCompletions: [] as string[], onProjectEvent: undefined as ((event: ProjectEvent) => void) | undefined }));

vi.mock('../../src/router', () => ({ navigate: vi.fn(), registerNavigationGuard: vi.fn(() => () => {}) }));
vi.mock('../../src/providers/anthropic', () => ({ streamMessage: vi.fn() }));
vi.mock('../../src/providers/daemon', async () => {
  const actual = await vi.importActual<typeof import('../../src/providers/daemon')>('../../src/providers/daemon');
  return { ...actual, fetchAmrWalletSnapshot: vi.fn().mockResolvedValue(null),
    fetchChatRunStatus: vi.fn(async (...args: Parameters<typeof actual.fetchChatRunStatus>) => {
      const result = await actual.fetchChatRunStatus(...args);
      observedChat.proofCompletions.push(args[0]);
      return result;
    }),
    streamViaDaemon: vi.fn().mockResolvedValue(undefined),
    reattachDaemonRun: vi.fn().mockResolvedValue(undefined),
    listActiveChatRuns: vi.fn().mockResolvedValue([]), listProjectRuns: vi.fn().mockResolvedValue([]),
    publishDaemonRunFinishedEvent: vi.fn() };
});
vi.mock('../../src/providers/project-events', () => ({ useProjectFileEvents: vi.fn((_id: string, _enabled: boolean, callback: (event: ProjectEvent) => void) => { observedChat.onProjectEvent = callback; }) }));
vi.mock('../../src/providers/registry', async () => {
  const actual = await vi.importActual<typeof import('../../src/providers/registry')>('../../src/providers/registry');
  return { ...actual,
    fetchProjectFilePreview: vi.fn().mockResolvedValue(null), fetchProjectFileText: vi.fn().mockResolvedValue(null),
    fetchProjectFolders: vi.fn().mockResolvedValue([]), fetchPreviewComments: vi.fn().mockResolvedValue([]),
    fetchSkill: vi.fn().mockResolvedValue(null) };
});
vi.mock('../../src/state/projects', async () => {
  const actual = await vi.importActual<typeof import('../../src/state/projects')>('../../src/state/projects');
  return { ...actual, createConversation: vi.fn(), listPlugins: vi.fn().mockResolvedValue([]),
    getTemplate: vi.fn().mockResolvedValue(null), loadTabs: vi.fn().mockResolvedValue({ tabs: [], active: null }),
    patchConversation: vi.fn().mockResolvedValue(undefined), patchProject: vi.fn().mockResolvedValue(undefined),
    saveTabs: vi.fn().mockResolvedValue(undefined), persistTabsToDaemonNow: vi.fn().mockResolvedValue(undefined) };
});
vi.mock('../../src/components/AppChromeHeader', () => ({ AppChromeHeader: () => null, APP_CHROME_FILE_ACTIONS_ID: 'test-file-actions' }));
vi.mock('../../src/components/ChatPane', async () => {
  const actual = await vi.importActual<typeof import('../../src/components/ChatPane')>('../../src/components/ChatPane');
  return { ...actual, ChatPane: (props: ComponentProps<typeof actual.ChatPane>) => {
    // Observe the pre-fold boundary without replacing any real rendering or
    // callbacks. Physical predecessors need not have separate on-screen shells.
    observedChat.messages = props.messages;
    return <actual.ChatPane {...props} />;
  } };
});
// The real ProjectView, ChatPane, AssistantMessage and execution/error cards stay wired.
// Only the unrelated editor/viewer surfaces are replaced.
vi.mock('../../src/components/ChatComposer', () => ({
  ChatComposer: forwardRef((_props, _ref) => <div data-testid="composer" />),
}));
vi.mock('../../src/components/FileWorkspace', () => ({ FileWorkspace: ({ files }: { files: ProjectFile[] }) =>
  <output data-testid="recovered-files">{files.map((file) => file.name).join(',')}</output> }));
vi.mock('../../src/components/workspace/TerminalViewer', () => ({ TerminalViewer: () => null }));
const config: AppConfig = { mode: 'daemon', apiProtocol: 'openai', apiKey: '', baseUrl: '', model: '',
  agentId: 'opencode', skillId: null, };
const RESULT: ProjectFile = { name: 'result.html', path: 'result.html', kind: 'html',
  mime: 'text/html', size: 132, mtime: 2000 };
let sequence = 0;
let project: Project;
let histories: Map<string, ChatMessage[]>;
let proofs: Map<string, ChatRunStatusResponse>;
let proofHttpStatus: number | 'network';
let proofGate: Promise<void> | null;
let releaseProof: () => void = () => {};
let reads: string[];
let pendingProofReads: string[];
let unexpectedWrites: string[];

const conversationId = () => `conversation-${project.id}`;
const runId = () => `run-${project.id}`;
const assistantId = () => `assistant-${project.id}`;
const historyKey = (conversation = conversationId()) => conversation;

function runProof(overrides: Partial<ChatRunStatusResponse> = {}): ChatRunStatusResponse {
  return { id: runId(), projectId: project.id, conversationId: conversationId(),
    assistantMessageId: assistantId(), agentId: 'opencode', status: 'succeeded',
    createdAt: 1000, updatedAt: 2000, terminalAt: 2000, artifactCount: 1,
    artifactPaths: [RESULT.name], deliverableValid: false, deliverableValidation: 'no_artifact', ...overrides };
}

function persistedAssistant(overrides: Partial<ChatMessage> = {}): ChatMessage {
  const content = 'Persisted result for this conversation.';
  return { id: assistantId(), role: 'assistant', content, createdAt: 1000, startedAt: 1000,
    endedAt: 2000, runId: runId(), runStatus: 'succeeded', resultDeliveryState: 'delivered',
    agentId: 'opencode', producedFiles: [RESULT], preTurnFileNames: [],
    events: [{ kind: 'thinking', text: 'Checking the requested result.' }, { kind: 'text', text: content }],
    ...overrides };
}

function setHistory(message: ChatMessage, conversation = conversationId()) {
  histories.set(historyKey(conversation), [
    { id: `user-${conversation}`, role: 'user', content: 'Create the requested result.', createdAt: 900 },
    message,
  ]);
}

function view(overrides: Partial<ComponentProps<typeof ProjectView>> = {}) {
  return <I18nProvider initial="en"><ProjectView project={project}
    initialProjectDetail={{ project, resolvedDir: '/workspace/history-verdict-fixture' }}
    routeConversationId={conversationId()} routeFileName={null} config={config}

    agents={[{ id: 'opencode', name: 'OpenCode', bin: 'opencode', available: true, models: [] }]}
    skills={[]} designTemplates={[]} daemonLive
    onModeChange={vi.fn()} onAgentChange={vi.fn()} onAgentModelChange={vi.fn()}
    onRefreshAgents={vi.fn()} onOpenSettings={vi.fn()} onBack={vi.fn()}
    onClearPendingPrompt={vi.fn()} onTouchProject={vi.fn()} onProjectChange={vi.fn()}
    onProjectsRefresh={vi.fn()} {...overrides} /></I18nProvider>;
}

function messageElement(id = assistantId()) {
  const element = document.querySelector(`[data-assistant-message-id="${id}"]`);
  expect(element).not.toBeNull();
  return element as HTMLElement;
}

async function expectDisplayedStatus(label: string, id = assistantId()) {
  // The footer also says Done. Inspect the actual execution record heading,
  // not a whole-message text query that conflates the two status surfaces.
  await waitFor(() => {
    const flow = within(messageElement(id)).getByTestId('assistant-flow');
    // A canceled/open record also mounts nested Thoughts foldables. Its
    // top-level execution summary is the status, not those child headings.
    const headings = flow.querySelectorAll(':scope > details > summary > [data-testid="chat-foldable-summary-content"]');
    expect(headings.length).toBe(1);
    expect(headings[0]?.textContent).toBe(label);
  });
}

// Approved ChatPanel copy (#8140) gives the reason-specific and generic cards
// the same title and description, so the visible text alone no longer tells
// which failure was restored. Read the error code the real ChatPane receives:
// it is what selects that card.
function errorCodesOnAssistant(id = assistantId()) {
  const message = observedChat.messages.find((candidate) => candidate.id === id);
  expect(message).toBeDefined();
  return (message?.events ?? []).flatMap((event) =>
    event.kind === 'status' && event.label === 'error' ? [event.code ?? null] : []);
}

async function expectDoneWithoutCard(id = assistantId()) {
  await expectDisplayedStatus(en['chat.record.done'], id);
  expect(errorCodesOnAssistant(id)).toEqual([]);
  expect(screen.queryByTestId('chat-run-error-card')).toBeNull();
  expect(screen.queryByTestId('chat-error-retry')).toBeNull();
  expect(screen.queryByTestId('chat-error-switch-to-cloud')).toBeNull();
  expect(screen.getByTestId('recovered-files').textContent).toContain(RESULT.name);
}

beforeEach(() => {
  vi.clearAllMocks(); window.localStorage.clear(); window.sessionStorage.clear();
  observedChat.messages = [];
  observedChat.proofCompletions = [];
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  // Decorative artifact shimmer is not part of this status/hydration test.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  project = { id: `history-verdict-${++sequence}`, name: 'History verdict',
     skillId: null, metadata: { kind: 'prototype' },
    createdAt: 1000, updatedAt: 2000 };
  histories = new Map(); proofs = new Map([[runId(), runProof()]]);
  proofHttpStatus = 200; proofGate = null; releaseProof = () => {};
  reads = []; pendingProofReads = []; unexpectedWrites = [];
  setHistory(persistedAssistant());
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost');
    const method = init?.method ?? 'GET';
    if (url.pathname === `/api/projects/${project.id}/conversations`) {
      return Response.json({ conversations: [...histories.keys()]
        .map((id) => ({ id, projectId: project.id, title: null, sessionMode: 'design', createdAt: 1000, updatedAt: 2000 })) });
    }
    const messagesMatch = url.pathname.match(/\/conversations\/([^/]+)\/messages$/);
    if (messagesMatch && method === 'GET') {
      const key = historyKey(decodeURIComponent(messagesMatch[1]!));
      reads.push(key);
      return Response.json({ messages: histories.get(key) ?? [] });
    }
    if (url.pathname.startsWith('/api/runs/') && method === 'GET') {
      // Capture at request time so switching identity/conversation cannot turn
      // the old response into the new principal's proof inside this fixture.
      const proof = structuredClone(proofs.get(decodeURIComponent(url.pathname.slice('/api/runs/'.length))));
      const status = proofHttpStatus;
      const gate = proofGate;
      if (gate) {
        pendingProofReads.push(proof?.id ?? 'missing-run');
        await gate;
      }
      if (status === 'network') throw new TypeError('Network unavailable');
      return Response.json(status === 200 && proof ? proof : { error: 'Run unavailable' },
        { status: status === 200 && !proof ? 404 : status });
    }
    if (url.pathname === `/api/projects/${project.id}/files` && method === 'GET') return Response.json({ files: [RESULT] });
    if (url.pathname === `/api/projects/${project.id}`) return Response.json({ project, resolvedDir: '/workspace/history-verdict-fixture' });
    if (method !== 'GET' && (url.pathname.includes('/messages/') || url.pathname.endsWith('/files') || url.pathname === '/api/chat')) {
      unexpectedWrites.push(`${method} ${url.pathname}`);
      // An attempted metadata write must not masquerade as daemon acceptance
      // of a client logical failure over its physical succeeded row.
      return Response.json({ error: 'Cold history fixture is read-only' }, { status: 409 });
    }
    return Response.json({});
  }));
});

afterEach(() => {
  cleanup(); releaseProof(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  window.localStorage.clear(); window.sessionStorage.clear();
});

describe('ordinary history hydration through real ProjectView and ChatPane', () => {
  it('keeps the succeeded Run Done without a card after cold load and a second fresh mount', async () => {
    const original = structuredClone(histories.get(historyKey()));
    const mounted = render(view());
    await expectDoneWithoutCard();
    mounted.unmount();
    const previousReads = reads.length;
    render(view());
    await waitFor(() => expect(reads.length).toBeGreaterThan(previousReads));
    await expectDoneWithoutCard();
    expect(histories.get(historyKey())).toEqual(original);
    expect(unexpectedWrites).toEqual([]);
    expect(streamViaDaemon).not.toHaveBeenCalled();
    expect(reattachDaemonRun).not.toHaveBeenCalled();
  });

  it.each([
    ['succeeded', 'chat.record.done'], ['canceled', 'chat.record.canceled'], ['failed', 'chat.record.failedTurn'],
  ] as const)('preserves ordinary physical %s history without a strategy task', async (status, label) => {
    setHistory(persistedAssistant({ runStatus: status, }));
    proofs.set(runId(), runProof({ status, }));
    render(view());
    await expectDisplayedStatus(en[label]);
    expect(errorCodesOnAssistant()).toEqual([]);
  });
});
