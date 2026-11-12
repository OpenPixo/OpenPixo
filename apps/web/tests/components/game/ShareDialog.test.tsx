// @vitest-environment jsdom
// The Share dialog against the daemon routes in specs/current/publish-and-rooms.md, stubbed at fetch.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublishedGame, PublishJob, PublishStatusResponse, RoomsStatusResponse, RoomsUsage } from '@openpixo/contracts';

import { ShareDialog } from '../../../src/components/game/ShareDialog';
import { resetOpenPixoAccountStoreForTests } from '../../../src/hooks/useOpenPixoAccount';
import { I18nProvider } from '../../../src/i18n';
import { en } from '../../../src/i18n/locales/en';
import { zhCN } from '../../../src/i18n/locales/zh-CN';
import type { Locale } from '../../../src/i18n/types';
import { clearProjectComposerPrefill, takeProjectComposerPrefill } from '../../../src/state/composer-prefill';

const { openExternalUrl, copyToClipboard } = vi.hoisted(() => ({
  openExternalUrl: vi.fn(async (_url: string) => true),
  copyToClipboard: vi.fn(async (_text: string) => true),
}));
vi.mock('../../../src/providers/registry', () => ({ openExternalUrl }));
vi.mock('../../../src/lib/copy-to-clipboard', () => ({ copyToClipboard }));
vi.mock('../../../src/components/account/SignInDialog', () => ({
  SignInDialog: ({ open, onClose }: { open: boolean; onClose: () => void }) => open ? <button onClick={onClose}>Finish signing in</button> : null,
}));

const game = (over: Partial<PublishedGame> = {}): PublishedGame => ({
  shareId: 's1', url: 'https://play.example/s1', title: 'Slime Dash', version: 2, state: 'live',
  publishedAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-02T00:00:00Z', playsThisMonth: 3, ...over,
});
const job = (over: Partial<PublishJob> = {}): PublishJob => ({
  id: 'j1', phase: 'building', filesDone: 0, filesTotal: 0, startedAt: '2026-11-04T00:00:00Z', ...over,
});
const status = (over: Partial<PublishStatusResponse> = {}): PublishStatusResponse => ({
  available: true, game: null, job: null, termsAccepted: true, termsUrl: 'https://rules.example/sharing', ...over,
});
const usage = (over: Partial<RoomsUsage> = {}): RoomsUsage => ({
  month: '2026-11', freeMinutesTotal: 720, freeMinutesUsed: 270, playerMinutes: 900, creditsCharged: 37, monthlyCreditLimit: 250, openRooms: 2, ...over,
});
const rooms = (over: Partial<RoomsStatusResponse> = {}): RoomsStatusResponse => ({
  sdkInstalled: false, usage: null, paused: false, maxPlayers: 8, creditsPerPlayerHour: 9, ...over,
});

type Route = (method: string, init?: RequestInit) => Response | undefined;
interface Daemon {
  status: PublishStatusResponse;
  rooms: RoomsStatusResponse;
  routes: Record<string, Route>;
}
let daemon: Daemon;
let fetchMock: ReturnType<typeof vi.fn>;

function stubDaemon(next: Partial<PublishStatusResponse> = {}, nextRooms: Partial<RoomsStatusResponse> = {}, routes: Record<string, Route> = {}) {
  daemon = { status: status(next), rooms: rooms(nextRooms), routes };
}
const calls = (suffix: string, method = 'GET') => fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith(suffix) && ((init as RequestInit | undefined)?.method ?? 'GET') === method);
const bodyOf = (call: unknown[] | undefined) => JSON.parse(String((call?.[1] as RequestInit).body)) as unknown;

