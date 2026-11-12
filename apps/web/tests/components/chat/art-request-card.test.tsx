// @vitest-environment jsdom
/**
 * Owner decision 2026-11-11: in "Ask me first" the agent ends its reply with an art
 * card, the chat draws it inside the reply, and only the user's click approves it.
 * Approve posts the credits, then answers through the same send a question form uses.
 */
import type { ArtBudgetResponse } from '@openpixo/contracts';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssistantMessage } from '../../../src/components/AssistantMessage';
import { en } from '../../../src/i18n/locales/en';
import type { ChatMessage } from '../../../src/types';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const CARD = '<art-request credits="32">\n- Hero design: 1 image\n- Hero idle, run, jump, hurt: 4 images\n</art-request>';
const REPLY = `The hero needs a design and four moves.\n\n${CARD}`;
const MESSAGE_SENT = 'Approved: make this art (up to 32 credits).';

const account = { signedIn: true, availableCredits: 240, maxCredits: 252, imageCredits: 4 };
const budget = { limitCredits: 100, spentCredits: 12, reservedCredits: 0, usedCredits: 12, remainingCredits: 88 };
const budgetState = (over: Partial<ArtBudgetResponse> = {}): ArtBudgetResponse => ({ budget, runActive: false, account, ownImageTool: false, ...over });

function reply(text: string, runStatus: ChatMessage['runStatus'] = 'succeeded'): ChatMessage {
  return { id: 'assistant-art', role: 'assistant', content: text, events: [{ kind: 'text', text }], runStatus, startedAt: 1, endedAt: runStatus === 'running' ? undefined : 2 } as ChatMessage;
}

