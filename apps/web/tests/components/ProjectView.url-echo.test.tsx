// @vitest-environment jsdom

// ProjectView writes the URL from what the panel shows, and a URL change comes
// back to it as a new `routeFileName`. These cases run the real ProjectView and
// FileWorkspace together, because the bug lives in the loop between them: the
// panel must not take its own URL write for a request to open a file.

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState, type ComponentProps, type ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectView } from '../../src/components/ProjectView';
import { navigate, type Route } from '../../src/router';
import type { AgentInfo, AppConfig, Conversation, Project, ProjectFile, SkillSummary } from '../../src/types';
import { createConversation, listConversations, listMessages, loadTabs } from '../../src/state/projects';
import { useProjectFileEvents } from '../../src/providers/project-events';
import { fetchProjectFiles } from '../../src/providers/registry';

// The panel's open request as React would hold it: a click is a discrete event
// and renders first, so a request set by an earlier effect can still be waiting
// when the next click lands. A test closes the gate to park requests there.
const openRequestGate = vi.hoisted(() => ({
  closed: false,
  release: null as null | (() => void),
}));

vi.mock('../../src/components/FileWorkspace', async () => {
  const actual = await vi.importActual<typeof import('../../src/components/FileWorkspace')>(
    '../../src/components/FileWorkspace',
  );
  const Real = actual.FileWorkspace;
  return {
    ...actual,
    FileWorkspace: (props: ComponentProps<typeof Real>) => {
      const [delivered, setDelivered] = useState(props.openRequest ?? null);
      if (!openRequestGate.closed && delivered !== (props.openRequest ?? null)) {
        setDelivered(props.openRequest ?? null);
      }
      openRequestGate.release = () => setDelivered(props.openRequest ?? null);
      return <Real {...props} openRequest={delivered} />;
    },
  };
});

vi.mock('../../src/router', async () => ({
  ...(await vi.importActual<typeof import('../../src/router')>('../../src/router')),
  navigate: vi.fn(),
}));

vi.mock('../../src/providers/anthropic', () => ({ streamMessage: vi.fn() }));
vi.mock('../../src/providers/daemon', () => ({
  fetchChatRunStatus: vi.fn(),
  listActiveChatRuns: vi.fn().mockResolvedValue([]),
  listProjectRuns: vi.fn().mockResolvedValue([]),
  publishDaemonRunFinishedEvent: vi.fn(),
  reattachDaemonRun: vi.fn(),
  streamViaDaemon: vi.fn(),
}));
vi.mock('../../src/providers/project-events', () => ({ useProjectFileEvents: vi.fn() }));
vi.mock('../../src/providers/registry', async () => ({
  ...(await vi.importActual<typeof import('../../src/providers/registry')>('../../src/providers/registry')),
  fetchProjectFiles: vi.fn(),
  fetchProjectFolders: vi.fn().mockResolvedValue([]),
  fetchSkill: vi.fn(),
  getTemplate: vi.fn(),
}));
vi.mock('../../src/state/projects', async () => ({
  ...(await vi.importActual<typeof import('../../src/state/projects')>('../../src/state/projects')),
  cacheTabsLocally: vi.fn((_projectId: string, state: { tabs: string[]; active: string | null }) => state),
  createConversation: vi.fn(),
  listConversations: vi.fn(),
  listMessages: vi.fn(),
  loadTabs: vi.fn(),
  patchConversation: vi.fn(),
  patchProject: vi.fn(),
  persistTabsToDaemonNow: vi.fn(),
  saveMessage: vi.fn(),
  saveTabs: vi.fn(),
}));

