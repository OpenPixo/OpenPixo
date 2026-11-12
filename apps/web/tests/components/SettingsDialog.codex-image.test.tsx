// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsDialog } from '../../src/components/SettingsDialog';
import { CodexImageProviderControl } from '../../src/components/CodexImageProviderControl';
import { DEFAULT_CONFIG } from '../../src/state/config';
import { I18nProvider } from '../../src/i18n';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('Codex image provider settings', () => {
  it('is discoverable in Media providers and detects sign-in without a key field', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ providers: { 'codex-cli': { available: true, keyless: true } } }),
    });
    vi.stubGlobal('fetch', fetch);
    render(<I18nProvider initial="en"><SettingsDialog initial={DEFAULT_CONFIG} agents={[]} daemonLive
      appVersionInfo={null} initialSection="media" onPersist={vi.fn()} onClose={vi.fn()} onRefreshAgents={vi.fn()} /></I18nProvider>);
    fireEvent.click(screen.getByRole('tab', { name: /Codex \(ChatGPT sign-in\)/ }));
    await screen.findByText('Codex is signed in and ready to generate images.');
    expect(screen.queryByLabelText(/Codex.*API key/)).toBeNull();
    expect(fetch).toHaveBeenCalledWith('/api/media/config', expect.anything());
    fetch.mockResolvedValue({ ok: true, json: async () => ({ providers: { 'codex-cli': {
      available: false, reasonCode: 'CODEX_CLI_AUTH_REQUIRED', reason: 'RAW BACKEND ERROR',
    } } }) });
    fireEvent.click(screen.getByRole('button', { name: 'Detect' }));
    await screen.findByText(/Sign in with ChatGPT using codex login/, { selector: 'p[role="status"]' });
    expect(screen.queryByText('RAW BACKEND ERROR')).toBeNull();
  });
  it('localizes auth failures in Chinese and can recover after detection', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ providers: { 'codex-cli': {
      available: false, reasonCode: 'CODEX_CLI_AUTH_REQUIRED', reason: 'Not logged in',
    } } }) });
    vi.stubGlobal('fetch', fetch);
    const onStatus = vi.fn();
    render(<I18nProvider initial="zh-CN"><CodexImageProviderControl onStatus={onStatus} /></I18nProvider>);
    await screen.findByText('请在终端运行 codex login，使用 ChatGPT 账号登录，然后重新检测。');
    expect(screen.queryByText('Not logged in')).toBeNull();
    fetch.mockResolvedValue({ ok: true, json: async () => ({ providers: { 'codex-cli': { available: true } } }) });
    fireEvent.click(screen.getByRole('button', { name: '检测' }));
    await screen.findByText('Codex 已登录，可以生成图片。');
    await waitFor(() => expect(onStatus).toHaveBeenLastCalledWith({ available: true, keyless: true }));
  });
});
