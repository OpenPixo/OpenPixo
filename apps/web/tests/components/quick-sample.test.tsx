// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gameSetupMissingSteps, parseGameProjectSetup, type CheckGameTargetRequest, type CheckGameTargetResponse } from '@openpixo/contracts';
import { authorizeHostGameParent, isOpenPixoHostAvailable } from '@openpixo/host';
import { HomeDashboard } from '../../src/components/home/HomeDashboard';
import { EntryShell } from '../../src/components/EntryShell';
import { I18nProvider } from '../../src/i18n';
import { DEFAULT_CONFIG } from '../../src/state/config';

vi.mock('@openpixo/host', async importOriginal => ({
  ...await importOriginal<typeof import('@openpixo/host')>(),
  isOpenPixoHostAvailable: vi.fn(), authorizeHostGameParent: vi.fn(),
}));
vi.mock('../../src/components/useOpenFolderImport', () => ({
  useOpenFolderImport: () => ({ available: true, importing: false, error: null, openFolder: vi.fn() }),
}));
vi.mock('../../src/components/HomeView', () => ({ HomeView: () => null }));
vi.mock('../../src/components/NewGameDialog', () => ({
  NewGameDialog: ({ initialTemplateId }: { initialTemplateId?: string }) =>
    <div role="dialog" aria-label="New game">{initialTemplateId}</div>,
}));
vi.mock('../../src/components/onboarding/OnboardingView', () => ({
  OnboardingView: ({ onFinish, onStartSample }: { onFinish: () => void; onStartSample: () => void }) =>
    <button onClick={() => { onFinish(); onStartSample(); }}>Open a sample game</button>,
}));

const sample = { id: 'phaser3-sample-platformer', name: 'Sample: pixel platformer', engine: 'phaser', description: 'Ready to play' };
const parentDir = 'C:\\Games';
const created = { project: { id: 'sample-project', name: 'pixel-platformer', skillId: null, createdAt: 1, updatedAt: 1 },
  conversationId: 'sample-conversation', entryFile: 'index.html', git: { status: 'skipped', reasonCode: 'GIT_MISSING' } };
const opened = { ok: true, projectId: 'sample-project', conversationId: 'sample-conversation', entryFile: 'index.html' };

function network({ check, create }: {
  check?: (input: CheckGameTargetRequest, count: number) => CheckGameTargetResponse;
  create?: () => Promise<Response>;
} = {}) {
  let count = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/game-templates') return Response.json({ templates: [sample], defaultParentDir: parentDir });
    if (url.endsWith('/game-from-template/check')) return Response.json(check?.(JSON.parse(String(init?.body)), ++count) ?? { status: 'available' });
    if (url.endsWith('/game-from-template')) return create ? create() : Response.json(created);
    return Response.json({});
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function home() {
  const onCreated = vi.fn();
  render(<I18nProvider initial="en"><HomeDashboard projects={[]} onOpenProject={vi.fn()} onImportFolderResponse={onCreated}>{null}</HomeDashboard></I18nProvider>);
  return onCreated;
}

function onboarding() {
  window.history.replaceState(null, '', '/onboarding');
  const onCreated = vi.fn();
  render(<I18nProvider initial="en"><EntryShell config={DEFAULT_CONFIG} agents={[]} daemonLive skills={[]} projects={[]} promptTemplates={[]}
    onModeChange={vi.fn()} onAgentChange={vi.fn()} onAgentModelChange={vi.fn()} onApiProtocolChange={vi.fn()} onApiModelChange={vi.fn()}
    onConfigPersist={vi.fn()} onRefreshAgents={vi.fn(() => [])} onCreateProject={vi.fn()}
    onBeginProjectCreation={() => ({ projectId: 'unused', rollback: () => {} })} onCreatePluginShareProject={vi.fn()}
    onOpenProject={vi.fn()} onDeleteProject={vi.fn()} onRenameProject={vi.fn()} onOpenSettings={vi.fn()}
    onCompleteOnboarding={vi.fn()} onImportFolderResponse={onCreated}
  /></I18nProvider>);
  return onCreated;
}

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  vi.mocked(isOpenPixoHostAvailable).mockReturnValue(false);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetAllMocks(); window.history.replaceState(null, '', '/'); });

