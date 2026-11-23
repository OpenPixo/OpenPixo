// @vitest-environment jsdom
// The walkthrough's cards in the project page, one step at a time, and who sees them.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FirstRunGuidePrefs } from '@openpixo/contracts';
import { useProjectGuide, type ProjectGuide, type ProjectGuideInput } from '../../../src/components/first-run/ProjectGuide';
import type { GuideRun } from '../../../src/components/first-run/guide-state';
import { resetOpenPixoAccountStoreForTests } from '../../../src/hooks/useOpenPixoAccount';
import { I18nProvider } from '../../../src/i18n';
import { takeProjectComposerPrefill } from '../../../src/state/composer-prefill';
import { publishFirstRunGuide, readFirstRunGuide, resetFirstRunGuideForTests } from '../../../src/state/first-run-guide';
import type { AgentInfo, AppConfig, ChatMessage, Project } from '../../../src/types';
import { installAccountFetch, SIGNED_IN, SIGNED_OUT } from '../../helpers/account-fetch';

const sample: Project = { id: 'sample', name: 'Sample', createdAt: 1, updatedAt: 1, skillId: null,
  metadata: { kind: 'prototype', templateId: 'phaser3-sample-platformer' } as Project['metadata'] };
const own: Project = { id: 'own', name: 'Own', createdAt: 1, updatedAt: 1, skillId: null,
  metadata: { kind: 'prototype', gamePlan: { status: 'planning', startedAt: 1 } } as Project['metadata'] };
const config = { mode: 'daemon', agentId: null, apiKey: '', baseUrl: '', model: '' } as unknown as AppConfig;
const agents = [{ id: 'openpixo-agent', name: 'OpenPixo', available: true }] as unknown as AgentInfo[];
const message = (role: 'user' | 'assistant', content: string, runStatus?: ChatMessage['runStatus']) =>
  ({ id: `${role}-${content}`, role, content, ...(runStatus ? { runStatus } : {}) }) as ChatMessage;

let current: ProjectGuide;
const handlers = { onOpenPlans: vi.fn(), onSetUpAgent: vi.fn(), onNewGame: vi.fn() };

function Harness({ run = 'running', ...props }: Partial<ProjectGuideInput> & { run?: GuideRun }) {
  current = useProjectGuide({ project: sample, messages: [], messagesReady: true, running: false, agents, config, ...handlers, ...props });
  return <><div data-testid="game">{current.game?.render(run)}</div><div data-testid="chat">{current.chat}</div></>;
}

function show(props: Partial<ProjectGuideInput> & { run?: GuideRun } = {}, locale: 'en' | 'zh-CN' = 'en') {
  const element = (next: typeof props) => <I18nProvider initial={locale}><Harness {...next} /></I18nProvider>;
  const view = render(element(props));
  return { rerender: (next: typeof props) => view.rerender(element({ ...props, ...next })) };
}

const at = (step: FirstRunGuidePrefs['step'], over: Partial<FirstRunGuidePrefs> = {}) =>
  publishFirstRunGuide({ status: 'active', step, projectId: 'sample', ...over });
const routes = (account: unknown, available = 0) => installAccountFetch({
  'GET /api/openpixo/account': account,
  'GET /api/openpixo/credits': { available, reserved: 0, planCredits: 0, subscription: null },
  'PUT /api/app-config': (_url: URL, init?: RequestInit) => ({ config: JSON.parse(String(init?.body)) }),
});
const card = () => screen.getByTestId('first-run-guide');
const next = () => screen.getByTestId('first-run-guide-next');