beforeEach(() => {
  vi.useFakeTimers();
  openExternalUrl.mockReset();
  openExternalUrl.mockImplementation(async () => true);
  copyToClipboard.mockReset();
  copyToClipboard.mockImplementation(async () => true);
  clearProjectComposerPrefill('game');
  resetOpenPixoAccountStoreForTests();
  stubDaemon();
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    const method = init?.method ?? 'GET';
    const route = Object.entries(daemon.routes).find(([suffix]) => path.endsWith(suffix));
    const handled = route?.[1](method, init);
    if (handled) return handled;
    if (path.endsWith('/publish') && method === 'GET') return Response.json(daemon.status);
    if (path.endsWith('/rooms') && method === 'GET') return Response.json(daemon.rooms);
    return new Response('not found', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const flush = async () => { await act(async () => {}); };
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

function dialogElement(props: { open?: boolean; onClose?: () => void; onOpenAccount?: () => void; projectName?: string } = {}, locale: Locale = 'en') {
  return <I18nProvider initial={locale}>
    <ShareDialog projectId="game" projectName={'projectName' in props ? props.projectName : 'Slime Dash'} open={props.open ?? true} onClose={props.onClose ?? vi.fn()} onOpenAccount={props.onOpenAccount} />
  </I18nProvider>;
}
async function openDialog(props: Parameters<typeof dialogElement>[0] = {}, locale: Locale = 'en') {
  const view = render(dialogElement(props, locale));
  await flush();
  return { ...view, setOpen: (open: boolean) => view.rerender(dialogElement({ ...props, open }, locale)) };
}
const dialog = () => within(screen.getByRole('dialog'));
const shareView = () => document.querySelector('[data-share-view]')?.getAttribute('data-share-view');

describe('link states', () => {
  it('asks a signed-out creator to sign in, then re-reads status', async () => {
    stubDaemon({ available: false, unavailableReason: 'signed_out' });
    await openDialog();
    expect(screen.getByText('You need to sign in to create a link.')).toBeTruthy();
    expect(screen.queryByTestId('share-publish')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    stubDaemon();
    fireEvent.click(screen.getByRole('button', { name: 'Finish signing in' }));
    await flush();
    expect(shareView()).toBe('form');
  });

  it.each(['paused', 'no_cloud'] as const)('says sharing is not open when %s, and still offers Play together', async unavailableReason => {
    stubDaemon({ available: false, unavailableReason });
    await openDialog();
    expect(screen.getByText("Sharing isn't open yet.")).toBeTruthy();
    expect(screen.queryByTestId('share-publish')).toBeNull();
    expect(screen.getByTestId('share-play')).toBeTruthy();
  });

  it('explains a publish and requires the rules before it', async () => {
    stubDaemon({ termsAccepted: false }, {}, {
      '/publish': (method) => method === 'POST' ? Response.json({ job: job() }) : undefined,
    });
    await openDialog();
    const title = dialog().getByRole('textbox', { name: 'Game title' }) as HTMLInputElement;
    expect(title.value).toBe('Slime Dash');
    expect(title.maxLength).toBe(80);
    expect(screen.getByText("Anyone with the link can play. It won't be listed anywhere.")).toBeTruthy();
    expect((screen.getByRole('link', { name: 'sharing rules' }) as HTMLAnchorElement).href).toBe('https://rules.example/sharing');
    const publish = screen.getByTestId('share-publish') as HTMLButtonElement;
    expect(publish.disabled).toBe(true);
    fireEvent.submit(publish.closest('form')!);
    expect(calls('/publish', 'POST')).toHaveLength(0);
    fireEvent.click(screen.getByTestId('share-terms'));
    expect(publish.disabled).toBe(false);
    fireEvent.change(title, { target: { value: '  Blob Run ' } });
    fireEvent.click(publish);
    await flush();
    expect(bodyOf(calls('/publish', 'POST')[0])).toEqual({ title: 'Blob Run', acceptTerms: true });
    expect(shareView()).toBe('publishing');
  });

  it('opens the rules through the app and skips them once accepted', async () => {
    stubDaemon({ termsAccepted: false });
    const view = await openDialog();
    fireEvent.click(screen.getByRole('link', { name: 'sharing rules' }));
    expect(openExternalUrl).toHaveBeenCalledWith('https://rules.example/sharing');
    expect((screen.getByTestId('share-terms') as HTMLInputElement).checked).toBe(false);
    view.unmount();
    stubDaemon({ termsAccepted: true });
    await openDialog();
    expect(screen.queryByTestId('share-terms')).toBeNull();
    expect((screen.getByTestId('share-publish') as HTMLButtonElement).disabled).toBe(false);
  });

  it('needs a title', async () => {
    await openDialog({ projectName: undefined });
    expect((screen.getByTestId('share-publish') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(dialog().getByRole('textbox', { name: 'Game title' }), { target: { value: '   ' } });
    expect((screen.getByTestId('share-publish') as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows real progress from the job, announcing phases but not every file', async () => {
    stubDaemon({ job: job({ phase: 'building' }) });
    await openDialog();
    const steps = () => within(screen.getByTestId('share-progress')).getAllByRole('listitem');
    expect(steps().map(step => step.getAttribute('data-state'))).toEqual(['current', 'pending', 'pending', 'pending']);
    expect(steps().map(step => step.textContent)).toEqual(['Building', 'Checking', 'Uploading', 'Finishing']);
    expect(screen.getByTestId('share-progress-live').textContent).toBe('Building');
    expect(screen.getByTestId('share-progress-live').getAttribute('role')).toBe('status');
    expect(screen.getByText('You can close this window. Publishing keeps going.')).toBeTruthy();

    daemon.status = status({ job: job({ phase: 'uploading', filesDone: 3, filesTotal: 40 }) });
    await advance(1_000);
    expect(steps()[2]?.textContent).toBe('Uploading 3 of 40');
    expect(steps()[2]?.getAttribute('aria-current')).toBe('step');
    expect(screen.getByTestId('share-progress-live').textContent).toBe('Uploading');

    daemon.status = status({ job: job({ phase: 'activating', filesDone: 40, filesTotal: 40 }) });
    await advance(1_000);
    expect(steps()[3]?.textContent).toBe('Finishing');
    expect(steps()[3]?.getAttribute('data-state')).toBe('current');

    daemon.status = status({ job: job({ phase: 'done' }), game: game() });
    daemon.rooms = rooms({ sdkInstalled: true, usage: usage() });
    const roomReads = calls('/rooms').length;
    await advance(1_000);
    expect(shareView()).toBe('live');
    expect(calls('/rooms').length).toBe(roomReads + 1);
    const reads = calls('/publish').length;
    await advance(5_000);
    expect(calls('/publish').length).toBe(reads);
  });

  it('stops watching when closed and shows the same job on reopening', async () => {
    stubDaemon({ job: job({ phase: 'uploading', filesDone: 1, filesTotal: 10 }) });
    const view = await openDialog();
    view.setOpen(false);
    await advance(200);
    const reads = calls('/publish').length;
    await advance(5_000);
    expect(calls('/publish').length).toBe(reads);
    expect(calls('/publish', 'DELETE')).toHaveLength(0);
    daemon.status = status({ job: job({ phase: 'uploading', filesDone: 7, filesTotal: 10 }) });
    view.setOpen(true);
    await flush();
    expect(within(screen.getByTestId('share-progress')).getByText('Uploading 7 of 10')).toBeTruthy();
  });

  it('says so when progress cannot be refreshed, and recovers', async () => {
    stubDaemon({ job: job() });
    await openDialog();
    daemon.routes = { '/publish': () => new Response('down', { status: 500 }) };
    await advance(1_000);
    expect(screen.getByText("Can't get the latest progress right now. Still trying.")).toBeTruthy();
    daemon.routes = {};
    await advance(1_000);
    expect(screen.queryByText("Can't get the latest progress right now. Still trying.")).toBeNull();
  });

  it('keeps focus inside when the pressed button is replaced', async () => {
    stubDaemon({}, {}, { '/publish': method => method === 'POST' ? Response.json({ job: job() }) : undefined });
    await openDialog();
    const publish = screen.getByTestId('share-publish');
    publish.focus();
    fireEvent.click(publish);
    await flush();
    expect(screen.queryByTestId('share-publish')).toBeNull();
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });

  it('shows the link with Copy, Open and a reminder', async () => {
    stubDaemon({ game: game() });
    await openDialog();
    expect((screen.getByTestId('share-link') as HTMLInputElement).value).toBe('https://play.example/s1');
    expect(screen.getByText('Anyone with the link can play.')).toBeTruthy();
    fireEvent.click(screen.getByTestId('share-open'));
    await flush();
    expect(openExternalUrl).toHaveBeenCalledWith('https://play.example/s1');
  });

  it('copies the link and says so briefly', async () => {
    stubDaemon({ game: game() });
    await openDialog();
    fireEvent.click(screen.getByTestId('share-copy'));
    await flush();
    expect(copyToClipboard).toHaveBeenCalledWith('https://play.example/s1');
    expect(screen.getByTestId('share-copy').textContent).toBe('Copied');
    expect(screen.getByText('Link copied').getAttribute('role')).toBe('status');
    await advance(1_500);
    expect(screen.getByTestId('share-copy').textContent).toBe('Copy');
  });

  it('says when copying failed', async () => {
    copyToClipboard.mockImplementation(async () => false);
    stubDaemon({ game: game() });
    await openDialog();
    fireEvent.click(screen.getByTestId('share-copy'));
    await flush();
    expect(screen.getByRole('alert').textContent).toBe("Couldn't copy the link. Select it and copy it yourself.");
    expect(screen.getByTestId('share-copy').textContent).toBe('Copy');
  });

  it('says when the link could not be opened', async () => {
    openExternalUrl.mockImplementation(async () => false);
    stubDaemon({ game: game() });
    await openDialog();
    fireEvent.click(screen.getByTestId('share-open'));
    await flush();
    expect(screen.getByRole('alert').textContent).toContain("Couldn't open the link.");
  });

  it('updates the same link', async () => {
    stubDaemon({ game: game() }, {}, { '/publish': method => method === 'POST' ? Response.json({ job: job() }) : undefined });
    await openDialog();
    fireEvent.click(screen.getByTestId('share-update'));
    await flush();
    expect(bodyOf(calls('/publish', 'POST')[0])).toEqual({ title: 'Slime Dash' });
    expect(shareView()).toBe('publishing');
  });

  it('removes a link only after a confirm that explains it stops working', async () => {
    stubDaemon({ game: game() }, {}, { '/publish': method => {
      if (method !== 'DELETE') return undefined;
      daemon.status = status();
      return Response.json({ ok: true });
    } });
    await openDialog();
    fireEvent.click(screen.getByTestId('share-remove'));
    await flush();
    const confirm = within(screen.getByRole('alertdialog'));
    expect(confirm.getByText(/stops working for everyone/)).toBeTruthy();
    expect(calls('/publish', 'DELETE')).toHaveLength(0);
    fireEvent.click(confirm.getByRole('button', { name: 'Cancel' }));
    await advance(200);
    expect(calls('/publish', 'DELETE')).toHaveLength(0);
    expect(screen.queryByRole('alertdialog')).toBeNull();

    fireEvent.click(screen.getByTestId('share-remove'));
    await flush();
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove link' }));
    await advance(200);
    expect(calls('/publish', 'DELETE')).toHaveLength(1);
    expect(shareView()).toBe('form');
  });

  it('shows why removing failed and keeps the link', async () => {
    stubDaemon({ game: game() }, {}, { '/publish': method => method === 'DELETE'
      ? Response.json({ error: { code: 'CLOUD_UNAVAILABLE', message: 'The cloud is unreachable.' } }, { status: 503 }) : undefined });
    await openDialog();
    fireEvent.click(screen.getByTestId('share-remove'));
    await flush();
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove link' }));
    await advance(200);
    expect(screen.getByTestId('share-action-error').textContent).toBe('The cloud is unreachable.');
    expect(shareView()).toBe('live');
  });

  it('hides Update while paused but keeps the link', async () => {
    stubDaemon({ available: false, unavailableReason: 'paused', game: game() });
    await openDialog();
    expect(screen.getByTestId('share-link')).toBeTruthy();
    expect(screen.queryByTestId('share-update')).toBeNull();
    expect(screen.getByText("Updates aren't open right now. Your link still works.")).toBeTruthy();
  });

  it('says a game is under review, with the reason, and still shows the link', async () => {
    stubDaemon({ game: game({ state: 'under_review', removedReason: 'Many plays in one day' }) });
    await openDialog();
    expect(screen.getByText('This game is under review')).toBeTruthy();
    expect(screen.getByText('Reason: Many plays in one day')).toBeTruthy();
    expect((screen.getByTestId('share-link') as HTMLInputElement).value).toBe('https://play.example/s1');
  });

  it('says a game was removed, with the reason, and offers no link', async () => {
    stubDaemon({ game: game({ state: 'removed', removedReason: 'Reported for copied art' }) });
    await openDialog();
    expect(screen.getByText('This game was removed')).toBeTruthy();
    expect(screen.getByText('Reason: Reported for copied art')).toBeTruthy();
    expect(screen.queryByTestId('share-link')).toBeNull();
    expect(screen.queryByTestId('share-update')).toBeNull();
    expect(screen.queryByTestId('share-remove')).toBeNull();
  });

  it('shows a failure with the job message, the refused files and a retry', async () => {
    stubDaemon({
      job: job({ phase: 'failed', error: { code: 'PUBLISH_REFUSED', message: 'Some files cannot go on a public link.' }, refusedFiles: ['tools/setup.exe', 'run.bat'] }),
    }, {}, { '/publish': method => method === 'POST' ? Response.json({ job: job({ id: 'j2' }) }) : undefined });
    await openDialog();
    expect(screen.getByTestId('share-failed').textContent).toContain('Some files cannot go on a public link.');
    expect(within(screen.getByTestId('share-refused')).getAllByRole('listitem').map(item => item.textContent)).toEqual(['tools/setup.exe', 'run.bat']);
    fireEvent.click(screen.getByTestId('share-retry'));
    await flush();
    expect(bodyOf(calls('/publish', 'POST')[0])).toEqual({ title: 'Slime Dash' });
    expect(shareView()).toBe('publishing');
  });

  it('falls back when a failed job has no message, and goes back to the link', async () => {
    stubDaemon({ game: game(), job: job({ phase: 'failed' }) });
    await openDialog();
    expect(screen.getByText('Something went wrong while publishing.')).toBeTruthy();
    expect(screen.getByText('Your existing link still works.')).toBeTruthy();
    expect(screen.getByTestId('share-link')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(shareView()).toBe('live');
  });

  it('shows what a refused start says, then the status it refers to', async () => {
    stubDaemon({}, {}, { '/publish': method => method === 'POST'
      ? Response.json({ error: { code: 'PUBLISH_REFUSED', message: 'Refused files', refusedFiles: ['a.exe'] } }, { status: 422 }) : undefined });
    await openDialog();
    fireEvent.click(screen.getByTestId('share-publish'));
    await flush();
    expect(screen.getByTestId('share-action-error').textContent).toContain('Refused files');
    expect(within(screen.getByTestId('share-refused')).getByText('a.exe')).toBeTruthy();
    expect(calls('/publish').length).toBeGreaterThanOrEqual(2);
  });

  it('asks for the rules again when a publish is refused for them', async () => {
    stubDaemon({ job: job({ phase: 'failed', error: { code: 'SHARE_TERMS_REQUIRED', message: 'Accept the sharing rules' } }), termsAccepted: false });
    await openDialog();
    expect(shareView()).toBe('form');
    expect(screen.getByTestId('share-terms')).toBeTruthy();
  });

  it('says something generic when the API gave no words, and offers another read', async () => {
    stubDaemon({}, {}, { '/publish': () => new Response('down', { status: 500 }), '/rooms': () => new Response('down', { status: 500 }) });
    await openDialog();
    expect(shareView()).toBe('unreachable');
    expect(screen.queryByTestId('share-play')).toBeNull();
    stubDaemon({ game: game() });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await flush();
    expect(shareView()).toBe('live');
  });

  it('still offers the local test when only the link cannot be read', async () => {
    stubDaemon({}, { sdkInstalled: true }, { '/publish': () => new Response('down', { status: 500 }) });
    await openDialog();
    expect(shareView()).toBe('unreachable');
    expect(screen.getByTestId('share-test')).toBeTruthy();
  });

  it('reads nothing while it has never been opened', async () => {
    render(dialogElement({ open: false }));
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('Play together', () => {
  it('offers the AI a prefilled request when multiplayer is not in the game, without sending it', async () => {
    const onClose = vi.fn();
    const view = await openDialog({ onClose });
    expect(screen.getByText('Let friends who open your link play in the same live match.')).toBeTruthy();
    fireEvent.click(screen.getByTestId('share-ask-ai'));
    expect(onClose).toHaveBeenCalledTimes(1);
    // The draft waits for the dialog to let go of focus, so the composer can take it.
    expect(takeProjectComposerPrefill('game')).toBeUndefined();
    view.setOpen(false);
    await advance(200);
    expect(takeProjectComposerPrefill('game')?.text).toBe('Add live multiplayer to this game with pixo rooms: a lobby with create and join-by-link, then test it with pixo rooms test.');
    expect(fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toHaveLength(0);
  });

  it('opens the two test windows through the app', async () => {
    const urls = ['http://127.0.0.1:5173/?pixoRooms=http%3A%2F%2F127.0.0.1%3A7456', 'http://127.0.0.1:5173/?pixoRooms=http%3A%2F%2F127.0.0.1%3A7456&p=2'];
    stubDaemon({}, { sdkInstalled: true }, { '/rooms/test': () => Response.json({ urls, relayUrl: 'http://127.0.0.1:7456' }) });
    await openDialog();
    fireEvent.click(screen.getByTestId('share-test'));
    await flush();
    expect(openExternalUrl.mock.calls.map(([url]) => url)).toEqual(urls);
    expect(screen.queryByTestId('share-test-unopened')).toBeNull();
  });

  it('lists the addresses when a window could not open', async () => {
    const urls = ['http://127.0.0.1:5173/?a', 'http://127.0.0.1:5173/?b'];
    openExternalUrl.mockImplementation(async url => url.endsWith('a'));
    stubDaemon({}, { sdkInstalled: true }, { '/rooms/test': () => Response.json({ urls, relayUrl: 'x' }) });
    await openDialog();
    fireEvent.click(screen.getByTestId('share-test'));
    await flush();
    const unopened = within(screen.getByTestId('share-test-unopened'));
    expect(unopened.getAllByRole('listitem').map(item => item.textContent)).toEqual(['http://127.0.0.1:5173/?b']);
  });

  it('never opens a test address that is not this computer', async () => {
    stubDaemon({}, { sdkInstalled: true }, { '/rooms/test': () => Response.json({ urls: ['https://evil.example/', 'http://127.0.0.1:1/'], relayUrl: 'x' }) });
    await openDialog();
    fireEvent.click(screen.getByTestId('share-test'));
    await flush();
    expect(openExternalUrl).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe("That didn't work. Try again.");
  });

  it('opens one address twice and lists it once when it cannot open', async () => {
    const url = 'http://127.0.0.1:5173/?pixoRooms=x';
    openExternalUrl.mockImplementation(async () => false);
    stubDaemon({}, { sdkInstalled: true }, { '/rooms/test': () => Response.json({ urls: [url, url], relayUrl: 'x' }) });
    await openDialog();
    fireEvent.click(screen.getByTestId('share-test'));
    await flush();
    expect(openExternalUrl).toHaveBeenCalledTimes(2);
    expect(within(screen.getByTestId('share-test-unopened')).getAllByRole('listitem').map(item => item.textContent)).toEqual([url]);
  });

  it('shows the daemon\'s words when the game could not start for a test', async () => {
    stubDaemon({}, { sdkInstalled: true }, { '/rooms/test': () => Response.json({ error: { code: 'CONFLICT', message: 'The game could not start for a test.' } }, { status: 409 }) });
    await openDialog();
    fireEvent.click(screen.getByTestId('share-test'));
    await flush();
    expect(screen.getByRole('alert').textContent).toBe('The game could not start for a test.');
    expect((screen.getByTestId('share-test') as HTMLButtonElement).disabled).toBe(false);
  });

  it('takes every number from the API', async () => {
    stubDaemon({ game: game() }, { sdkInstalled: true, usage: usage() });
    await openDialog();
    const panel = within(screen.getByTestId('share-usage'));
    const value = (label: string) => panel.getByText(label).parentElement?.querySelector('dd')?.textContent;
    expect(value('Free hours left this month')).toBe('7.5 of 12');
    expect(value('Credits this game used this month')).toBe('37');
    expect(value('Open rooms')).toBe('2');
    expect((screen.getByTestId('share-limit') as HTMLInputElement).value).toBe('250');
    expect(screen.getByText('New rooms stop when this game reaches its limit.')).toBeTruthy();
    expect(screen.getByTestId('share-price').textContent).toBe('12 free player-hours a month, then 9 credits per player-hour');
    expect(screen.getByText("One player hosts each match, so it isn't suited to ranked or prize play.")).toBeTruthy();
    expect(screen.queryByTestId('share-limit-reached')).toBeNull();
    expect(screen.queryByTestId('share-get-credits')).toBeNull();
  });

  it('shows no usage or invented free hours before there is a link', async () => {
    stubDaemon({}, { sdkInstalled: true, usage: null });
    await openDialog();
    expect(screen.queryByTestId('share-usage')).toBeNull();
    expect(screen.getByTestId('share-price').textContent).toBe('Free player-hours each month, then 9 credits per player-hour');
  });

  it('says when the limit is reached and offers credits when free hours run out', async () => {
    const onOpenAccount = vi.fn();
    const onClose = vi.fn();
    stubDaemon({ game: game() }, { sdkInstalled: true, usage: usage({ freeMinutesUsed: 720, creditsCharged: 250 }) });
    const view = await openDialog({ onClose, onOpenAccount });
    expect(screen.getByTestId('share-limit-reached')).toBeTruthy();
    fireEvent.click(screen.getByTestId('share-get-credits'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onOpenAccount).not.toHaveBeenCalled();
    view.setOpen(false);
    await advance(200);
    expect(onOpenAccount).toHaveBeenCalledTimes(1);
  });

  it.each(['', 'abc', '-5', '1.5'])('refuses a limit of %j without calling the daemon', async input => {
    stubDaemon({ game: game() }, { sdkInstalled: true, usage: usage() });
    await openDialog();
    const field = screen.getByTestId('share-limit');
    fireEvent.change(field, { target: { value: input } });
    fireEvent.submit(field.closest('form')!);
    await flush();
    expect(screen.getByTestId('share-limit-invalid').textContent).toBe('Enter a whole number of credits, from 0 to 10,000,000.');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(calls('/rooms', 'PATCH')).toHaveLength(0);
    fireEvent.change(field, { target: { value: '300' } });
    expect(screen.queryByTestId('share-limit-invalid')).toBeNull();
  });

  it('saves a limit, re-reads usage and reports refusals', async () => {
    stubDaemon({ game: game() }, { sdkInstalled: true, usage: usage() }, { '/rooms': (method) => {
      if (method !== 'PATCH') return undefined;
      daemon.rooms = rooms({ sdkInstalled: true, usage: usage({ monthlyCreditLimit: 300 }) });
      return Response.json({ usage: daemon.rooms.usage });
    } });
    await openDialog();
    const field = screen.getByTestId('share-limit') as HTMLInputElement;
    const save = screen.getByTestId('share-limit-save') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(field, { target: { value: '300' } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await flush();
    expect(bodyOf(calls('/rooms', 'PATCH')[0])).toEqual({ monthlyCreditLimit: 300 });
    expect(screen.getByText('Limit saved').getAttribute('role')).toBe('status');
    expect(field.value).toBe('300');

    daemon.routes = { '/rooms': method => method === 'PATCH'
      ? Response.json({ error: { code: 'CLOUD_UNAVAILABLE', message: 'The cloud is unreachable.' } }, { status: 503 }) : undefined };
    fireEvent.change(field, { target: { value: '400' } });
    fireEvent.click(save);
    await flush();
    expect(screen.getByRole('alert').textContent).toBe('The cloud is unreachable.');
    expect(field.value).toBe('400');
  });

  it('says when live rooms are paused', async () => {
    stubDaemon({}, { sdkInstalled: true, paused: true });
    await openDialog();
    expect(screen.getByText("Live rooms on public links aren't open yet. You can still test on this computer.")).toBeTruthy();
    expect(screen.getByTestId('share-test')).toBeTruthy();
  });

  it('does not call rooms paused when it only cannot ask, signed out', async () => {
    stubDaemon({ available: false, unavailableReason: 'signed_out' }, { sdkInstalled: true, paused: true });
    await openDialog();
    expect(screen.queryByText(/aren't open yet/)).toBeNull();
    expect(screen.getByTestId('share-test')).toBeTruthy();
  });

  it('offers another read when rooms cannot be checked', async () => {
    stubDaemon({}, {}, { '/rooms': () => new Response('down', { status: 500 }) });
    await openDialog();
    fireEvent.click(screen.getByTestId('share-mode-multi'));
    expect(screen.getByText("Couldn't check multiplayer for this game.")).toBeTruthy();
    daemon.routes = {};
    fireEvent.click(within(screen.getByTestId('share-play')).getByRole('button', { name: 'Try again' }));
    await flush();
    expect(screen.getByTestId('share-ask-ai')).toBeTruthy();
  });
});

describe('solo or multiplayer, and the plan', () => {
  const plan = (over = {}) => ({ planRequired: false, sku: 'plan_starter', maxLiveGames: 10, maxGameBytes: 100 * 1024 * 1024, liveGames: 2, ...over });

  it('opens on solo and shows only that side, until a game has multiplayer code', async () => {
    stubDaemon({ publishPlan: plan() }, { sdkInstalled: false });
    await openDialog();
    expect(screen.getByTestId('share-mode-solo').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('share-play').hidden).toBe(true);
    fireEvent.click(screen.getByTestId('share-mode-multi'));
    expect(screen.getByTestId('share-play').hidden).toBe(false);
    expect(within(screen.getByTestId('share-play-steps')).getAllByRole('listitem')).toHaveLength(3);
  });

  it('opens a multiplayer game on multiplayer, with the link its players use', async () => {
    stubDaemon({ game: game() }, { sdkInstalled: true, usage: usage() });
    await openDialog();
    expect(screen.getByTestId('share-mode-multi').getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByTestId('share-play-link') as HTMLInputElement).value).toBe(game().url);
  });

  it('shows what the plan allows, from the API', async () => {
    stubDaemon({ publishPlan: plan() });
    await openDialog();
    const quota = screen.getByTestId('share-quota');
    expect(quota.textContent).toContain('2 / 10');
    expect(quota.textContent).toContain('100 MB');
    expect(quota.textContent).toContain('Unlimited');
  });

  it('asks an account with no plan to subscribe instead of offering Publish', async () => {
    const onClose = vi.fn();
    const onOpenAccount = vi.fn();
    stubDaemon({ publishPlan: plan({ planRequired: true, sku: null, maxLiveGames: 0, maxGameBytes: 0, liveGames: 0 }) });
    await openDialog({ onClose, onOpenAccount });
    expect(screen.queryByTestId('share-publish')).toBeNull();
    expect(screen.getByTestId('share-plan-required').textContent).toContain('Starter');
    fireEvent.click(screen.getByTestId('share-plan-cta'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps a lapsed account\u2019s link, and says why it cannot be updated', async () => {
    stubDaemon({ game: game(), publishPlan: plan({ planRequired: true, sku: null, maxLiveGames: 0, maxGameBytes: 0, liveGames: 1 }) });
    await openDialog();
    expect((screen.getByTestId('share-link') as HTMLInputElement).value).toBe(game().url);
    expect(screen.getByTestId('share-plan-lapsed')).toBeTruthy();
    expect(screen.queryByTestId('share-update')).toBeNull();
    expect(screen.getByTestId('share-remove')).toBeTruthy();
  });
});

describe('extra public games', () => {
  const full = (over = {}) => ({ planRequired: false, sku: 'plan_starter_monthly_v3', maxLiveGames: 10, maxGameBytes: 100 * 1024 * 1024, liveGames: 10, extraGameCredits: 100, extraGames: 0, ...over });
  const credits = (available: number): Route => method => method === 'GET' ? Response.json({ available, reserved: 0, subscription: null }) : undefined;
  const postJob: Route = method => method === 'POST' ? Response.json({ job: job({ id: 'j2' }) }) : undefined;

  it('shows the offer before Publish and publishes with one click', async () => {
    stubDaemon({ publishPlan: full() }, {}, { '/publish': postJob, '/api/openpixo/credits': credits(1240) });
    await openDialog({ onOpenAccount: vi.fn() });
    await flush();
    const offer = screen.getByTestId('share-extra-offer');
    expect(offer.textContent).toContain('Your Starter plan includes 10 public games and all are in use. Publish this one for 100 credits, charged once; updates stay free.');
    expect(screen.getByTestId('share-extra-balance').textContent).toBe('Your balance: 1,240 credits');
    expect(screen.queryByTestId('share-publish')).toBeNull();
    expect(screen.queryByTestId('share-extra-buy')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Publish for 100 credits' }));
    await flush();
    expect(bodyOf(calls('/publish', 'POST')[0])).toEqual({ title: 'Slime Dash', payExtraGame: true });
    expect(shareView()).toBe('publishing');
  });

  it('offers Buy credits instead when the balance is too low, and Upgrade plan beside it', async () => {
    const onClose = vi.fn();
    const onOpenAccount = vi.fn();
    stubDaemon({ publishPlan: full() }, {}, { '/publish': postJob, '/api/openpixo/credits': credits(40) });
    const view = await openDialog({ onClose, onOpenAccount });
    await flush();
    expect(screen.getByTestId('share-extra-balance').textContent).toBe('Your balance: 40 credits. You need 60 more.');
    expect(screen.queryByTestId('share-extra-publish')).toBeNull();
    fireEvent.submit(screen.getByTestId('share-extra-offer').closest('form')!);
    expect(calls('/publish', 'POST')).toHaveLength(0);
    expect(screen.getByTestId('share-extra-upgrade').textContent).toBe('Upgrade plan');
    fireEvent.click(screen.getByTestId('share-extra-buy'));
    expect(onClose).toHaveBeenCalledTimes(1);
    view.setOpen(false);
    await advance(300);
    expect(onOpenAccount).toHaveBeenCalledTimes(1);
  });

  it('turns a refusal for too few credits into Buy credits, with the new balance', async () => {
    const onOpenAccount = vi.fn();
    let balance = 500;
    stubDaemon({ publishPlan: full() }, {}, { '/publish': postJob,
      '/api/openpixo/credits': method => method === 'GET' ? Response.json({ available: balance, reserved: 0, subscription: null }) : undefined });
    await openDialog({ onOpenAccount });
    await flush();
    fireEvent.click(screen.getByTestId('share-extra-publish'));
    await flush();
    // Spent elsewhere meanwhile: the cloud refuses, and the balance is read again when the job ends.
    balance = 40;
    daemon.status = status({ publishPlan: full(), job: job({ id: 'j2', phase: 'failed',
      error: { code: 'INSUFFICIENT_CREDITS', message: 'Publishing this game costs 100 credits and you have 40. Buy credits, then publish again.' } }) });
    await advance(1_000);
    await flush();
    expect(screen.queryByTestId('share-failed')).toBeNull();
    expect(screen.getByTestId('share-extra-buy')).toBeTruthy();
    expect(screen.getByTestId('share-extra-balance').textContent).toBe('Your balance: 40 credits. You need 60 more.');
  });

  it('brings the offer back when the cloud refuses because the count changed elsewhere', async () => {
    stubDaemon({ publishPlan: full({ liveGames: 9 }) }, {}, { '/publish': postJob, '/api/openpixo/credits': credits(500) });
    await openDialog();
    fireEvent.click(screen.getByTestId('share-publish'));
    await flush();
    expect(shareView()).toBe('publishing');
    daemon.status = status({ publishPlan: full(), job: job({ id: 'j2', phase: 'failed',
      error: { code: 'PUBLISH_EXTRA_GAME_REQUIRED', message: 'All in use.', credits: 120 } as PublishJob['error'] }) });
    await advance(1_000);
    await flush();
    expect(shareView()).toBe('form');
    expect(screen.queryByTestId('share-failed')).toBeNull();
    expect(screen.getByTestId('share-extra-offer').textContent).toContain('120 credits');
    expect(screen.getByRole('button', { name: 'Publish for 120 credits' })).toBeTruthy();
  });

  it('keeps an old cloud on the plain Publish button and its own refusal', async () => {
    const { extraGameCredits: _price, extraGames: _extra, ...old } = full();
    stubDaemon({ publishPlan: old, job: job({ phase: 'failed', error: { code: 'PUBLISH_QUOTA', message: 'Your plan allows 10 live games.' } }) });
    await openDialog();
    expect(screen.queryByTestId('share-extra-offer')).toBeNull();
    expect(screen.getByTestId('share-failed').textContent).toContain('Your plan allows 10 live games.');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByTestId('share-publish')).toBeTruthy();
    expect(calls('/api/openpixo/credits')).toHaveLength(0);
  });

  it('marks a game published as extra and counts the extras', async () => {
    stubDaemon({ game: game({ extraPaid: true }), publishPlan: full({ extraGames: 2 }) });
    await openDialog();
    expect(screen.getByTestId('share-extra-paid').textContent).toBe('Extra game: paid once and not counted in your plan. Updates are free.');
    expect(screen.getByTestId('share-quota').textContent).toContain('Extra games2');
    expect(screen.getByTestId('share-update')).toBeTruthy();
  });

  it('renders the offer in Chinese', async () => {
    stubDaemon({ publishPlan: full() }, {}, { '/api/openpixo/credits': credits(1240) });
    await openDialog({ onOpenAccount: vi.fn() }, 'zh-CN');
    await flush();
    expect(screen.getByTestId('share-extra-offer').textContent).toContain('你的入门版套餐包含 10 个公开游戏');
    expect(screen.getByRole('button', { name: '花 100 积分发布' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '升级套餐' })).toBeTruthy();
  });
});

describe('language', () => {
  it('renders the dialog in Chinese', async () => {
    stubDaemon({ game: game() }, { sdkInstalled: true, usage: usage() });
    await openDialog({}, 'zh-CN');
    expect(screen.getByRole('heading', { name: '分享你的游戏' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '复制' })).toBeTruthy();
    fireEvent.click(screen.getByTestId('share-mode-solo'));
    expect(screen.getByRole('button', { name: '移除链接' })).toBeTruthy();
    fireEvent.click(screen.getByTestId('share-mode-multi'));
    expect(screen.getByTestId('share-price').textContent).toBe('每月 12 玩家小时免费，之后每玩家小时 9 积分');
    expect(screen.getByRole('heading', { name: '一起玩' })).toBeTruthy();
  });

  it('prefills the AI request in Chinese too', async () => {
    const view = await openDialog({}, 'zh-CN');
    fireEvent.click(screen.getByTestId('share-ask-ai'));
    view.setOpen(false);
    await advance(200);
    expect(takeProjectComposerPrefill('game')?.text).toContain('pixo rooms test');
  });

  it('keeps technical words out of what the creator reads', () => {
    for (const dictionary of [en, zhCN]) {
      const copy = Object.entries(dictionary).filter(([key]) => key.startsWith('gameShare.') && key !== 'gameShare.askAiPrompt');
      expect(copy.length).toBeGreaterThan(50);
      for (const [key, value] of copy) expect(`${key}: ${value}`).not.toMatch(/\b(Worker|R2|bundle|JWT|SDK|WebSocket|Durable|relay|deploy)\b/i);
    }
  });
});
