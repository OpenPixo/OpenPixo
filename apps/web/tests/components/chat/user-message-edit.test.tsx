// @vitest-environment jsdom
/**
 * "Edit" on a sent message. What the user must be able to rely on: the pencil
 * opens the text for editing in place; sending hands the new text to the host
 * together with whether to put the files back, which is only offered when a
 * checkpoint from before the answer exists; Esc leaves everything as it was;
 * and a refused edit keeps the editor open with a reason.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { UserMessageImpl } from '../../../src/components/ChatPane';

const t = ((key: string) => key) as never;
const message = { id: 'u1', role: 'user', content: 'make the jump higher', createdAt: Date.UTC(2026, 10, 8) } as never;

function stubCheckpoints(runIds: string[]) {
  const checkpoints = runIds.map((runId) => ({
    id: `cp-${runId}`, runId, conversationId: 'c1', createdAt: '', summary: '', kind: 'run',
    changedFileCount: 1, runChanges: [], completedAt: null,
  }));
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(
    JSON.stringify({ status: 'available', busy: false, checkpoints }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  ));
}

function renderMessage(onEdit?: (...args: unknown[]) => Promise<unknown>, nextRunId: string | null = 'run-1', projectId = 'p-edit') {
  return render(
    <UserMessageImpl
      message={message}
      projectId={projectId}
      t={t}
      onEdit={onEdit as never}
      nextRunId={nextRunId}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('editing a sent message', () => {
  it('offers no pencil when the host cannot edit (a run is going, or a viewer)', () => {
    renderMessage(undefined);
    expect(screen.queryByTestId('user-message-edit')).toBeNull();
  });

  it('sends the edited text and puts the files back when a checkpoint allows it', async () => {
    stubCheckpoints(['run-1']);
    const onEdit = vi.fn(async () => ({ ok: true, files: { restored: true, checkpointId: 'cp-run-1', restoredFiles: [] } }));
    renderMessage(onEdit, 'run-1', 'p-restorable');
    fireEvent.click(screen.getByTestId('user-message-edit'));
    const box = screen.getByRole('textbox', { name: 'chat.editMessageAria' }) as HTMLTextAreaElement;
    expect(box.value).toBe('make the jump higher');
    expect(document.activeElement).toBe(box);
    const restore = await screen.findByTestId('user-message-editor-restore') as HTMLInputElement;
    expect(restore.checked).toBe(true);
    fireEvent.change(box, { target: { value: 'make the jump twice as high' } });
    await act(async () => { fireEvent.keyDown(box, { key: 'Enter' }); });
    expect(onEdit).toHaveBeenCalledWith(message, 'make the jump twice as high', true);
  });

  it('keeps the files when the user unticks the box', async () => {
    stubCheckpoints(['run-1']);
    const onEdit = vi.fn(async () => ({ ok: true, files: { restored: false, reason: 'not_requested' } }));
    renderMessage(onEdit, 'run-1', 'p-untick');
    fireEvent.click(screen.getByTestId('user-message-edit'));
    fireEvent.click(await screen.findByTestId('user-message-editor-restore'));
    await act(async () => { fireEvent.click(screen.getByTestId('user-message-editor-send')); });
    expect(onEdit).toHaveBeenCalledWith(message, 'make the jump higher', false);
  });

  it('says the files stay when no checkpoint was taken before the answer', async () => {
    stubCheckpoints(['some-other-run']);
    const onEdit = vi.fn();
    renderMessage(onEdit, 'run-1', 'p-no-checkpoint');
    fireEvent.click(screen.getByTestId('user-message-edit'));
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(await screen.findByText('chat.editFilesStay')).toBeTruthy();
    expect(screen.queryByTestId('user-message-editor-restore')).toBeNull();
  });

  it('leaves the message as it was on Esc', () => {
    const onEdit = vi.fn();
    renderMessage(onEdit, null);
    fireEvent.click(screen.getByTestId('user-message-edit'));
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'chat.editMessageAria' }), { key: 'Escape' });
    expect(screen.queryByTestId('user-message-editor')).toBeNull();
    expect(screen.getByText('make the jump higher')).toBeTruthy();
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('keeps the editor open with a reason when the edit is refused', async () => {
    const onEdit = vi.fn(async () => ({ ok: false, code: 'RUN_ACTIVE' }));
    renderMessage(onEdit, null);
    fireEvent.click(screen.getByTestId('user-message-edit'));
    await act(async () => { fireEvent.click(screen.getByTestId('user-message-editor-send')); });
    expect(screen.getByRole('alert').textContent).toBe('chat.editFailedBusy');
    expect(screen.getByTestId('user-message-editor')).toBeTruthy();
  });
});