vi.mock('../../src/components/AppChromeHeader', async () => ({
  ...(await vi.importActual<typeof import('../../src/components/AppChromeHeader')>('../../src/components/AppChromeHeader')),
  AppChromeHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
}));
vi.mock('../../src/components/Loading', () => ({ CenteredLoader: () => <div data-testid="loader" /> }));
vi.mock('../../src/components/ChatPane', () => ({
  ChatPane: ({ onRequestOpenFile }: { onRequestOpenFile?: (name: string) => void }) => (
    <button type="button" onClick={() => onRequestOpenFile?.('keep-me.png')}>file link to keep-me.png</button>
  ),
}));
vi.mock('../../src/components/game/EngineBadge', () => ({ EngineBadge: () => null }));
vi.mock('../../src/components/tuning/tuning-api', async () => ({
  ...(await vi.importActual<typeof import('../../src/components/tuning/tuning-api')>('../../src/components/tuning/tuning-api')),
  listGameTuning: vi.fn(async () => ({ parameters: [], warnings: [] })),
}));
vi.mock('../../src/components/GameAssetsPanel', () => ({ GameAssetsPanel: () => <div>Asset gallery</div> }));
vi.mock('../../src/components/studio/StudioPanel', () => ({ StudioPanel: () => <div>Studio</div> }));
vi.mock('../../src/components/ProjectExtensionsPanel', () => ({ ProjectExtensionsPanel: () => <div>Extensions</div> }));

const config: AppConfig = { mode: 'api', apiKey: '', baseUrl: '', model: '', agentId: null, skillId: null };
const project: Project = { id: 'project-1', name: 'Project 1', skillId: null, createdAt: 1, updatedAt: 1 };
const conversation: Conversation = { id: 'conv-1', projectId: project.id, title: null, createdAt: 1, updatedAt: 1 };

function imageFile(name: string): ProjectFile {
  return { name, path: name, type: 'file', size: 1, mtime: 1, mime: 'image/png', kind: 'image' };
}

// `navigate` publishes the route synchronously, as `useRoute` does in the app,
// so the URL ProjectView writes comes straight back as its `routeFileName`.
let setRouteFile: (name: string | null) => void = () => undefined;
function RoutedProjectView({ initialFile = null }: { initialFile?: string | null }) {
  const [routeFileName, setRouteFileName] = useState(initialFile);
  setRouteFile = setRouteFileName;
  return (
    <ProjectView
      project={project}
      routeFileName={routeFileName}
      routeConversationId={null}
      config={config}
      agents={[] as AgentInfo[]}
      skills={[] as SkillSummary[]}
      designTemplates={[] as SkillSummary[]}
      daemonLive
      onModeChange={vi.fn()}
      onAgentChange={vi.fn()}
      onAgentModelChange={vi.fn()}
      onRefreshAgents={vi.fn()}
      onOpenSettings={vi.fn()}
      onBack={vi.fn()}
      onClearPendingPrompt={vi.fn()}
      onTouchProject={vi.fn()}
      onProjectChange={vi.fn()}
      onProjectsRefresh={vi.fn()}
    />
  );
}

const stackLabel = () => screen.getByTestId('panel-stack-label').textContent;
const stackBar = () => screen.getByTestId('panel-stack-bar');
const clickBack = () => fireEvent.click(screen.getByTestId('panel-stack-back'));

/** A file URL the user went to (deep link, back/forward), landing in 资源库. */
async function goToFileUrl(name: string) {
  act(() => setRouteFile(name));
  await waitFor(() => expect(stackLabel()).toBe(name));
}

async function renderWithBothFilesOnTheStack() {
  render(<RoutedProjectView />);
  await screen.findByRole('button', { name: 'file link to keep-me.png' });
  await goToFileUrl('keep-me.png');
  await goToFileUrl('second.png');
}