beforeEach(() => {
  resetFirstRunGuideForTests();
  resetOpenPixoAccountStoreForTests();
  routes(SIGNED_IN);
});
afterEach(() => {
  cleanup();
  takeProjectComposerPrefill('sample');
  resetFirstRunGuideForTests();
  resetOpenPixoAccountStoreForTests();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('who sees the walkthrough', () => {
  it('shows nothing to a user who was never offered it, or in any other game', () => {
    show();
    expect(current.active).toBe(false);
    expect(current.game).toBeUndefined();
    act(() => at('play', { projectId: 'another' }));
    expect(current.active).toBe(false);
    expect(screen.queryByTestId('first-run-guide')).toBeNull();
  });

  it('ends for good when skipped, remembering the step', async () => {
    at('tune');
    show();
    fireEvent.click(screen.getByTestId('first-run-guide-skip'));
    expect(screen.queryByTestId('first-run-guide')).toBeNull();
    expect(readFirstRunGuide()).toMatchObject({ status: 'skipped', step: 'tune' });
  });
});

describe('playing and changing the game', () => {
  it('says how the game is doing before asking anyone to play it', () => {
    at('play');
    const view = show({ run: 'starting' });
    expect(card().textContent).toContain('The game is starting.');
    // Nothing to press while it starts; it cannot be played yet.
    expect(screen.queryByTestId('first-run-guide-next')).toBeNull();
    view.rerender({ run: 'stopped' });
    expect(card().textContent).toContain('Press Run to start the game.');
    view.rerender({ run: 'failed' });
    expect(card().getAttribute('data-tone')).toBe('problem');
    expect(card().textContent).toContain("The game didn't start.");
    view.rerender({ run: 'running' });
    expect(card().textContent).toContain('Click the game, then move with the arrow keys');
  });

  it('marks playing as done without moving on by itself, and keeps the controls on screen', () => {
    at('play');
    show();
    expect(current.game?.stageRing).toBeTruthy();
    act(() => current.game?.onPlayed?.());
    expect(card().getAttribute('data-tone')).toBe('done');
    expect(card().textContent).toContain('Arrow keys move, Space jumps.');
    expect(current.game?.stageRing).toBeNull();
    // Nothing waits for it any more, so the page stops looking.
    expect(current.game?.onPlayed).toBeNull();
    expect(readFirstRunGuide()).toMatchObject({ step: 'play' });
    fireEvent.click(next());
    expect(readFirstRunGuide()).toMatchObject({ step: 'tune' });
  });

  it('points at one setting until it is saved', () => {
    at('tune');
    show();
    expect(current.game?.tuning).toMatchObject({ key: 'jumpPower' });
    expect(current.game?.tuning?.ring).toBeTruthy();
    expect(card().textContent).toContain('This is free: no AI, no credits.');
    act(() => current.game?.onTuned());
    expect(card().getAttribute('data-tone')).toBe('done');
    // Still the setting 调参 opened for, no longer ringed.
    expect(current.game?.tuning).toEqual({ key: 'jumpPower', ring: '' });
    fireEvent.click(next());
    expect(readFirstRunGuide()).toMatchObject({ step: 'ask' });
    expect(current.game).toBeUndefined();
  });
});

describe('asking the AI', () => {
  it('asks for nothing about the account before this step', () => {
    const fetchMock = routes(SIGNED_IN, 600);
    at('tune');
    show();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/openpixo/'))).toBe(false);
  });

  it('puts the message in the composer once, when someone can answer it', async () => {
    routes(SIGNED_IN, 600);
    at('ask');
    show({}, 'zh-CN');
    await screen.findByText(/会花一点积分/);
    expect(takeProjectComposerPrefill('sample')?.text).toBe('让主角能二段跳：在空中再按一次跳，可以再跳一次。其他都不要动。');
    expect(takeProjectComposerPrefill('sample')).toBeUndefined();
    // The button puts it back for someone who cleared it.
    fireEvent.click(screen.getByTestId('first-run-guide-fill'));
    expect(takeProjectComposerPrefill('sample')?.text).toContain('二段跳');
  });

  it('leaves the composer alone where something was already said', async () => {
    routes(SIGNED_IN, 600);
    at('ask');
    show({ messages: [message('user', 'hi'), message('assistant', '', 'failed')] });
    await waitFor(() => expect(card().textContent).toContain("That didn't finish."));
    expect(takeProjectComposerPrefill('sample')).toBeUndefined();
  });

  it('offers plans instead of an empty wallet, and a way past', async () => {
    at('ask');
    show();
    await screen.findByText('The AI needs credits');
    expect(card().textContent).toContain('Playing and tuning stay free.');
    expect(takeProjectComposerPrefill('sample')).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: 'Choose a plan' }));
    expect(handlers.onOpenPlans).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByTestId('first-run-guide-later'));
    expect(readFirstRunGuide()).toMatchObject({ status: 'active', step: 'make' });
  });

  it('asks a signed-out user to sign in, and a build without accounts to set up an AI', async () => {
    routes(SIGNED_OUT);
    at('ask');
    const view = show();
    fireEvent.click(await screen.findByTestId('first-run-guide-fix'));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    cleanup();

    resetOpenPixoAccountStoreForTests();
    routes({ availability: 'not_configured', signedIn: false, user: null });
    show({ agents: [] });
    await screen.findByText('No AI is set up yet');
    fireEvent.click(screen.getByTestId('first-run-guide-fix'));
    expect(handlers.onSetUpAgent).toHaveBeenCalledOnce();
    void view;
  });

  it('does not mention credits to someone who uses their own AI', async () => {
    routes(SIGNED_OUT);
    at('ask');
    show({ agents: [{ id: 'codex', name: 'Codex', available: true }] as unknown as AgentInfo[] });
    await waitFor(() => expect(card().textContent).toContain('your own AI changes the game'));
    expect(card().textContent).not.toContain('credits');
  });

  it('follows the run to its end and waits there', () => {
    routes(SIGNED_IN, 600);
    at('ask');
    const view = show({ messages: [message('user', 'double jump')], running: true });
    expect(card().getAttribute('data-tone')).toBe('working');
    expect(card().textContent).toContain('The AI is changing the game.');
    view.rerender({ messages: [message('user', 'double jump'), message('assistant', 'Added.', 'succeeded')], running: false });
    expect(card().getAttribute('data-tone')).toBe('done');
    expect(readFirstRunGuide()).toMatchObject({ step: 'ask' });
    fireEvent.click(next());
    expect(card().textContent).toContain('Make your own game');
  });
});

describe('the end', () => {
  it('opens a new game, finished either way', () => {
    at('make');
    show();
    fireEvent.click(screen.getByTestId('first-run-guide-make'));
    expect(handlers.onNewGame).toHaveBeenCalledOnce();
    expect(readFirstRunGuide()).toMatchObject({ status: 'done' });
    cleanup();

    resetFirstRunGuideForTests();
    at('make');
    show();
    fireEvent.click(screen.getByTestId('first-run-guide-finish'));
    expect(handlers.onNewGame).toHaveBeenCalledOnce();
    expect(readFirstRunGuide()).toMatchObject({ status: 'done' });
  });

  it('then hints once in the user’s own game', async () => {
    publishFirstRunGuide({ status: 'done', step: 'make', projectId: 'sample' });
    show({ project: own, messages: [message('assistant', 'Step 1 of 5: gameplay', 'succeeded')] });
    expect(screen.getByTestId('first-run-hint').getAttribute('data-hint')).toBe('plan');
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(screen.queryByTestId('first-run-hint')).toBeNull();
    expect(readFirstRunGuide()).toMatchObject({ hintsSeen: ['plan'] });
  });
});