function stubDaemon(state: ArtBudgetResponse, refuse?: { path: string; status: number; code: string }) {
  let current = state;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (refuse && init?.method === 'POST' && url.endsWith(refuse.path)) {
      return new Response(JSON.stringify({ error: { code: refuse.code, message: 'refused' } }), { status: refuse.status });
    }
    if (init?.method === 'POST' && url.endsWith('/art-budget/approve')) {
      const { credits } = JSON.parse(String(init.body)) as { credits: number };
      current = { ...current, approval: { approvedCredits: credits, usedCredits: 0, remainingCredits: credits, runId: null, approvedAt: 3 } };
    } else if (init?.method === 'POST') {
      const { mode } = JSON.parse(String(init.body)) as { mode?: 'ask' | 'auto' };
      if (mode) current = { ...current, mode };
    }
    return new Response(JSON.stringify(current), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  const posts = () => fetchMock.mock.calls
    .filter(([, init]) => init?.method === 'POST')
    .map(([url, init]) => [url, JSON.parse(String(init!.body))] as const);
  return { fetchMock, posts };
}

function renderReply(props: Partial<Parameters<typeof AssistantMessage>[0]> = {}) {
  const onSubmitQuestionForm = vi.fn(async () => true);
  const view = render(
    <AssistantMessage
      message={reply(REPLY)}
      streaming={false}
      projectId="p1"
      conversationId="c1"
      isLast
      onSubmitQuestionForm={onSubmitQuestionForm}
      {...props}
    />,
  );
  return { onSubmitQuestionForm, ...view };
}

const approve = () => screen.getByTestId('art-request-approve') as HTMLButtonElement;
const approveAlways = () => screen.getByTestId('art-request-approve-always') as HTMLButtonElement;

describe('the art card in a reply', () => {
  it('draws the card from the message and never shows the raw block', async () => {
    stubDaemon(budgetState());
    const { container } = renderReply();
    const card = screen.getByTestId('art-request-card');
    expect(card.textContent).toContain('Hero design: 1 image');
    expect(card.textContent).toContain('Hero idle, run, jump, hurt: 4 images');
    expect(screen.getByTestId('art-request-total').textContent).toBe('About 32 credits');
    expect(container.textContent).toContain('The hero needs a design and four moves.');
    expect(container.textContent).not.toContain('art-request');
    expect(container.textContent).not.toContain('credits="32"');
    await waitFor(() => expect(screen.getByTestId('art-request-left').textContent).toBe('88 left in the art budget'));
    expect(approve().textContent).toBe(en['chat.artRequest.approve']);
    expect(approveAlways().textContent).toBe(en['chat.artRequest.approveAlways']);
    expect(card.textContent).toContain(en['chat.artRequest.orReply']);
  });

  it('keeps a half-written card out of the text while it streams', () => {
    stubDaemon(budgetState());
    const partial = 'The hero needs a design and four moves.\n\n<art-request credits="32">\n- Hero design: 1 im';
    const { container } = renderReply({ message: reply(partial, 'running'), streaming: true });
    expect(container.textContent).not.toContain('art-request');
    expect(container.textContent).not.toContain('Hero design');
    expect(screen.queryByTestId('art-request-card')).toBeNull();
  });

  it('approves the credits through the daemon, then sends the approval message', async () => {
    const { posts } = stubDaemon(budgetState());
    const { onSubmitQuestionForm } = renderReply();
    await waitFor(() => expect(approve().disabled).toBe(false));
    fireEvent.click(approve());
    await waitFor(() => expect(onSubmitQuestionForm).toHaveBeenCalled());
    expect(posts()).toEqual([['/api/projects/p1/art-budget/approve', { credits: 32 }]]);
    expect(onSubmitQuestionForm).toHaveBeenCalledWith(MESSAGE_SENT, undefined, undefined, undefined, 'art-request');
  });

  it('with "don\'t ask again", switches to spending within budget first, then approves', async () => {
    const { posts } = stubDaemon(budgetState());
    const { onSubmitQuestionForm } = renderReply();
    await waitFor(() => expect(approveAlways().disabled).toBe(false));
    fireEvent.click(approveAlways());
    await waitFor(() => expect(onSubmitQuestionForm).toHaveBeenCalledWith(MESSAGE_SENT, undefined, undefined, undefined, 'art-request'));
    expect(posts()).toEqual([
      ['/api/projects/p1/art-budget', { mode: 'auto' }],
      ['/api/projects/p1/art-budget/approve', { credits: 32 }],
    ]);
  });

  it('says why in plain words when the daemon refuses, and sends nothing', async () => {
    stubDaemon(budgetState(), { path: '/art-budget/approve', status: 409, code: 'RUN_ACTIVE' });
    const { onSubmitQuestionForm } = renderReply();
    await waitFor(() => expect(approve().disabled).toBe(false));
    fireEvent.click(approve());
    expect((await screen.findByTestId('art-request-error')).textContent).toBe(en['chat.artRequest.errorBusy']);
    expect(onSubmitQuestionForm).not.toHaveBeenCalled();
    expect(approve().disabled).toBe(false);
  });

  it('shows the answered card once the approval is in the conversation', async () => {
    stubDaemon(budgetState());
    renderReply({ nextUserContent: MESSAGE_SENT });
    expect(screen.getByTestId('art-request-approved').textContent).toBe('Approved, up to 32 credits');
    expect(screen.queryByTestId('art-request-approve')).toBeNull();
  });
});

describe('when the art card cannot be approved', () => {
  it.each([
    ['while this reply is still streaming', { streaming: true, message: reply(REPLY, 'running') }, en['chat.artRequest.busy']],
    ['after the conversation moved on', { nextUserContent: 'Make the hero blue instead' }, en['chat.artRequest.stale']],
    ['on a reply that is not the latest', { isLast: false, isLastTurn: false }, en['chat.artRequest.stale']],
  ])('disables both buttons %s', async (_name, props, line) => {
    stubDaemon(budgetState());
    renderReply(props);
    expect(approve().disabled).toBe(true);
    expect(approveAlways().disabled).toBe(true);
    await waitFor(() => expect(screen.getByTestId('art-request-status').textContent).toBe(line));
  });

  it('waits while the daemon says a run is active', async () => {
    stubDaemon(budgetState({ runActive: true }));
    renderReply();
    await waitFor(() => expect(screen.getByTestId('art-request-status').textContent).toBe(en['chat.artRequest.busy']));
    expect(approve().disabled).toBe(true);
  });

  it('says what it needs and where to raise the budget when it asks for more than is left', async () => {
    const { posts } = stubDaemon(budgetState({ budget: { ...budget, usedCredits: 80, remainingCredits: 20 } }));
    renderReply();
    await waitFor(() => expect(screen.getByTestId('art-request-status').textContent)
      .toBe('This needs 32 credits and the budget has 20 left. Raise the budget above the message box, then approve.'));
    expect(approve().disabled).toBe(true);
    expect(approveAlways().disabled).toBe(true);
    fireEvent.click(approve());
    expect(posts()).toEqual([]);
  });

  it('offers only Approve when the project already spends within its budget', async () => {
    stubDaemon(budgetState({ mode: 'auto' }));
    renderReply();
    await waitFor(() => expect(approve().disabled).toBe(false));
    expect(screen.queryByTestId('art-request-approve-always')).toBeNull();
  });
});
