// @vitest-environment jsdom
import type { ArtBudgetResponse } from '@openpixo/contracts';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArtBudgetLine } from '../../../src/components/chat/ArtBudgetLine';
import { en } from '../../../src/i18n/locales/en';
import { zhCN } from '../../../src/i18n/locales/zh-CN';
import { artBudgetLine, budgetDraft, imagesForCredits } from '../../../src/runtime/chat/art-budget';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const account = { signedIn: true, availableCredits: 240, maxCredits: 252, imageCredits: 4 };
const budget = { limitCredits: 100, spentCredits: 12, reservedCredits: 0, usedCredits: 12, remainingCredits: 88 };
const approved = { status: 'approved' as const, startedAt: 1, approvedAt: 2 };

function state(over: Partial<ArtBudgetResponse> = {}): ArtBudgetResponse {
  return { budget, runActive: false, account, ownImageTool: false, suggestedCredits: 100, ...over };
}

function stubDaemon(initial: ArtBudgetResponse, onPost?: (credits: number) => Response) {
  let current = initial;
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const { credits } = JSON.parse(String(init.body)) as { credits: number };
      if (onPost) return onPost(credits);
      current = { ...current, budget: { ...budget, limitCredits: credits, remainingCredits: credits - budget.usedCredits } };
    }
    return new Response(JSON.stringify(current), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, setState: (next: ArtBudgetResponse) => { current = next; } };
}

function renderLine(props: Partial<Parameters<typeof ArtBudgetLine>[0]> = {}) {
  return render(<ArtBudgetLine projectId="p1" plan={approved} streaming={false} {...props} />);
}
const line = () => screen.getByTestId('art-budget-line');
const isOpen = () => line().className.includes(' open');

describe('what the line says', () => {
  it.each([
    ['nothing to show yet', null, 'hidden'],
    ['signed out', state({ account: { ...account, signedIn: false } }), 'hidden'],
    ['signed out with a budget', state({ account: { signedIn: false, availableCredits: null, maxCredits: null, imageCredits: 4 } }), 'hidden'],
    ['an own tool and no budget', state({ budget: null, ownImageTool: true }), 'hidden'],
    ['an own tool and a budget of 0', state({ budget: { ...budget, limitCredits: 0, usedCredits: 0, remainingCredits: 0 }, ownImageTool: true }), 'hidden'],
    ['no budget and no own tool', state({ budget: null }), 'offer'],
    ['a budget of 0 and no own tool', state({ budget: { ...budget, limitCredits: 0, usedCredits: 0, remainingCredits: 0 } }), 'offer'],
    ['a budget', state(), 'usage'],
    ['a budget and an own tool', state({ ownImageTool: true }), 'usage'],
    ['a budget that is used up', state({ budget: { ...budget, usedCredits: 100, remainingCredits: 0 } }), 'usage'],
  ])('with %s', (_name, value, kind) => {
    expect(artBudgetLine(value).kind).toBe(kind);
  });

  it('keeps a typed budget to digits and to what the balance can pay', () => {
    expect(budgetDraft('250', 252)).toBe('250');
    expect(budgetDraft('999', 252)).toBe('252');
    expect(budgetDraft('-5.5x', 252)).toBe('55');
    expect(budgetDraft('', 252)).toBe('');
  });

  it('estimates images only from a real price', () => {
    expect(imagesForCredits(100, 4)).toBe(25);
    expect(imagesForCredits(100, null)).toBeNull();
  });

  it('reads the way the owner wrote it, in both languages', () => {
    expect(en['chat.artBudget.usage'].replace('{used}', '12').replace('{limit}', '100')).toBe('Art budget: 12 of 100 credits used');
    expect(zhCN['chat.artBudget.usage'].replace('{used}', '12').replace('{limit}', '100')).toBe('美术预算 已用 12 / 100 积分');
  });
});

