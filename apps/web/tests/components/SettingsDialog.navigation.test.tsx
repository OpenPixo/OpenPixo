// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsDialog } from '../../src/components/SettingsDialog';
import { I18nProvider } from '../../src/i18n';
import { en } from '../../src/i18n/locales/en';
import {
  resolveSettingsDeepLink,
  SETTINGS_NAV_GROUPS,
  type SettingsSection,
} from '../../src/settings-navigation';
import { DEFAULT_CONFIG } from '../../src/state/config';

function renderSettings(initialSection: SettingsSection) {
  return render(
    <I18nProvider initial="en">
      <SettingsDialog
        presentation="page"
        initialSection={initialSection}
        initial={DEFAULT_CONFIG}
        agents={[{ id: 'codex', name: 'Codex', bin: 'codex', available: true }]}
        daemonLive={false}
        appVersionInfo={null}
        onPersist={vi.fn()}
        onClose={vi.fn()}
        onRefreshAgents={vi.fn()}
      />
    </I18nProvider>,
  );
}

function activeNavTestId(): string | null {
  return document.querySelector('.settings-nav-item.active')?.getAttribute('data-testid') ?? null;
}

describe('settings deep links', () => {
  it.each<[SettingsSection, string, string | undefined]>([
    ['language', 'general', undefined],
    ['appearance', 'general', undefined],
    ['notifications', 'general', 'notifications'],
    ['projectLocations', 'general', 'projectLocations'],
    ['instructions', 'execution', 'instructions'],
    ['labs', 'advanced', 'labs'],
    ['execution', 'execution', undefined],
    ['media', 'media', undefined],
    ['skills', 'skills', undefined],
    ['gameEngines', 'gameEngines', undefined],
    ['doctor', 'doctor', undefined],
    ['mcpClient', 'mcpClient', undefined],
  ])('resolves %s to the %s page', (section, page, anchor) => {
    expect(resolveSettingsDeepLink(section)).toEqual(anchor ? { page, anchor } : { page });
  });

  it('gives every page token a nav row', () => {
    const pages = SETTINGS_NAV_GROUPS.flatMap((group) => group.items.map((item) => item.page));
    expect(pages).toEqual([
      'general', 'account',
      'execution', 'media', 'skills', 'gameEngines', 'doctor',
      'integrations', 'privacy', 'advanced', 'about',
    ]);
  });
});

describe('settings navigation', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('opens the project rules deep link on the Agent page and scrolls to the rules', () => {
    renderSettings('instructions');
    expect(activeNavTestId()).toBe('settings-nav-execution');
    expect(screen.getByRole('heading', { level: 2, name: en['settings.envConfigure'] })).toBeTruthy();
    const rules = document.getElementById('settings-anchor-instructions');
    expect(rules?.querySelector('textarea')).toBeTruthy();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it('keeps the old Labs link working under Advanced', () => {
    renderSettings('labs');
    expect(activeNavTestId()).toBe('settings-nav-advanced');
    expect(screen.getByRole('heading', { name: en['labs.title'] })).toBeTruthy();
    expect(screen.getByRole('heading', { name: en['diagnostics.exportTitle'] })).toBeTruthy();
  });

  it('titles each page with its nav label and one-line description', () => {
    renderSettings('general');
    fireEvent.click(screen.getByTestId('settings-nav-about'));
    expect(screen.getByRole('heading', { level: 2, name: en['settings.about'] })).toBeTruthy();
    expect(screen.getByText(en['settings.aboutHint'])).toBeTruthy();
    // Troubleshooting moved off About.
    expect(screen.queryByRole('button', { name: en['settings.resetOnboardingButton'] })).toBeNull();
  });

  it('hides the account page when the build has no account service', () => {
    renderSettings('general');
    expect(screen.queryByTestId('settings-nav-account')).toBeNull();
    expect(screen.getByTestId('settings-nav-advanced')).toBeTruthy();
  });
});
