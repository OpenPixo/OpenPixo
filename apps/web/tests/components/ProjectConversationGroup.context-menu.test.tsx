// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectConversationGroup } from '../../src/components/entry-nav-rail/ProjectConversationGroup';
import { createConversation, deleteConversation, listConversations, patchConversation } from '../../src/state/projects';
import { conversationSeenTimes, markConversationSeen } from '../../src/state/conversation-seen';
import { navigate } from '../../src/router';
import type { Conversation, Project } from '../../src/types';

vi.mock('../../src/state/projects', () => ({
  CONVERSATIONS_CHANGED_EVENT: 'test:conversations-changed',
  listConversations: vi.fn(),
  createConversation: vi.fn(),
  patchConversation: vi.fn(),
  deleteConversation: vi.fn(),
}));
vi.mock('../../src/router', () => ({ navigate: vi.fn() }));
vi.mock('../../src/hooks/useProjectRunStatuses', () => ({ acknowledgeProjectCompletion: vi.fn() }));
vi.mock('../../src/i18n', () => ({
  useT: () => (key: string, vars?: Record<string, string>) => {
    const text = ({
      'chat.conversationsHeading': 'Conversations',
      'chat.untitledConversation': 'Untitled conversation',
      'contextMenu.session.rename': 'Rename',
      'contextMenu.session.fork': 'Fork',
      'contextMenu.session.markUnread': 'Mark as unread',
      'contextMenu.session.delete': 'Delete',
      'contextMenu.session.deleteTitle': 'Delete this conversation?',
      'contextMenu.session.deleteBody': '"{title}" will be deleted.',
      'contextMenu.copy': 'Copy',
      'designs.renameCancel': 'Cancel',
    } as Record<string, string>)[key] ?? key;
    return text.replace(/\{(\w+)\}/g, (_, name: string) => vars?.[name] ?? '');
  },
}));

const project: Project = { id: 'game', name: 'My game', createdAt: 1, updatedAt: 1 } as Project;
const conversation = (id: string, extra: Partial<Conversation> = {}): Conversation => ({
  id, title: `Session ${id}`, projectId: project.id, createdAt: 1, updatedAt: 1, ...extra,
});

function renderGroup(active?: string) {
  return render(
    <ProjectConversationGroup project={project} activeProjectId={active ? 'game' : null} activeConversationId={active ?? null}>
      <button type="button">My game</button>
    </ProjectConversationGroup>,
  );
}

async function openMenu(name: string, active?: string) {
  renderGroup(active);
  const row = await screen.findByRole('button', { name });
  fireEvent.contextMenu(row, { clientX: 40, clientY: 60 });
  return screen.findByRole('menu', { name });
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('openpixo:project-sessions:game:local', 'true');
  vi.mocked(listConversations).mockResolvedValue([conversation('a'), conversation('b')]);
  vi.mocked(patchConversation).mockImplementation(async (_p, id, patch) => conversation(id, patch));
  vi.mocked(deleteConversation).mockResolvedValue(true);
  vi.mocked(createConversation).mockResolvedValue(conversation('fork'));
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('conversation right-click menu', () => {
  it('offers rename, fork, copy and delete with their letter shortcuts', async () => {
    const menu = await openMenu('Session a');
    const labels = Array.from(menu.querySelectorAll('[role="menuitem"]')).map((item) => item.textContent);
    expect(labels).toEqual(['RenameR', 'ForkF', 'Copy', 'DeleteD']);
  });

  it('renames inline and saves the new title', async () => {
    await openMenu('Session a');
    fireEvent.click(screen.getByRole('menuitem', { name: /Rename/ }));
    const input = await screen.findByRole('textbox', { name: 'Rename' });
    fireEvent.change(input, { target: { value: 'Boss fight' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(patchConversation).toHaveBeenCalledWith('game', 'a', { title: 'Boss fight' }));
    expect(await screen.findByRole('button', { name: 'Boss fight' })).toBeTruthy();
  });

  it('Escape leaves the title as it was', async () => {
    await openMenu('Session a');
    fireEvent.click(screen.getByRole('menuitem', { name: /Rename/ }));
    const input = await screen.findByRole('textbox', { name: 'Rename' });
    fireEvent.change(input, { target: { value: 'Nope' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(await screen.findByRole('button', { name: 'Session a' })).toBeTruthy();
    expect(patchConversation).not.toHaveBeenCalled();
  });

  it('forks into a new conversation that carries the context, and opens it', async () => {
    const menu = await openMenu('Session a');
    fireEvent.keyDown(menu, { key: 'f' });
    await waitFor(() => expect(createConversation).toHaveBeenCalledWith('game', undefined,
      { seedFromConversationId: 'a', throwOnError: true }));
    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'fork' }));
  });

  it('deletes only after the user confirms', async () => {
    await openMenu('Session b');
    fireEvent.click(screen.getByRole('menuitem', { name: /Delete/ }));
    expect(await screen.findByText('"Session b" will be deleted.')).toBeTruthy();
    expect(deleteConversation).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(deleteConversation).toHaveBeenCalledWith('game', 'b'));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Session b' })).toBeNull());
    expect(navigate).not.toHaveBeenCalled();
  });

  it('moves to another conversation when the one on screen is deleted', async () => {
    await openMenu('Session a', 'a');
    fireEvent.click(screen.getByRole('menuitem', { name: /Delete/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(
      { kind: 'project', projectId: 'game', conversationId: 'b', fileName: null }));
  });

  it('marks a finished reply unread so its dot comes back', async () => {
    vi.mocked(listConversations).mockResolvedValue([
      conversation('a'),
      conversation('done', { latestRun: { status: 'succeeded', endedAt: 5_000 } }),
    ]);
    markConversationSeen('done', 9_000);
    await openMenu('Session done');
    fireEvent.click(screen.getByRole('menuitem', { name: /Mark as unread/ }));
    expect(conversationSeenTimes().done).toBe(4_999);
    expect(await screen.findByTestId('conversation-new-reply')).toBeTruthy();
  });

  it('closes on Escape and gives focus back to the row', async () => {
    const menu = await openMenu('Session a');
    await act(async () => { fireEvent.keyDown(menu, { key: 'Escape' }); });
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

