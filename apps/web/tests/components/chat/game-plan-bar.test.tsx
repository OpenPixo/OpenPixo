// @vitest-environment jsdom
import { GAME_PLAN_APPROVE_LABELS, type ArtBudgetResponse } from '@openpixo/contracts';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GamePlanBar } from '../../../src/components/chat/GamePlanBar';
import { en } from '../../../src/i18n/locales/en';
import { zhCN } from '../../../src/i18n/locales/zh-CN';
import type { Project } from '../../../src/types';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const planning = { status: 'planning' as const, startedAt: 1 };
const approved: Project = { id: 'p1', name: 'Rage', metadata: { kind: 'other', gamePlan: { status: 'approved', startedAt: 1, approvedAt: 2 } } } as Project;

function renderBar(props: Partial<Parameters<typeof GamePlanBar>[0]> = {}) {
  const onApproved = vi.fn();
  const view = render(
    <GamePlanBar projectId="p1" plan={planning} hasReply streaming={false} onApproved={onApproved} {...props} />,
  );
  return { onApproved, ...view };
}

const button = () => screen.queryByTestId('game-plan-approve');

describe('the plan approval bar', () => {
  it('uses the wording the agent is told to point at', () => {
    expect(en['chat.gamePlan.approve']).toBe(GAME_PLAN_APPROVE_LABELS.en);
    expect(zhCN['chat.gamePlan.approve']).toBe(GAME_PLAN_APPROVE_LABELS['zh-CN']);
  });

  it('offers approval once the agent has replied and the run has stopped', () => {
    renderBar();
    expect(button()).not.toBeNull();
    expect(button()!.getAttribute('tabindex')).not.toBe('-1');
    expect(screen.getByTestId('game-plan-bar').className).toContain('open');
  });

  it.each([
    ['while the agent is still working', { streaming: true }],
    ['before the agent has said anything', { hasReply: false }],
    ['for someone who can only view', { viewerOnly: true }],
    ['once the plan is approved', { plan: { status: 'approved' as const, startedAt: 1, approvedAt: 2 } }],
    ['for a project with no plan', { plan: undefined }],
  ])('stays closed %s', (_name, props) => {
    renderBar(props);
    expect(screen.getByTestId('game-plan-bar').className).not.toContain(' open');
    expect(button()?.getAttribute('tabindex')).toBe('-1');
  });

  it('approves through the daemon, then hands the updated project back to start building', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ plan: approved.metadata!.gamePlan, project: approved }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { onApproved } = renderBar();
    fireEvent.click(button()!);
    await waitFor(() => expect(onApproved).toHaveBeenCalledWith(approved));
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit | undefined]>;
    const [url, init] = calls.find(([, options]) => options?.method === 'POST')!;
    expect(url).toBe('/api/projects/p1/game-plan/approve');
    expect(init!.method).toBe('POST');
  });

  it('says so and stays in planning when approval fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'RUN_ACTIVE', message: 'busy' } }), { status: 409 })));
    const { onApproved } = renderBar();
    fireEvent.click(button()!);
    await screen.findByRole('alert');
    expect(onApproved).not.toHaveBeenCalled();
  });
});

