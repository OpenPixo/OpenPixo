// @vitest-environment jsdom

// 改动 view (specs/current/openpixo-game-panel.md §5, slice 3): 本轮 / 本会话
// lists from checkpoints, the badge, row → viewer, the unavailable state and
// the diff / before-after viewers.

import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, CheckpointFileChange, PersistedAgentEvent, ProjectCheckpoint } from '@openpixo/contracts';

import { ChangeDiffViewer } from '../../src/components/changes/ChangeDiffViewer';
import { sessionRows } from '../../src/components/changes/changes-model';
import { FileWorkspace } from '../../src/components/FileWorkspace';
import { ChangesView } from '../../src/components/panel/ChangesView';
import { changeDiffItem, parseChangeDiffItem, panelItemHomeView } from '../../src/components/panel/panel-nav';
import type { ProjectFile } from '../../src/types';

vi.mock('../../src/providers/registry', async () => ({
  ...(await vi.importActual<typeof import('../../src/providers/registry')>('../../src/providers/registry')),
  fetchProjectFileText: vi.fn().mockResolvedValue(''),
  fetchProjectFolders: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../src/components/tuning/tuning-api', async () => ({
  ...(await vi.importActual<typeof import('../../src/components/tuning/tuning-api')>('../../src/components/tuning/tuning-api')),
  listGameTuning: vi.fn(async () => ({ parameters: [], warnings: [] })),
}));
vi.mock('../../src/components/FileViewer', () => ({
  FileViewer: ({ file }: { file: ProjectFile }) => <div data-testid="file-viewer">{file.name}</div>,
}));
vi.mock('../../src/components/GameAssetsPanel', () => ({ GameAssetsPanel: () => <div>Asset gallery</div> }));
vi.mock('../../src/components/studio/StudioPanel', () => ({ StudioPanel: () => <div>Studio recipes</div> }));
vi.mock('../../src/components/ProjectExtensionsPanel', () => ({ ProjectExtensionsPanel: () => <div>Extensions form</div> }));

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

let sequence = 0;
function checkpoint(id: string, runId: string, conversationId: string, runChanges: CheckpointFileChange[] | null, minute: number): ProjectCheckpoint {
  return { id, runId, conversationId, createdAt: `2026-11-03T10:${String(minute).padStart(2, '0')}:00Z`, summary: runId, kind: 'run',
    changedFileCount: 0, runChanges, completedAt: runChanges ? `2026-11-03T10:${String(minute).padStart(2, '0')}:30Z` : null };
}
const generated = (path: string): PersistedAgentEvent[] => [
  { kind: 'tool_use', id: `g-${path}`, name: 'Bash', input: { command: 'pixo media generate --surface image --prompt hero' } },
  { kind: 'tool_result', toolUseId: `g-${path}`, content: JSON.stringify({ status: 'done', file: { name: path } }), isError: false },
];
function assistant(runId: string, events: PersistedAgentEvent[] = [], runStatus: ChatMessage['runStatus'] = 'succeeded'): ChatMessage {
  return { id: `m-${runId}`, role: 'assistant', content: '', runId, runStatus, events };
}

const RUN_1 = checkpoint('cp-run-1-aaaa', 'run-1', 'conv-1', [
  { path: 'scripts/player.gd', status: 'modified' }, { path: 'art/hero.png', status: 'added' }, { path: 'scenes/old.tscn', status: 'deleted' },
], 1);
const RUN_2 = checkpoint('cp-run-2-bbbb', 'run-2', 'conv-1', [
  { path: 'scripts/player.gd', status: 'modified' }, { path: 'scripts/enemy.gd', status: 'added' },
], 2);
const OTHER = checkpoint('cp-other-cccc', 'run-x', 'conv-2', [{ path: 'other.gd', status: 'modified' }], 3);