describe('one-click sample', () => {
  it('creates and opens the Home sample with its defaults, without a wizard or agent kickoff', async () => {
    const fetchMock = network();
    const onCreated = home();
    fireEvent.click(await screen.findByRole('button', { name: /Sample: pixel platformer/ }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(opened));
    const request = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/game-from-template'))?.[1];
    const body = JSON.parse(String(request?.body));
    expect(body).toEqual({ templateId: sample.id, parentDir, name: 'pixel-platformer', createParent: true,
      setup: { title: 'Pixel Platformer', genre: 'platformer', perspective: 'side-2d', players: ['single'], scope: 'quick',
        release: { languages: ['en'] }, platforms: ['web'], art: { styleId: 'pixel-16-bit' },
        display: { width: 800, height: 450, scaling: 'fit' }, controls: ['keyboard'] } });
    expect(parseGameProjectSetup(body.setup)).toEqual({ ok: true, setup: body.setup });
    // A complete setup: the project opens without a "finish setup" card.
    expect(gameSetupMissingSteps(body.setup)).toEqual([]);
    expect(sessionStorage.getItem('pixo:auto-send-first:sample-project')).toBeNull();
    expect(sessionStorage.getItem('pixo:auto-send-prompt:sample-project')).toBeNull();
  });

  it('uses -2 when the readable template name already exists', async () => {
    const fetchMock = network({ check: (_, count) => ({ status: count === 1 ? 'exists' : 'available' }) });
    const onCreated = home();
    fireEvent.click(await screen.findByRole('button', { name: /Sample: pixel platformer/ }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(opened));
    const request = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/game-from-template'))?.[1];
    expect(JSON.parse(String(request?.body)).name).toBe('pixel-platformer-2');
  });

  it('prefers the remembered parent', async () => {
    localStorage.setItem('pixo:new-game-parent', 'D:\\My Games');
    const fetchMock = network();
    const onCreated = home();
    fireEvent.click(await screen.findByRole('button', { name: /Sample: pixel platformer/ }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(opened));
    const request = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/game-from-template'))?.[1];
    expect(JSON.parse(String(request?.body)).parentDir).toBe('D:\\My Games');
  });

  it('falls back to the default games folder when the desktop host refuses a remembered parent', async () => {
    localStorage.setItem('pixo:new-game-parent', 'D:\\My Games');
    vi.mocked(isOpenPixoHostAvailable).mockReturnValue(true);
    vi.mocked(authorizeHostGameParent).mockImplementation(async dir => dir === parentDir
      ? { ok: true, baseDir: parentDir, token: 'authorized-token' }
      : { ok: false, reason: 'Choose this parent with the folder picker first' });
    const fetchMock = network();
    const onCreated = home();
    fireEvent.click(await screen.findByRole('button', { name: /Sample: pixel platformer/ }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(opened));
    expect(authorizeHostGameParent).toHaveBeenNthCalledWith(1, 'D:\\My Games');
    expect(authorizeHostGameParent).toHaveBeenNthCalledWith(2, parentDir);
    const request = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/game-from-template'))?.[1];
    expect(JSON.parse(String(request?.body)).parentDir).toBe(parentDir);
  });

  it('authorizes an unpicked desktop parent and sends the token header on check and create', async () => {
    vi.mocked(isOpenPixoHostAvailable).mockReturnValue(true);
    vi.mocked(authorizeHostGameParent).mockResolvedValue({ ok: true, baseDir: parentDir, token: 'authorized-token' });
    const fetchMock = network();
    const onCreated = home();
    fireEvent.click(await screen.findByRole('button', { name: /Sample: pixel platformer/ }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(opened));
    expect(authorizeHostGameParent).toHaveBeenCalledWith(parentDir);
    const requests = fetchMock.mock.calls.filter(([url]) => String(url).includes('/game-from-template'));
    expect(requests).toHaveLength(2);
    for (const [, init] of requests) expect(init?.headers).toMatchObject({ 'x-pixo-desktop-import-token': 'authorized-token' });
  });

  it('falls back to the wizard with the sample preselected when creation fails', async () => {
    network({ create: async () => Response.json({ error: { message: 'disk full' } }, { status: 500 }) });
    const onCreated = home();
    fireEvent.click(await screen.findByRole('button', { name: /Sample: pixel platformer/ }));
    expect((await screen.findByRole('dialog')).textContent).toBe(sample.id);
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('falls back without creating when the preflight rejects the parent', async () => {
    const fetchMock = network({ check: () => ({ status: 'invalid-parent', reasonCode: 'PARENT_NOT_FOUND' }) });
    home();
    fireEvent.click(await screen.findByRole('button', { name: /Sample: pixel platformer/ }));
    await screen.findByRole('dialog');
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/game-from-template/check'))).toHaveLength(1);
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/game-from-template'))).toBe(false);
  });

  it('caps name collisions at twenty attempts before opening the wizard', async () => {
    const fetchMock = network({ check: () => ({ status: 'exists' }) });
    home();
    fireEvent.click(await screen.findByRole('button', { name: /Sample: pixel platformer/ }));
    await screen.findByRole('dialog');
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/game-from-template/check'))).toHaveLength(20);
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/game-from-template'))).toBe(false);
  });

  it('marks the sample card busy and prevents a duplicate creation', async () => {
    let complete!: (response: Response) => void;
    const fetchMock = network({ create: () => new Promise(resolve => { complete = resolve; }) });
    const onCreated = home();
    const card = await screen.findByRole('button', { name: /Sample: pixel platformer/ });
    fireEvent.click(card);
    expect(card.getAttribute('aria-busy')).toBe('true');
    expect((card as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(card);
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/game-from-template'))).toHaveLength(1));
    await act(async () => { complete(Response.json(created)); });
    expect(onCreated).toHaveBeenCalledOnce();
  });

  it('creates and opens the onboarding sample without a wizard', async () => {
    network();
    const onCreated = onboarding();
    fireEvent.click(screen.getByRole('button', { name: 'Open a sample game' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(opened));
  });

  it('falls back to the preselected sample wizard from onboarding', async () => {
    network({ create: async () => { throw new Error('offline'); } });
    const onCreated = onboarding();
    fireEvent.click(screen.getByRole('button', { name: 'Open a sample game' }));
    expect((await screen.findByRole('dialog')).textContent).toBe(sample.id);
    expect(onCreated).not.toHaveBeenCalled();
  });
});
