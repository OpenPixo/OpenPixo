// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { OpenPixoHostUpdaterStatusSnapshot } from '@openpixo/host';
import { installMockOpenPixoHost } from '@openpixo/host/testing';

import { RequiredUpdateGate } from '../../src/components/RequiredUpdateGate';
import { I18nProvider } from '../../src/i18n';
import { en } from '../../src/i18n/locales/en';
import { zhCN } from '../../src/i18n/locales/zh-CN';

const openExternalUrl = vi.hoisted(() => vi.fn(async () => true));
vi.mock('../../src/providers/registry', async (importActual) => ({
  ...(await importActual<typeof import('../../src/providers/registry')>()),
  openExternalUrl,
}));

function status(overrides: Partial<OpenPixoHostUpdaterStatusSnapshot> = {}): OpenPixoHostUpdaterStatusSnapshot {
  return {
    arch: 'x64',
    capabilities: { canApplyInPlace: true, canDownload: true, canOpenInstaller: false, requiresManualInstall: false },
    channel: 'beta',
    currentVersion: '1.0.0-beta.1',
    enabled: true,
    mode: 'package-launcher',
    platform: 'win32',
    required: { minVersion: '1.0.0-beta.2' },
    state: 'downloading',
    supported: true,
    ...overrides,
  };
}

function downloaded(overrides: Partial<OpenPixoHostUpdaterStatusSnapshot> = {}): OpenPixoHostUpdaterStatusSnapshot {
  return status({
    artifact: { platformKey: 'win', type: 'payload', url: 'https://example.test/payload.7z' },
    availableVersion: '1.0.0-beta.2',
    downloadPath: 'C:/updates/payload.7z',
    state: 'downloaded',
    ...overrides,
  });
}

function failed(): OpenPixoHostUpdaterStatusSnapshot {
  return status({
    availableVersion: '1.0.0-beta.2',
    error: { code: 'download-failed', message: 'network' },
    state: 'error',
  });
}

let restoreHost: (() => void) | null = null;
afterEach(() => {
  cleanup();
  restoreHost?.();
  restoreHost = null;
  openExternalUrl.mockClear();
});