interface Api {
  list?: unknown;
  current?: () => CheckpointFileChange[];
  diff?: (url: string) => unknown;
}
function mockApi(api: Api) {
  const fetcher = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    if (/\/checkpoints$/u.test(url)) return Response.json(api.list ?? { status: 'available', busy: false, checkpoints: [RUN_2, RUN_1, OTHER] });
    if (url.includes('/diff')) return Response.json(api.diff?.(url) ?? { checkpointId: 'x', target: 'run_end', truncated: false, files: [] });
    const id = /\/checkpoints\/([^/?]+)$/u.exec(url)?.[1] ?? '';
    return Response.json({ checkpoint: { ...RUN_1, id }, currentChanges: api.current?.() ?? [], busy: false });
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

function scopeTab(name: string) { return screen.getByRole('tab', { name }); }
function rowPaths() {
  return within(screen.getByTestId('panel-changes-files')).getAllByRole('button').map((row) => row.getAttribute('title'));
}

describe('改动 view lists', () => {
  it('shows the latest run in 本轮 and the union of the conversation in 本会话', async () => {
    mockApi({});
    const projectId = `changes-${sequence++}`;
    render(<ChangesView projectId={projectId} hidden={false} conversationId="conv-1"
      messages={[assistant('run-1', generated('art/hero.png')), assistant('run-2')]} />);
    await waitFor(() => expect(rowPaths()).toEqual(['scripts/player.gd', 'scripts/enemy.gd']));
    expect(screen.queryByTestId('panel-changes-images')).toBeNull();
    fireEvent.click(scopeTab('This session'));
    expect(rowPaths()).toEqual(['art/hero.png', 'scenes/old.tscn', 'scripts/enemy.gd', 'scripts/player.gd']);
    const rows = within(screen.getByTestId('panel-changes-files')).getAllByRole('button');
    expect(rows.map((row) => row.querySelector('[data-status]')?.textContent)).toEqual(['A', 'D', 'A', 'M']);
    // Images: the chat gallery's rule over the session's messages.
    const strip = screen.getByTestId('panel-changes-images');
    expect(within(strip).getByRole('img')).toHaveAttribute('alt', 'art/hero.png');
  });

  it('nets a session path across runs and opens the latest run that touched it', () => {
    const added = checkpoint('cp-a-000001', 'run-a', 'c', [{ path: 'tmp.txt', status: 'added' }, { path: 'keep.txt', status: 'added' }], 1);
    const removed = checkpoint('cp-b-000002', 'run-b', 'c', [{ path: 'tmp.txt', status: 'deleted' }, { path: 'keep.txt', status: 'modified' }], 2);
    expect(sessionRows([removed, added], 'c', null)).toEqual([{ path: 'keep.txt', status: 'added', checkpointId: 'cp-b-000002' }]);
  });

  it('pushes a diff item for a row and for a changed image, with line counts from the diff endpoint', async () => {
    mockApi({ diff: () => ({ checkpointId: RUN_1.id, target: 'run_end', truncated: false, files: [
      { path: 'scripts/player.gd', status: 'modified', binary: false, truncated: false, additions: 3, deletions: 1, hunks: [] },
      { path: 'art/hero.png', status: 'added', binary: true, truncated: false, additions: null, deletions: null, hunks: [] },
      { path: 'scenes/old.tscn', status: 'deleted', binary: false, truncated: false, additions: 0, deletions: 1, hunks: [] },
    ] }) });
    const onOpenItem = vi.fn();
    render(<ChangesView projectId={`changes-${sequence++}`} hidden={false} conversationId="conv-1"
      messages={[assistant('run-1', generated('art/hero.png'))]} onOpenItem={onOpenItem} />);
    expect(await screen.findByLabelText('3 lines added, 1 removed')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('scripts/player.gd'));
    expect(onOpenItem).toHaveBeenLastCalledWith(changeDiffItem(RUN_1.id, 'scripts/player.gd'));
    fireEvent.click(within(screen.getByTestId('panel-changes-images')).getByRole('button'));
    expect(onOpenItem).toHaveBeenLastCalledWith(changeDiffItem(RUN_1.id, 'art/hero.png'));
  });

  it('explains unavailable checkpoints and still shows images', async () => {
    mockApi({ list: { status: 'unavailable', reason: 'project_too_large', checkpoints: [] } });
    render(<ChangesView projectId={`changes-${sequence++}`} hidden={false} conversationId="conv-1"
      messages={[assistant('run-1', generated('art/hero.png'))]} />);
    const notice = await screen.findByTestId('panel-changes-unavailable');
    expect(notice).toHaveTextContent('too large to record automatically');
    expect(within(screen.getByTestId('panel-changes-images')).getByRole('img')).toBeInTheDocument();
    expect(screen.queryByTestId('panel-changes-files')).toBeNull();
    expect(screen.queryByTestId('panel-changes-undo')).toBeNull();
  });

  it('offers 撤销这一轮 through the existing restore confirmation', async () => {
    const fetcher = mockApi({ current: () => [{ path: 'scripts/player.gd', status: 'modified' }] });
    render(<ChangesView projectId={`changes-${sequence++}`} hidden={false} conversationId="conv-1" messages={[assistant('run-1')]} />);
    fireEvent.click(await screen.findByTestId('panel-changes-undo'));
    const popover = await screen.findByRole('dialog', { name: 'Restore this snapshot?' });
    expect(await within(popover).findByText('scripts/player.gd')).toBeInTheDocument();
    expect(fetcher.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toBe(false);
  });
});

describe('改动 badge', () => {
  it('counts paths of the running run not yet seen, clears when 改动 opens, and counts only new ones after', async () => {
    let current: CheckpointFileChange[] = [{ path: 'a.gd', status: 'modified' }, { path: 'b.gd', status: 'added' }];
    const running = checkpoint('cp-live-dddd', 'run-3', 'conv-1', null, 4);
    mockApi({ list: { status: 'available', busy: false, checkpoints: [running, RUN_1] }, current: () => current });
    const badge = vi.fn();
    const projectId = `changes-${sequence++}`;
    const props = { projectId, conversationId: 'conv-1', messages: [assistant('run-3', [], 'running')], runInFlight: true, onBadgeChange: badge };
    const { rerender } = render(<ChangesView {...props} hidden active={false} refreshKey={1} />);
    await waitFor(() => expect(badge).toHaveBeenLastCalledWith(2));
    rerender(<ChangesView {...props} hidden={false} active refreshKey={1} />);
    await waitFor(() => expect(badge).toHaveBeenLastCalledWith(0));
    rerender(<ChangesView {...props} hidden active={false} refreshKey={1} />);
    expect(badge).toHaveBeenLastCalledWith(0);
    current = [...current, { path: 'c.gd', status: 'added' }];
    rerender(<ChangesView {...props} hidden active={false} refreshKey={2} />);
    await waitFor(() => expect(badge).toHaveBeenLastCalledWith(1), { timeout: 3_000 });
  });

  it('does not badge a run that had already finished when the view first saw it', async () => {
    mockApi({});
    const badge = vi.fn();
    render(<ChangesView projectId={`changes-${sequence++}`} hidden active={false} conversationId="conv-1"
      messages={[assistant('run-2')]} onBadgeChange={badge} />);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(badge.mock.calls.every(([count]) => count === 0)).toBe(true);
  });
});

describe('change viewers', () => {
  it('renders a text diff with line numbers', async () => {
    mockApi({ diff: () => ({ checkpointId: 'cp', target: 'run_end', path: 'scripts/player.gd', status: 'modified', binary: false, truncated: false,
      additions: 1, deletions: 1, hunks: [{ header: '@@ -10,3 +10,3 @@', lines: [
        { kind: 'context', text: 'var speed = 10' }, { kind: 'del', text: 'var jump = 4' }, { kind: 'add', text: 'var jump = 9' },
      ] }] }) });
    render(<ChangeDiffViewer projectId="p" checkpointId="cp-1234567890" path="scripts/player.gd" />);
    const table = await screen.findByTestId('change-diff-table');
    const rows = within(table).getAllByRole('row').slice(1).map((row) => Array.from(row.querySelectorAll('td')).map((cell) => cell.textContent));
    expect(rows).toEqual([['10', '10', ' ', 'var speed = 10'], ['11', '', '−', 'var jump = 4'], ['', '11', '+', 'var jump = 9']]);
    expect(screen.queryByText(/Compared with the current files/u)).toBeNull();
  });

  it('shows both checkpoint versions of a changed image', async () => {
    mockApi({ diff: () => ({ checkpointId: 'cp', target: 'run_end', path: 'art/hero.png', status: 'modified', binary: true, truncated: false,
      additions: null, deletions: null, hunks: [] }) });
    render(<ChangeDiffViewer projectId="p" checkpointId="cp-1234567890" path="art/hero.png" />);
    const before = await screen.findByAltText('art/hero.png · Before');
    expect(before).toHaveAttribute('src', '/api/projects/p/checkpoints/cp-1234567890/file?path=art%2Fhero.png&side=before');
    expect(screen.getByAltText('art/hero.png · After')).toHaveAttribute('src', '/api/projects/p/checkpoints/cp-1234567890/file?path=art%2Fhero.png&side=after');
  });

  it('says when the other side is the current files', async () => {
    mockApi({ diff: () => ({ checkpointId: 'cp', target: 'working_tree', path: 'a.png', status: 'added', binary: true, truncated: false,
      additions: null, deletions: null, hunks: [] }) });
    render(<ChangeDiffViewer projectId="p" checkpointId="cp-1234567890" path="a.png" />);
    expect(await screen.findByText(/Compared with the current files/u)).toBeInTheDocument();
    expect(screen.getByText('New in this turn')).toBeInTheDocument();
  });
});

describe('改动 inside the panel', () => {
  it('a row pushes the diff viewer onto 改动 with ← back, and the badge never moves the panel', async () => {
    mockApi({ diff: (url) => (url.includes('path=') ? { checkpointId: RUN_2.id, target: 'run_end', path: 'scripts/enemy.gd', status: 'added',
      binary: false, truncated: false, additions: 1, deletions: 0, hunks: [{ header: '@@ -0,0 +1 @@', lines: [{ kind: 'add', text: 'extends Node' }] }] }
      : { checkpointId: RUN_2.id, target: 'run_end', truncated: false, files: [] }) });
    render(<FileWorkspace projectId={`changes-${sequence++}`} projectKind="prototype" files={[]} onRefreshFiles={vi.fn()}
      tabsState={{ tabs: [], active: null }} onTabsStateChange={vi.fn()} conversationId="conv-1" messages={[assistant('run-2')]} />);
    const viewTab = screen.getByRole('tab', { name: /Changes/u });
    expect(viewTab).toHaveAttribute('aria-selected', 'false');
    fireEvent.click(viewTab);
    fireEvent.click(await screen.findByTitle('scripts/enemy.gd'));
    const viewer = await screen.findByTestId('change-diff-viewer');
    expect(viewer).toHaveAttribute('data-path', 'scripts/enemy.gd');
    expect(await within(viewer).findByText('extends Node')).toBeInTheDocument();
    expect(screen.getByTestId('panel-stack-label').textContent).toBe('enemy.gd');
    fireEvent.keyDown(screen.getByTestId('panel-stack-back'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('change-diff-viewer')).toBeNull());
    expect(screen.getByTestId('panel-changes-view')).toBeVisible();
  });

  it('routes restored diff items back to 改动', () => {
    const item = changeDiffItem('cp-1234567890', 'art/a:b.png');
    expect(parseChangeDiffItem(item)).toEqual({ checkpointId: 'cp-1234567890', path: 'art/a:b.png' });
    expect(panelItemHomeView(item)).toBe('changes');
    expect(panelItemHomeView('art/a.png')).toBe('library');
    expect(parseChangeDiffItem('diff:')).toBeNull();
  });
});
