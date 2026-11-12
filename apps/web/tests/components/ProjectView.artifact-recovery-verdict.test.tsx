// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectView } from '../../src/components/ProjectView';
import { AssistantMessage } from '../../src/components/AssistantMessage';
import { I18nProvider } from '../../src/i18n';
import type { AppConfig, ChatMessage, Project, ProjectFile } from '../../src/types';

vi.mock('../../src/router', () => ({ navigate: vi.fn(), registerNavigationGuard: vi.fn(() => () => {}) }));
vi.mock('../../src/providers/anthropic', () => ({ streamMessage: vi.fn() }));
vi.mock('../../src/providers/daemon', async () => {
  const actual = await vi.importActual<typeof import('../../src/providers/daemon')>('../../src/providers/daemon');
  return { ...actual, fetchAmrWalletSnapshot: vi.fn().mockResolvedValue(null),
    listActiveChatRuns: vi.fn().mockResolvedValue([]), listProjectRuns: vi.fn().mockResolvedValue([]),
    publishDaemonRunFinishedEvent: vi.fn() };
});
vi.mock('../../src/providers/project-events', () => ({ useProjectFileEvents: vi.fn() }));
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
    patchConversation: vi.fn(), patchProject: vi.fn(), saveTabs: vi.fn() };
});
vi.mock('../../src/components/AppChromeHeader', () => ({ AppChromeHeader: () => null, APP_CHROME_FILE_ACTIONS_ID: 'test-file-actions' }));
// The adapter does not manufacture a status label: the actual message renderer
// and execution shell consume exactly the messages supplied by ProjectView.
vi.mock('../../src/components/ChatPane', () => ({
  ChatPane: ({ messages }: { messages: ChatMessage[] }) => <section>
    {messages.filter((message) => message.role === 'assistant').map((message) =>
      <AssistantMessage key={message.id} message={message} streaming={false} isLast
        projectId={project.id} conversationId={`conv-${project.id}`} />)}
  </section>,
}));
vi.mock('../../src/components/FileWorkspace', () => ({ FileWorkspace: ({ files }: { files: ProjectFile[] }) =>
  <output data-testid="recovered-files">{files.map((file) => file.name).join(',')}</output> }));
vi.mock('../../src/components/workspace/TerminalViewer', () => ({ TerminalViewer: () => null }));

const HTML = '<!doctype html><html><body><h1>Recovered result</h1></body></html>';
const ARTIFACT = `<artifact identifier="result" type="text/html" title="Result">${HTML}</artifact>`;
const config: AppConfig = { mode: 'daemon', apiProtocol: 'openai', apiKey: '', baseUrl: '', model: '',
  agentId: 'opencode', skillId: null, };
let sequence = 0;
let project: Project;
let history: ChatMessage[];
let files: ProjectFile[];
let savedHtml: string | null;
let releaseWrite: () => void;
let writeGate: Promise<void>;
let writeStarted: boolean;
let messageWrites: ChatMessage[];