describe('ProjectView URL echo', () => {
  beforeAll(() => {
    globalThis.ResizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    };
  });

  beforeEach(() => {
    openRequestGate.closed = false;
    openRequestGate.release = null;
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({})));
    vi.mocked(listConversations).mockResolvedValue([conversation]);
    vi.mocked(createConversation).mockResolvedValue(conversation);
    vi.mocked(listMessages).mockResolvedValue([]);
    vi.mocked(loadTabs).mockResolvedValue({ tabs: [], active: null, hasSavedState: true });
    vi.mocked(fetchProjectFiles).mockResolvedValue([imageFile('keep-me.png'), imageFile('second.png')]);
    vi.mocked(navigate).mockImplementation((route: Route) => {
      if (route.kind === 'project') setRouteFile(route.fileName);
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('lands on the root when Back is clicked twice before the first URL write comes back', async () => {
    await renderWithBothFilesOnTheStack();

    openRequestGate.closed = true;
    clickBack();
    expect(stackLabel()).toBe('keep-me.png');
    // The URL now names keep-me.png; whatever that triggered is still in flight.
    await waitFor(() => expect(navigate).toHaveBeenLastCalledWith(
      expect.objectContaining({ fileName: 'keep-me.png' }), { replace: true },
    ));
    clickBack();
    expect(stackBar()).toHaveAttribute('hidden');

    openRequestGate.closed = false;
    act(() => openRequestGate.release?.());

    expect(stackBar()).toHaveAttribute('hidden');
    await waitFor(() => expect(navigate).toHaveBeenLastCalledWith(
      expect.objectContaining({ fileName: null }), { replace: true },
    ));
  });

  it('still opens a file URL the user goes to after leaving that file', async () => {
    await renderWithBothFilesOnTheStack();
    clickBack();
    clickBack();
    expect(stackBar()).toHaveAttribute('hidden');
    act(() => setRouteFile(null));

    await goToFileUrl('keep-me.png');

    expect(screen.getByRole('tab', { name: 'Files' })).toHaveAttribute('aria-selected', 'true');
  });

  it('still opens a file link to the file the user just left', async () => {
    await renderWithBothFilesOnTheStack();
    clickBack();
    clickBack();
    expect(stackBar()).toHaveAttribute('hidden');

    fireEvent.click(screen.getByRole('button', { name: 'file link to keep-me.png' }));

    await waitFor(() => expect(stackLabel()).toBe('keep-me.png'));
  });

  // With no saved tabs the default primary file is still unused when the user
  // leaves the file their URL opened, and it must stay unused.
  describe('with no saved tabs', () => {
    const newestFile = { ...imageFile('newest.png'), mtime: 2 };

    beforeEach(() => {
      // The panel remembers its view per project; start from the default one.
      window.localStorage.clear();
      vi.mocked(loadTabs).mockResolvedValue({ tabs: [], active: null });
    });

    it.each([
      { default: 'the file itself', files: [imageFile('only.png')] },
      { default: 'another file', files: [imageFile('only.png'), newestFile] },
    ])('stays on the root after Back from a file URL when the default is $default', async ({ files }) => {
      vi.mocked(fetchProjectFiles).mockResolvedValue(files);
      render(<RoutedProjectView initialFile="only.png" />);

      await waitFor(() => expect(stackLabel()).toBe('only.png'));
      await screen.findByRole('img', { name: 'only.png' });

      clickBack();

      expect(stackBar()).toHaveAttribute('hidden');
      expect(navigate).toHaveBeenLastCalledWith(
        expect.objectContaining({ fileName: null }), { replace: true },
      );
    });

    it('stays on the root when the file list refreshes after Back beat the saved tabs', async () => {
      let resolveTabs: (state: { tabs: string[]; active: string | null }) => void = () => undefined;
      vi.mocked(loadTabs).mockReturnValue(new Promise((resolve) => { resolveTabs = resolve; }));
      vi.mocked(fetchProjectFiles).mockImplementation(async () => [imageFile('only.png')]);
      render(<RoutedProjectView initialFile="only.png" />);
      await screen.findByRole('img', { name: 'only.png' });

      clickBack();
      await act(async () => resolveTabs({ tabs: [], active: null }));
      // The project event stream connecting is one thing that re-reads the list.
      const reads = vi.mocked(fetchProjectFiles).mock.calls.length;
      await act(async () => {
        vi.mocked(useProjectFileEvents).mock.lastCall?.[3]?.onReady?.();
        await vi.mocked(fetchProjectFiles).mock.results.at(-1)?.value;
      });

      expect(vi.mocked(fetchProjectFiles).mock.calls.length).toBeGreaterThan(reads);
      expect(stackBar()).toHaveAttribute('hidden');
    });

    it('still opens the default primary file on a first load with no file URL', async () => {
      vi.mocked(fetchProjectFiles).mockResolvedValue([imageFile('only.png')]);
      render(<RoutedProjectView />);

      // A host open waits on 资源库's stack without moving the view.
      fireEvent.click(await screen.findByRole('tab', { name: 'Files' }));

      await waitFor(() => expect(stackLabel()).toBe('only.png'));
    });
  });
});