describe('the art budget line', () => {
  it('shows what is used after approval', async () => {
    stubDaemon(state());
    renderLine();
    await waitFor(() => expect(screen.getByTestId('art-budget-summary').textContent).toBe('Art budget: 12 of 100 credits used'));
    expect(isOpen()).toBe(true);
  });

  it.each([
    ['while planning', { plan: { status: 'planning' as const, startedAt: 1 } }],
    ['for someone who can only view', { viewerOnly: true }],
    ['with no project', { projectId: null }],
  ])('asks nothing and stays closed %s', async (_name, props) => {
    const { fetchMock } = stubDaemon(state());
    renderLine(props);
    await act(async () => {});
    expect(fetchMock).not.toHaveBeenCalled();
    expect(isOpen()).toBe(false);
  });

  it('adds no noise for someone with their own image tool', async () => {
    const { fetchMock } = stubDaemon(state({ budget: null, ownImageTool: true }));
    renderLine({ plan: undefined });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await act(async () => {});
    expect(isOpen()).toBe(false);
    expect(screen.getByTestId('art-budget-change').getAttribute('tabindex')).toBe('-1');
  });

  it('offers a budget on a project with no plan, signed in with no own tool', async () => {
    stubDaemon(state({ budget: null }));
    renderLine({ plan: undefined });
    await waitFor(() => expect(isOpen()).toBe(true));
    expect(screen.getByTestId('art-budget-summary').textContent).toBe(en['chat.artBudget.unset']);
    expect(screen.getByTestId('art-budget-change').textContent).toBe(en['chat.artBudget.set']);
  });

  it('changes the budget through the daemon, capped at the balance', async () => {
    const { fetchMock } = stubDaemon(state());
    renderLine();
    fireEvent.click(await waitFor(() => { expect(isOpen()).toBe(true); return screen.getByTestId('art-budget-change'); }));
    fireEvent.change(screen.getByTestId('art-budget-input'), { target: { value: '999' } });
    expect((screen.getByTestId('art-budget-input') as HTMLInputElement).value).toBe('252');
    fireEvent.change(screen.getByTestId('art-budget-input'), { target: { value: '150' } });
    fireEvent.click(screen.getByTestId('art-budget-save'));
    await waitFor(() => expect(screen.getByTestId('art-budget-summary').textContent).toBe('Art budget: 12 of 150 credits used'));
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(post[0]).toBe('/api/projects/p1/art-budget');
    expect(JSON.parse(String(post[1]!.body))).toEqual({ credits: 150 });
    expect(screen.queryByTestId('art-budget-input')).toBeNull();
  });

  it('disables changing during a run, and says why', async () => {
    stubDaemon(state());
    renderLine({ streaming: true });
    await waitFor(() => expect(isOpen()).toBe(true));
    expect((screen.getByTestId('art-budget-change') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('art-budget-busy').textContent).toBe(en['chat.artBudget.busy']);
  });

  it('closes an open editor when a run starts, and keeps the budget as it was', async () => {
    const { fetchMock } = stubDaemon(state());
    const view = renderLine();
    fireEvent.click(await waitFor(() => { expect(isOpen()).toBe(true); return screen.getByTestId('art-budget-change'); }));
    expect(screen.getByTestId('art-budget-input')).toBeTruthy();
    view.rerender(<ArtBudgetLine projectId="p1" plan={approved} streaming />);
    expect(screen.queryByTestId('art-budget-input')).toBeNull();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('says it did not work, calmly, when the daemon refuses', async () => {
    stubDaemon(state(), () => new Response(JSON.stringify({ error: { code: 'RUN_ACTIVE', message: 'busy' } }), { status: 409 }));
    renderLine();
    fireEvent.click(await waitFor(() => { expect(isOpen()).toBe(true); return screen.getByTestId('art-budget-change'); }));
    fireEvent.click(screen.getByTestId('art-budget-save'));
    expect((await screen.findByRole('status')).textContent).toBe(en['chat.artBudget.failed']);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('updates as images are made during a run, and once more when it ends', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { setState } = stubDaemon(state());
    const view = renderLine({ streaming: true });
    await vi.waitFor(() => expect(screen.getByTestId('art-budget-summary').textContent).toBe('Art budget: 12 of 100 credits used'));
    setState(state({ budget: { ...budget, usedCredits: 16, remainingCredits: 84 } }));
    await act(async () => { vi.advanceTimersByTime(5000); });
    await vi.waitFor(() => expect(screen.getByTestId('art-budget-summary').textContent).toBe('Art budget: 16 of 100 credits used'));
    setState(state({ budget: { ...budget, usedCredits: 20, remainingCredits: 80 } }));
    view.rerender(<ArtBudgetLine projectId="p1" plan={approved} streaming={false} />);
    await vi.waitFor(() => expect(screen.getByTestId('art-budget-summary').textContent).toBe('Art budget: 20 of 100 credits used'));
  });

  it('reads an older daemon that says nothing about the mode as asking first', async () => {
    stubDaemon(state());
    renderLine();
    await waitFor(() => expect(screen.getByTestId('art-budget-mode').textContent).toBe(en['chat.artBudget.modeAsk']));
  });

  it('switches to spending within the budget where the budget is changed, sending only the mode', async () => {
    const { fetchMock } = stubDaemon(state({ mode: 'ask' }), () => new Response(JSON.stringify(state({ mode: 'auto' })), { status: 200 }));
    renderLine();
    fireEvent.click(await waitFor(() => { expect(isOpen()).toBe(true); return screen.getByTestId('art-budget-change'); }));
    expect((screen.getByTestId('art-budget-mode-ask') as HTMLInputElement).checked).toBe(true);
    expect(screen.getByTestId('art-budget-mode-hint').textContent).toBe(en['chat.artBudget.modeAskHint']);
    fireEvent.click(screen.getByTestId('art-budget-mode-auto'));
    expect(screen.getByTestId('art-budget-mode-hint').textContent).toBe(en['chat.artBudget.modeAutoHint']);
    fireEvent.click(screen.getByTestId('art-budget-save'));
    await waitFor(() => expect(screen.getByTestId('art-budget-mode').textContent).toBe(en['chat.artBudget.modeAuto']));
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(post[0]).toBe('/api/projects/p1/art-budget');
    expect(JSON.parse(String(post[1]!.body))).toEqual({ mode: 'auto' });
  });

  it('sends the credits and the mode together when both change', async () => {
    const { fetchMock } = stubDaemon(state({ mode: 'auto' }), () => new Response(JSON.stringify(state({ mode: 'ask' })), { status: 200 }));
    renderLine();
    fireEvent.click(await waitFor(() => { expect(isOpen()).toBe(true); return screen.getByTestId('art-budget-change'); }));
    fireEvent.change(screen.getByTestId('art-budget-input'), { target: { value: '150' } });
    fireEvent.click(screen.getByTestId('art-budget-mode-ask'));
    fireEvent.click(screen.getByTestId('art-budget-save'));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true));
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse(String(post[1]!.body))).toEqual({ credits: 150, mode: 'ask' });
  });

  it('keeps the mode switch closed during a run', async () => {
    stubDaemon(state());
    renderLine({ streaming: true });
    await waitFor(() => expect(isOpen()).toBe(true));
    expect((screen.getByTestId('art-budget-change') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId('art-budget-mode-auto')).toBeNull();
  });

  it('mentions art the user approved that no run has started on', async () => {
    stubDaemon(state({ approval: { approvedCredits: 32, usedCredits: 0, remainingCredits: 32, runId: null, approvedAt: 1 } }));
    renderLine();
    await waitFor(() => expect(screen.getByTestId('art-budget-approved').textContent).toBe('32 credits approved for the next art'));
  });

  it('shows a used-up budget as the same calm line, not an error', async () => {
    stubDaemon(state({ budget: { ...budget, usedCredits: 100, remainingCredits: 0 } }));
    renderLine();
    await waitFor(() => expect(screen.getByTestId('art-budget-summary').textContent).toBe('Art budget: 100 of 100 credits used'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect((screen.getByTestId('art-budget-change') as HTMLButtonElement).disabled).toBe(false);
  });
});
