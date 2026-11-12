// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsDialog, type SettingsSection } from '../../src/components/SettingsDialog';
import { I18nProvider } from '../../src/i18n';
import { DEFAULT_CONFIG } from '../../src/state/config';

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('OpenPixo settings surfaces', () => {
  it.each<SettingsSection>(['general'])('keeps %s on supported settings without inherited reads', async (initialSection) => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({}));
    vi.stubGlobal('fetch', fetchMock);
    const config = { ...DEFAULT_CONFIG, critiqueTheaterEnabled: true };
    localStorage.setItem('pixo:config', JSON.stringify(config));
    const { container } = render(
      <I18nProvider initial="en">
        <SettingsDialog
          presentation="page"
          initialSection={initialSection}
          initial={config}
          agents={[{ id: 'codex', name: 'Codex', bin: 'codex', available: true }]}
          daemonLive
          appVersionInfo={null}
          onPersist={vi.fn()}
          onClose={vi.fn()}
          onRefreshAgents={vi.fn()}
        />
      </I18nProvider>,
    );
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('pixo:workspace-context-refresh'));
    });
    expect(container.querySelector('.settings-general-section')).not.toBeNull();
    expect(container.querySelector('.critique-theater-toggle')).toBeNull();
    expect(container.textContent).not.toContain('Codex Pets');
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.filter((url) => /design-systems|design-templates|brands|orbit|codex-pets|amr|workspace/.test(url))).toEqual([]);
  });
});
