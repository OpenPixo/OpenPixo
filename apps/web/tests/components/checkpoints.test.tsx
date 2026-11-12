// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectCheckpoint } from '@openpixo/contracts';
import { I18nProvider } from '../../src/i18n';
import { ProjectCheckpointHistory } from '../../src/components/checkpoints/ProjectCheckpointHistory';
import { TuningPanel } from '../../src/components/tuning/TuningPanel';
import { RunCheckpointUndo } from '../../src/components/chat/RunCheckpointUndo';

const checkpoint: ProjectCheckpoint = { id: 'checkpoint-1', runId: 'run-1', conversationId: 'conversation-1', createdAt: '2026-10-30T12:00:00Z',
  kind: 'run', summary: 'Make jumping easier', changedFileCount: 1, runChanges: [{ path: 'game.ts', status: 'modified' }], completedAt: '2026-10-30T12:01:00Z' };
let projectId: string;
let sequence = 0;
beforeEach(() => { projectId = `t2-ui-${sequence++}`; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

function mockApi(initiallyAvailable = true) {
  let available = initiallyAvailable;
  let busy = false;
  const posts: string[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'POST') {
      posts.push(url);
      expect(JSON.parse(String(init.body))).toEqual({ confirmed: true });
      if (url.endsWith('/enable')) available = true;
      return new Response(JSON.stringify(url.endsWith('/enable') ? { status: 'available', checkpoints: [], busy: false }
        : { checkpoint, backupCheckpoint: { ...checkpoint, id: 'backup', kind: 'before_restore' }, restoredFiles: [] }));
    }
    if (url.endsWith('/checkpoints')) return new Response(JSON.stringify(available
      ? { status: 'available', checkpoints: initiallyAvailable ? [checkpoint] : [], busy }
      : { status: 'unavailable', reason: 'not_git', checkpoints: [] }));
    return new Response(JSON.stringify({ checkpoint, busy, currentChanges: [
      { path: 'game.ts', status: 'modified' }, { path: 'later edit.ts', status: 'added' },
    ] }));
  });
  vi.stubGlobal('fetch', fetcher);
  return { fetcher, posts, setBusy(value: boolean) { busy = value; } };
}

describe('project snapshot UI', () => {
  it('lists current affected files and requires confirmation before undoing a run', async () => {
    const api = mockApi();
    render(<RunCheckpointUndo projectId={projectId} runId="run-1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Undo this run’s changes' }));
    const popover = await screen.findByRole('dialog', { name: 'Restore this snapshot?' });
    expect(await within(popover).findByText('later edit.ts')).toBeTruthy();
    expect(within(popover).getByText('game.ts')).toBeTruthy();
    expect(api.posts).toEqual([]);
    fireEvent.click(within(popover).getByRole('button', { name: 'Restore snapshot' }));
    await waitFor(() => expect(api.posts).toEqual([`/api/projects/${projectId}/checkpoints/checkpoint-1/restore`]));
    expect(await screen.findByRole('status')).toHaveTextContent('Snapshot restored');
  });

  it('shows unavailable non-git protection and initializes only after explicit confirmation', async () => {
    const api = mockApi(false);
    render(<ProjectCheckpointHistory projectId={projectId} />);
    fireEvent.click(screen.getByRole('button', { name: 'Snapshot history' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Enable version protection' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Enable version protection?' });
    expect(api.posts).toEqual([]);
    fireEvent.click(within(confirm).getByRole('button', { name: 'Enable version protection' }));
    await screen.findByText('Snapshots will appear here after the next agent run.');
    expect(api.posts).toEqual([`/api/projects/${projectId}/checkpoints/enable`]);
  });

  it('opens any historical snapshot for review before restoring it', async () => {
    const api = mockApi();
    render(<ProjectCheckpointHistory projectId={projectId} />);
    fireEvent.click(screen.getByRole('button', { name: 'Snapshot history' }));
    expect(await screen.findByText('Make jumping easier')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Restore snapshot' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Restore this snapshot?' });
    expect(await within(confirm).findByText('later edit.ts')).toBeTruthy();
    expect(api.posts).toEqual([]);
  });

  it('keeps backend English errors out of the Chinese UI', async () => {
    const api = mockApi();
    api.fetcher.mockImplementation(async input => String(input).endsWith('/checkpoints')
      ? new Response(JSON.stringify({ status: 'available', checkpoints: [checkpoint], busy: false }))
      : new Response(JSON.stringify({ error: { code: 'CHECKPOINT_FAILED', message: 'Permission denied by raw backend' } }), { status: 500 }));
    render(<I18nProvider initial="zh-CN"><RunCheckpointUndo projectId={projectId} runId="run-1" /></I18nProvider>);
    fireEvent.click(await screen.findByRole('button', { name: '撤销这次运行的改动' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('快照操作未能完成，请重试。');
    expect(screen.queryByText(/Permission denied/)).toBeNull();
  });

  it('refreshes a busy run only when the polling deadline arrives', async () => {
    vi.useFakeTimers();
    const api = mockApi();
    api.setBusy(true);
    await act(async () => { render(<RunCheckpointUndo projectId={projectId} runId="run-1" />); });
    expect(screen.getByRole('button', { name: 'Undo this run’s changes' })).toBeDisabled();
    api.setBusy(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(999); });
    expect(screen.getByRole('button', { name: 'Undo this run’s changes' })).toBeDisabled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(screen.getByRole('button', { name: 'Undo this run’s changes' })).toBeEnabled();
  });
});

it.each(['undo', 'history'] as const)('refreshes the tuning panel after a real %s confirmation completes', async entry => {
  const api = mockApi();
  const checkpointRequest = api.fetcher.getMockImplementation()!;
  let value = 260;
  api.fetcher.mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith('/game/run')) return Response.json({ status: 'idle' });
    if (url.endsWith('/game/tuning')) return Response.json({ warnings: [], parameters: [{
      id: 'speed', key: 'speed', label: 'Move speed', group: 'Player', owner: 'Player', type: 'int', source: 'web-json',
      value, defaultValue: 220, literal: String(value), min: 0, max: 600, step: 10, filePath: 'src/tuning.json', line: 1, fileHash: 'a'.repeat(64),
    }] });
    const result = await checkpointRequest(input, init);
    if (url.endsWith('/restore') && init?.method === 'POST') value = 220;
    return result;
  });
  render(<I18nProvider initial="en"><TuningPanel projectId={projectId} onOpenFile={vi.fn()} />
    {entry === 'undo' ? <RunCheckpointUndo projectId={projectId} runId="run-1" /> : <ProjectCheckpointHistory projectId={projectId} />}
  </I18nProvider>);
  const slider = await screen.findByRole('slider', { name: 'Move speed' });
  expect(slider).toHaveValue('260');
  if (entry === 'undo') fireEvent.click(await screen.findByRole('button', { name: 'Undo this run’s changes' }));
  else {
    fireEvent.click(screen.getByRole('button', { name: 'Snapshot history' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Restore snapshot' }));
  }
  const confirm = await screen.findByRole(entry === 'undo' ? 'dialog' : 'alertdialog', { name: 'Restore this snapshot?' });
  await within(confirm).findByText('later edit.ts');
  fireEvent.click(within(confirm).getByRole('button', { name: 'Restore snapshot' }));
  await waitFor(() => expect(screen.getByRole('slider', { name: 'Move speed' })).toHaveValue('220'));
  expect(api.posts).toContain(`/api/projects/${projectId}/checkpoints/checkpoint-1/restore`);
});