beforeEach(() => {
  vi.clearAllMocks(); window.localStorage.clear(); window.sessionStorage.clear();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  project = { id: `artifact-verdict-${++sequence}`, name: 'Artifact verdict',
    skillId: null, metadata: { kind: 'prototype' }, createdAt: 1000, updatedAt: 2000 };
  files = []; savedHtml = null; writeStarted = false; messageWrites = []; history = [];
  writeGate = new Promise<void>((resolve) => { releaseWrite = resolve; });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost');
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (url.pathname === `/api/projects/${project.id}/conversations`) return Response.json({ conversations: [
      { id: `conv-${project.id}`, projectId: project.id, title: null, sessionMode: 'design', createdAt: 1000, updatedAt: 2000 },
    ] });
    if (url.pathname.endsWith('/messages') && method === 'GET') return Response.json({ messages: history });
    if (url.pathname.includes('/messages/') && method === 'PUT') {
      const message = structuredClone(body) as ChatMessage;
      messageWrites.push(message);
      history = history.map((previous) => previous.id === message.id ? message : previous);
      return Response.json({ message });
    }
    if (url.pathname === `/api/runs/run-${project.id}`) return Response.json({ runId: `run-${project.id}`,
      status: 'succeeded', createdAt: 1000, updatedAt: 2000, artifactCount: 0, artifactPaths: [],
      deliverableValid: true });
    if (url.pathname === `/api/projects/${project.id}/files`) {
      if (method === 'POST') {
        expect(body.name).toBe('result.html'); expect(body.content).toBe(HTML);
        writeStarted = true;
        await writeGate;
        const file: ProjectFile = { name: body.name, path: body.name, kind: 'html', mime: 'text/html',
          size: new TextEncoder().encode(body.content).length, mtime: 2000,
          ...(body.artifactManifest ? { artifactManifest: body.artifactManifest } : {}) };
        savedHtml = body.content; files = [file];
        return Response.json({ file });
      }
      return Response.json({ files });
    }
    if (url.pathname === `/api/projects/${project.id}`) return Response.json({ project, resolvedDir: '/workspace/verdict-fixture' });
    return Response.json({});
  }));
});
afterEach(() => { releaseWrite(); cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  window.localStorage.clear(); window.sessionStorage.clear(); });

async function recover() {
  // This is a recovery-input fixture, not a claim that all daemon message PUTs
  // preserve a client's status. Test actual outgoing PUT separately below.
  history = [{ id: `assistant-${project.id}`, role: 'assistant', content: ARTIFACT,
    createdAt: 1000, startedAt: 1000, endedAt: 2000, runId: `run-${project.id}`, runStatus: 'failed',
    resultDeliveryState: 'delivery_failed', preTurnFileNames: [],
    events: [{ kind: 'thinking', text: 'Preparing the requested output.' }, { kind: 'text', text: ARTIFACT }] }];
  render(<I18nProvider initial="en"><ProjectView project={project}
    initialProjectDetail={{ project, resolvedDir: '/workspace/verdict-fixture' }}
    routeConversationId={`conv-${project.id}`} routeFileName={null} config={config}
    agents={[{ id: 'opencode', name: 'OpenCode', bin: 'opencode', available: true, models: [] }]}
    skills={[]} designTemplates={[]} daemonLive onModeChange={vi.fn()} onAgentChange={vi.fn()}
    onAgentModelChange={vi.fn()} onRefreshAgents={vi.fn()} onOpenSettings={vi.fn()} onBack={vi.fn()}
    onClearPendingPrompt={vi.fn()} onTouchProject={vi.fn()} onProjectChange={vi.fn()} onProjectsRefresh={vi.fn()} />
  </I18nProvider>);
  // Real clocks preserve the pending HTTP / committed UI ordering. No polling
  // interval or retry duration is under test; the POST gate is the completion signal.
  await waitFor(() => expect(writeStarted).toBe(true));
  expect(screen.getAllByText('Run failed').length).toBeGreaterThan(0);
  expect(savedHtml).toBeNull();
  await act(async () => { releaseWrite(); });
  await waitFor(() => expect(messageWrites.some((message) => message.producedFiles?.some((file) => file.name === 'result.html'))).toBe(true));
  expect(savedHtml).toBe(HTML);
  expect(screen.getByTestId('recovered-files').textContent).toContain('result.html');
  return messageWrites.filter((message) => message.producedFiles?.some((file) => file.name === 'result.html')).at(-1)!;
}

describe('ordinary artifact recovery', () => {
  it('settles delivery only after saving the inline artifact and preserves physical success', async () => {
    const message = await recover();
    expect(message.runStatus).toBe('succeeded');
    expect(message.resultDeliveryState).toBe('delivered');
    await waitFor(() => expect(screen.queryByText('Run failed')).toBeNull());
  });
});