function install(
  snapshot: OpenPixoHostUpdaterStatusSnapshot,
  updater: Record<string, unknown> = {},
) {
  restoreHost = installMockOpenPixoHost({
    host: { updater: { status: vi.fn(async () => snapshot), ...updater } },
  });
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('RequiredUpdateGate', () => {
  it('shows nothing for an ordinary update, or with no update at all', async () => {
    install(downloaded({ required: undefined }));
    render(<RequiredUpdateGate />);
    await settle();
    expect(screen.queryByTestId('required-update-gate')).toBeNull();
    expect(screen.queryByTestId('required-update-strip')).toBeNull();
  });

  it('never gates on a failed check: without a requirement an offline start is free', async () => {
    install(status({ error: { code: 'metadata-unreachable', message: 'offline' }, required: undefined, state: 'error' }));
    render(<RequiredUpdateGate />);
    await settle();
    expect(screen.queryByTestId('required-update-gate')).toBeNull();
  });

  it('explains why and offers the restart once the update is ready', async () => {
    install(downloaded({ required: { message: { en: 'Saving can corrupt projects.' }, minVersion: '1.0.0-beta.2' } }));
    render(<RequiredUpdateGate />);
    expect(await screen.findByTestId('required-update-gate')).toBeTruthy();
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(screen.getByTestId('required-update-message').textContent).toBe('Saving can corrupt projects.');
    expect(screen.getByText(en['updater.requiredKeeps'])).toBeTruthy();
    expect(screen.getByTestId('required-update-restart').textContent).toBe(en['updater.installRestart']);
    expect(screen.queryByTestId('required-update-continue')).toBeNull();
  });

  it('restarts only when asked, and only after a task check', async () => {
    const installUpdate = vi.fn(async () => downloaded({ installResult: { openedAt: 't', path: 'p' } }));
    const quit = vi.fn(async () => ({ ok: true as const }));
    install(downloaded(), { install: installUpdate, quit });
    render(<RequiredUpdateGate />);
    fireEvent.click(await screen.findByTestId('required-update-restart'));
    await waitFor(() => expect(quit).toHaveBeenCalledTimes(1));
    expect(installUpdate).toHaveBeenCalledWith({ payload: { force: false, source: 'required-update' } });
  });

  it('stays out of the way as a strip while a task is running', async () => {
    const installUpdate = vi.fn();
    install(downloaded(), {
      install: installUpdate,
      restartSafety: vi.fn(async () => ({
        details: { activeRunCount: 2 },
        ok: false as const,
        reason: 'active-runs-blocked',
      })),
    });
    render(<RequiredUpdateGate />);
    expect(await screen.findByTestId('required-update-strip')).toBeTruthy();
    expect(screen.queryByTestId('required-update-gate')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('2');
    expect(installUpdate).not.toHaveBeenCalled();
  });

  it('becomes the full gate once the running tasks finish', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let running = true;
      install(downloaded(), {
        restartSafety: vi.fn(async () => (running
          ? { details: { activeRunCount: 1 }, ok: false as const, reason: 'active-runs-blocked' }
          : { ok: true as const })),
      });
      render(<RequiredUpdateGate />);
      await screen.findByTestId('required-update-strip');
      running = false;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3100);
      });
      expect(await screen.findByTestId('required-update-gate')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('after a failed download offers retry, manual download, and a way to keep working', async () => {
    const check = vi.fn(async () => failed());
    install(failed(), { check });
    render(<RequiredUpdateGate />);
    await screen.findByTestId('required-update-gate');
    expect(screen.getByTestId('required-update-status').textContent).toBe(en['updater.requiredDownloadFailed']);

    fireEvent.click(screen.getByTestId('required-update-retry'));
    await waitFor(() => expect(check).toHaveBeenCalledWith({ payload: { autoDownload: true, source: 'required-update' } }));

    fireEvent.click(screen.getByTestId('required-update-manual'));
    expect(openExternalUrl).toHaveBeenCalledWith('https://openpixo.com/download');

    fireEvent.click(screen.getByTestId('required-update-continue'));
    await waitFor(() => expect(screen.queryByTestId('required-update-gate')).toBeNull());
  });

  it('uses the download page the publisher named', async () => {
    install(status({
      error: { code: 'download-failed', message: 'network' },
      required: { minVersion: '1.0.0-beta.2', url: 'https://example.test/get' },
      state: 'error',
    }));
    render(<RequiredUpdateGate />);
    fireEvent.click(await screen.findByTestId('required-update-manual'));
    expect(openExternalUrl).toHaveBeenCalledWith('https://example.test/get');
  });

  it('comes back when the update that was missing is ready again', async () => {
    let listener: ((next: OpenPixoHostUpdaterStatusSnapshot) => void) | undefined;
    install(failed(), {
      subscribe: (next: (value: OpenPixoHostUpdaterStatusSnapshot) => void) => {
        listener = next;
        return () => undefined;
      },
    });
    render(<RequiredUpdateGate />);
    fireEvent.click(await screen.findByTestId('required-update-continue'));
    await waitFor(() => expect(screen.queryByTestId('required-update-gate')).toBeNull());

    act(() => listener?.(downloaded()));

    expect(await screen.findByTestId('required-update-gate')).toBeTruthy();
    expect(screen.getByTestId('required-update-restart')).toBeTruthy();
  });

  it('speaks the user\'s language, including the publisher\'s reason', async () => {
    install(downloaded({
      required: { message: { en: 'English reason', 'zh-CN': '中文原因' }, minVersion: '1.0.0-beta.2' },
    }));
    render(
      <I18nProvider initial="zh-CN">
        <RequiredUpdateGate />
      </I18nProvider>,
    );
    expect(await screen.findByText(zhCN['updater.requiredTitle'])).toBeTruthy();
    expect(screen.getByTestId('required-update-message').textContent).toBe('中文原因');
  });
});