describe('the art budget on the approval bar', () => {
  const signedIn = { signedIn: true, availableCredits: 240, maxCredits: 240, imageCredits: 4 };
  function daemon(state: Partial<ArtBudgetResponse>) {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify(init?.method === 'POST'
      ? { plan: approved.metadata!.gamePlan, project: approved }
      : { budget: null, runActive: false, ...state }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const approveBody = () => JSON.parse(String(fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')![1]!.body)) as Record<string, unknown>;
    return { fetchMock, approveBody };
  }
  const input = () => screen.findByTestId('game-plan-art-budget-input') as Promise<HTMLInputElement>;

  it('offers the default with the balance and roughly what it buys', async () => {
    daemon({ account: signedIn, ownImageTool: false, suggestedCredits: 100 });
    renderBar();
    expect((await input()).value).toBe('100');
    const hint = screen.getByTestId('game-plan-art-budget-hint').textContent;
    expect(hint).toContain('240');
    expect(hint).toContain('25');
  });

  it('defaults to 0 when an own image tool is connected, and says why', async () => {
    daemon({ account: signedIn, ownImageTool: true, suggestedCredits: 0 });
    renderBar();
    expect((await input()).value).toBe('0');
    expect(screen.getByTestId('game-plan-art-budget-hint').textContent).toContain(en['chat.artBudget.ownTool']);
  });

  it('explains what 0 means without an own tool', async () => {
    daemon({ account: signedIn, ownImageTool: false, suggestedCredits: 100 });
    renderBar();
    fireEvent.change(await input(), { target: { value: '0' } });
    expect(screen.getByTestId('game-plan-art-budget-hint').textContent).toContain(en['chat.artBudget.zero']);
  });

  it('approves the budget with the plan', async () => {
    const { approveBody } = daemon({ account: signedIn, ownImageTool: false, suggestedCredits: 100 });
    const { onApproved } = renderBar();
    fireEvent.change(await input(), { target: { value: '60' } });
    fireEvent.click(button()!);
    await waitFor(() => expect(onApproved).toHaveBeenCalled());
    expect(approveBody()).toEqual({ artBudgetCredits: 60 });
  });

  it('sends the suggested amount when the user leaves it alone', async () => {
    const { approveBody } = daemon({ account: { ...signedIn, availableCredits: 30, maxCredits: 30 }, ownImageTool: false, suggestedCredits: 30 });
    const { onApproved } = renderBar();
    expect((await input()).value).toBe('30');
    fireEvent.click(button()!);
    await waitFor(() => expect(onApproved).toHaveBeenCalled());
    expect(approveBody()).toEqual({ artBudgetCredits: 30 });
  });

  it('saves the budget on its own before approval, so the agent can pay for style samples', async () => {
    const budgetState = { budget: null as ArtBudgetResponse['budget'], runActive: false, account: signedIn, ownImageTool: false, suggestedCredits: 100 };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/projects/p1/art-budget' && init?.method === 'POST') {
        const { credits } = JSON.parse(String(init.body)) as { credits: number };
        budgetState.budget = { limitCredits: credits, spentCredits: 8, reservedCredits: 0, usedCredits: 8, remainingCredits: credits - 8 };
      }
      return new Response(JSON.stringify(budgetState), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { onApproved } = renderBar();
    fireEvent.change(await input(), { target: { value: '12' } });
    fireEvent.click(screen.getByTestId('game-plan-art-budget-save'));
    await waitFor(() => expect(screen.getByTestId('game-plan-art-budget-hint').textContent).toContain(en['chat.artBudget.usage'].replace('{used}', '8').replace('{limit}', '12')));
    const saves = (fetchMock.mock.calls as unknown as Array<[string, RequestInit | undefined]>).filter(([, options]) => options?.method === 'POST');
    expect(saves.map(([url, options]) => [url, JSON.parse(String(options!.body))])).toEqual([['/api/projects/p1/art-budget', { credits: 12 }]]);
    expect(onApproved).not.toHaveBeenCalled();
    expect((await input()).value).toBe('12');
  });

  it('cannot go above the balance', async () => {
    daemon({ account: signedIn, ownImageTool: false, suggestedCredits: 100 });
    renderBar();
    fireEvent.change(await input(), { target: { value: '9999' } });
    expect((await input()).value).toBe('240');
  });

  it('leaves out the estimate when the price is unknown, rather than guessing', async () => {
    daemon({ account: { ...signedIn, imageCredits: null }, ownImageTool: false, suggestedCredits: 100 });
    renderBar();
    await input();
    expect(screen.getByTestId('game-plan-art-budget-hint').textContent).not.toContain('25');
  });

  it.each([
    ['signed out', { account: { signedIn: false, availableCredits: null, maxCredits: null, imageCredits: 4 }, ownImageTool: false, suggestedCredits: 0 }],
    ['signed in but the balance cannot be read', { account: { signedIn: true, availableCredits: null, maxCredits: null, imageCredits: 4 }, ownImageTool: false, suggestedCredits: 0 }],
  ])('looks and approves as it did before when %s', async (_name, state) => {
    const { fetchMock, approveBody } = daemon(state);
    const { onApproved } = renderBar();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByTestId('game-plan-art-budget')).toBeNull();
    fireEvent.click(button()!);
    await waitFor(() => expect(onApproved).toHaveBeenCalled());
    expect(approveBody()).toEqual({});
  });

  it('asks the daemon nothing while the bar is closed', async () => {
    const { fetchMock } = daemon({ account: signedIn });
    renderBar({ streaming: true });
    await act(async () => {});
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
