// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectConversationGroup } from '../../src/components/entry-nav-rail/ProjectConversationGroup';
import { CONVERSATIONS_CHANGED_EVENT, createConversation, listConversations } from '../../src/state/projects';
import { navigate } from '../../src/router';
import type { Conversation, Project } from '../../src/types';

vi.mock('../../src/state/projects', () => ({
  CONVERSATIONS_CHANGED_EVENT: 'test:conversations-changed', listConversations: vi.fn(), createConversation: vi.fn(),
}));
vi.mock('../../src/router', () => ({ navigate: vi.fn() }));
vi.mock('../../src/hooks/useProjectRunStatuses', () => ({ acknowledgeProjectCompletion: vi.fn() }));
vi.mock('../../src/i18n', () => ({ useT: () => (key: string) => ({
  'chat.conversationsHeading': 'Conversations', 'chat.newSession': 'New session',
  'chat.untitledConversation': 'Untitled conversation', 'common.loading': 'Loading', 'promptTemplates.retry': 'Retry',
  'chat.forkConversationFailed': 'Could not create session', 'chat.emptyConversations': 'No conversations',
}[key] ?? key) }));

const project: Project = { id: 'game', name: 'My game', createdAt: 1, updatedAt: 1 } as Project;
const context = null;
const conversation = (id: string, updatedAt = 1): Conversation => ({
  id, title: `Session ${id}`, projectId: project.id, createdAt: 1, updatedAt,
});
function view(extra: Partial<ComponentProps<typeof ProjectConversationGroup>> = {}) {
  return <ProjectConversationGroup project={project} {...extra}><button>My game</button></ProjectConversationGroup>;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(listConversations).mockResolvedValue([]);
  vi.mocked(createConversation).mockResolvedValue(conversation('new'));
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('project session hierarchy', () => {
  it('loads only expanded projects and opens the exact selected conversation', async () => {
    vi.mocked(listConversations).mockResolvedValue([conversation('old'), conversation('recent', 2)]);
    render(view({  }));
    expect(listConversations).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'My game · Conversations' }));
    await screen.findByRole('button', { name: 'Session recent' });
    expect(listConversations).toHaveBeenCalledWith('game', {  throwOnError: true });
    fireEvent.click(screen.getByRole('button', { name: 'Session old' }));
    expect(navigate).toHaveBeenCalledWith({ kind: 'project', projectId: 'game', conversationId: 'old', fileName: null });
  });

  it('automatically expands the active project, highlights its session and preserves the open file', async () => {
    vi.mocked(listConversations).mockResolvedValue([conversation('selected'), conversation('other')]);
    render(view({ activeProjectId: 'game', activeConversationId: 'selected', activeFileName: 'index.html' }));
    const selected = await screen.findByRole('button', { name: 'Session selected' });
    expect(selected.getAttribute('aria-current')).toBe('page');
    fireEvent.click(screen.getByRole('button', { name: 'Session other' }));
    expect(navigate).toHaveBeenCalledWith({ kind: 'project', projectId: 'game', conversationId: 'other', fileName: 'index.html' });
  });

  it('creates one blank session for rapid clicks and navigates without starting a turn', async () => {
    const pending = deferred<Conversation | null>();
    vi.mocked(createConversation).mockReturnValue(pending.promise);
    render(view({  }));
    const button = screen.getByRole('button', { name: 'New session · My game' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(createConversation).toHaveBeenCalledTimes(1);
    expect(createConversation).toHaveBeenCalledWith('game', undefined, {  throwOnError: true });
    expect(button.hasAttribute('disabled')).toBe(true);
    await act(async () => { pending.resolve(conversation('new')); });
    expect(navigate).toHaveBeenCalledWith({ kind: 'project', projectId: 'game', conversationId: 'new', fileName: null });
  });

  it('keeps creation failure actionable and lets the user retry', async () => {
    vi.mocked(createConversation).mockRejectedValueOnce(new Error('HTTP 403'));
    render(view());
    fireEvent.click(screen.getByRole('button', { name: 'New session · My game' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Could not create session');
    fireEvent.click(screen.getByRole('button', { name: 'New session · My game' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
  });

  it('shows a failed read separately from an empty project and can retry', async () => {
    vi.mocked(listConversations).mockRejectedValueOnce(new Error('HTTP 503'));
    render(view({ activeProjectId: 'game' }));
    await screen.findByRole('alert');
    expect(screen.queryByText('No conversations')).toBeNull();
    vi.mocked(listConversations).mockResolvedValue([conversation('recovered')]);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('button', { name: 'Session recovered' })).toBeTruthy();
  });

  it('refreshes on conversation writes and remembers folder expansion across remounts', async () => {
    const mounted = render(view());
    fireEvent.click(screen.getByRole('button', { name: 'My game · Conversations' }));
    await screen.findByText('No conversations');
    vi.mocked(listConversations).mockResolvedValue([conversation('created-elsewhere')]);
    act(() => window.dispatchEvent(new CustomEvent(CONVERSATIONS_CHANGED_EVENT, { detail: { projectId: 'game' } })));
    await screen.findByRole('button', { name: 'Session created-elsewhere' });
    mounted.unmount();
    render(view());
    expect(screen.getByRole('button', { name: 'My game · Conversations' }).getAttribute('aria-expanded')).toBe('true');
    expect(await screen.findByRole('button', { name: 'Session created-elsewhere' })).toBeTruthy();
  });
});

describe('row status marks', () => {
  const ended = (id: string, extra: Partial<Conversation> = {}): Conversation => ({
    ...conversation(id), latestRun: { status: 'succeeded', endedAt: 2_000 }, ...extra,
  });

  it('shows needs-you over working, and a finished reply only after the user left the conversation', async () => {
    localStorage.setItem('openpixo:conversation-seen', JSON.stringify({ seen: 5_000, unseen: 1_000, asking: 1_000 }));
    vi.mocked(listConversations).mockResolvedValue([
      ended('asking', { needsInput: true }),
      ended('unseen'),
      ended('seen'),
      { ...conversation('working'), latestRun: { status: 'running', startedAt: 1_000 } },
      ended('never-opened'),
    ]);
    render(view({ activeProjectId: 'game', activeConversationId: 'other' }));
    const row = async (id: string) => (await screen.findByText(`Session ${id}`)).closest('button')!;
    expect((await row('asking')).querySelector('[data-testid="conversation-needs-input"]')).not.toBeNull();
    expect((await row('unseen')).querySelector('[data-testid="conversation-new-reply"]')).not.toBeNull();
    expect((await row('seen')).querySelector('[role="img"]')).toBeNull();
    expect((await row('never-opened')).querySelector('[role="img"]')).toBeNull();
    expect((await row('working')).querySelector('[aria-label="chat.record.running"]')).not.toBeNull();
  });

  it('leaves the conversation on screen unmarked', async () => {
    localStorage.setItem('openpixo:conversation-seen', JSON.stringify({ open: 1_000 }));
    vi.mocked(listConversations).mockResolvedValue([ended('open', { needsInput: true })]);
    render(view({ activeProjectId: 'game', activeConversationId: 'open' }));
    const row = (await screen.findByText('Session open')).closest('button')!;
    expect(row.querySelector('[role="img"]')).toBeNull();
  });
});
