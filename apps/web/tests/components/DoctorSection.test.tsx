// @vitest-environment jsdom
import type { DoctorResponse } from '@openpixo/contracts';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DoctorSection } from '../../src/components/doctor/DoctorSection';
import { SettingsDialog } from '../../src/components/SettingsDialog';
import { I18nProvider } from '../../src/i18n';
import { copyToClipboard } from '../../src/lib/copy-to-clipboard';
import { openExternalUrl } from '../../src/providers/registry';
import { DEFAULT_CONFIG } from '../../src/state/config';

vi.mock('../../src/providers/registry', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/providers/registry')>(),
  openExternalUrl: vi.fn(),
}));
vi.mock('../../src/lib/copy-to-clipboard', () => ({ copyToClipboard: vi.fn(async () => true) }));

function doctorResponse(): DoctorResponse {
  return {
    checks: [
      {
        id: 'agent-codex', group: 'agents', status: 'ok',
        title: { code: 'agent', params: { name: 'Codex' } },
        detail: { code: 'signed-in', params: { version: '0.50.0', source: 'path' } },
        fix: { kind: 'command', value: 'codex login' },
      },
      {
        id: 'agent-claude', group: 'agents', status: 'warn',
        title: { code: 'agent', params: { name: 'Claude Code' } },
        detail: { code: 'sign-in-required' },
        fix: { kind: 'command', value: 'claude auth login' },
      },
      {
        id: 'agent-opencode', group: 'agents', status: 'missing',
        title: { code: 'agent', params: { name: 'OpenCode' } },
        detail: { code: 'not-found' },
        fix: { kind: 'install-url', value: 'https://opencode.ai/docs/' },
      },
      {
        id: 'engine-godot', group: 'engines', status: 'missing',
        title: { code: 'godot' }, detail: { code: 'invalid-path', params: { configured: true } },
        fix: { kind: 'settings', value: 'gameEngines' },
      },
      {
        id: 'engine-node', group: 'engines', status: 'ok',
        title: { code: 'node' }, detail: { code: 'available', params: { version: '24.22.1', source: 'path' } },
        fix: { kind: 'install-url', value: 'https://nodejs.org/' },
      },
      {
        id: 'ffmpeg', group: 'media-tools', status: 'error',
        title: { code: 'ffmpeg' }, detail: { code: 'probe-failed', params: { source: 'bundled' } },
        fix: { kind: 'install-url', value: 'https://ffmpeg.org/download.html' },
      },
      {
        id: 'image-provider', group: 'providers', status: 'missing',
        title: { code: 'image-provider' }, detail: { code: 'not-configured' },
        fix: { kind: 'settings', value: 'media' },
      },
      {
        id: 'audio-provider', group: 'providers', status: 'ok',
        title: { code: 'audio-provider' }, detail: { code: 'configured' },
        fix: { kind: 'settings', value: 'media' },
      },
    ],
  };
}

function stubDoctor(response = doctorResponse()) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => (
    String(input) === '/api/doctor' ? Response.json(response) : Response.json({})
  ));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderDoctor(onOpenSettings = vi.fn(), locale: 'en' | 'zh-CN' = 'en') {
  return render(
    <I18nProvider initial={locale}>
      <DoctorSection onOpenSettings={onOpenSettings} />
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('environment check settings', () => {
  it('opens from Settings, groups the results, and jumps to game engine settings', async () => {
    stubDoctor();
    render(
      <I18nProvider initial="en">
        <SettingsDialog
          presentation="page"
          initialSection="general"
          initial={DEFAULT_CONFIG}
          agents={[{ id: 'codex', name: 'Codex', bin: 'codex', available: true }]}
          daemonLive
          appVersionInfo={null}
          onPersist={vi.fn()}
          onClose={vi.fn()}
          onRefreshAgents={vi.fn()}
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByTestId('settings-nav-doctor'));
    await screen.findByRole('heading', { name: 'Generation providers' });
    for (const name of ['Agents', 'Game engines', 'Media tools']) {
      expect(screen.getByRole('heading', { name })).toBeTruthy();
    }
    expect(screen.getByText(/24\.22\.1/)).toBeTruthy();
    expect(screen.getAllByText(/PATH/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Open settings for Godot' }));
    expect(screen.getByRole('heading', { name: 'Game engines', level: 2 })).toBeTruthy();
    expect(screen.getByLabelText('Godot executable path')).toBeTruthy();
  });

  it('dispatches the available fixes and hides actions for healthy checks', async () => {
    stubDoctor();
    const onOpenSettings = vi.fn();
    renderDoctor(onOpenSettings);
    await screen.findByRole('heading', { name: 'Generation providers' });

    fireEvent.click(screen.getByRole('button', { name: 'Download for OpenCode' }));
    expect(openExternalUrl).toHaveBeenCalledWith('https://opencode.ai/docs/');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy command for Claude Code' }));
    });
    expect(copyToClipboard).toHaveBeenCalledWith('claude auth login');
    expect(screen.getByRole('button', { name: 'Copied for Claude Code' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Open settings for Godot' }));
    expect(onOpenSettings).toHaveBeenCalledWith('gameEngines');
    fireEvent.click(screen.getByRole('button', { name: 'Open settings for Image generation' }));
    expect(onOpenSettings).toHaveBeenLastCalledWith('media');
    expect(screen.getByText(/HYPERFRAMES_FFMPEG_PATH/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Copy command for Codex' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Download for Node.js' })).toBeNull();
  });

  it('keeps one request pending and aborts it when the section closes', () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetchMock);
    const view = renderDoctor();
    const recheck = screen.getByRole('button') as HTMLButtonElement;
    expect(recheck.disabled).toBe(true);
    fireEvent.click(recheck);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const options = fetchMock.mock.calls[0]?.[1];
    expect(options?.cache).toBe('no-store');
    expect(options?.signal?.aborted).toBe(false);

    view.unmount();
    expect(options?.signal?.aborted).toBe(true);
  });

  it('recovers from an endpoint error with Recheck', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({}, { status: 503 }))
      .mockResolvedValueOnce(Response.json(doctorResponse()));
    vi.stubGlobal('fetch', fetchMock);
    renderDoctor();
    expect(await screen.findByRole('alert')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Recheck' }));
    await screen.findByRole('heading', { name: 'Generation providers' });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((screen.getByRole('button', { name: 'Recheck' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('localizes check results and fix actions in Chinese', async () => {
    stubDoctor();
    renderDoctor(vi.fn(), 'zh-CN');
    await screen.findByRole('heading', { name: '生成服务' });
    expect(screen.getByRole('button', { name: '重新检查' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Godot：打开设置' })).toBeTruthy();
    expect(screen.getByText('尚未配置生成服务。')).toBeTruthy();
    expect(screen.getAllByText('缺失').length).toBeGreaterThan(0);
    expect(screen.queryByText('Generation providers')).toBeNull();
  });
});
