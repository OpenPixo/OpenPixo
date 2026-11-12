// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EntryNavRail } from '../../src/components/EntryNavRail';
import { I18nProvider } from '../../src/i18n';

const analytics = vi.hoisted(() => ({
  track: vi.fn(),
  newRequestId: vi.fn(() => 'request-nav-1'),
}));

vi.mock('../../src/analytics/provider', () => ({
  useAnalytics: () => ({
    track: analytics.track,
    newRequestId: analytics.newRequestId,
  }),
}));

afterEach(cleanup);

beforeEach(() => {
  analytics.track.mockReset();
  analytics.newRequestId.mockClear();
});

describe('EntryNavRail analytics', () => {
  it('tracks redesigned sidebar destinations with stable targets', () => {
    render(
      <I18nProvider initial="en">
        <EntryNavRail
          view="home"
          onViewChange={() => {}}
          onNewProject={() => {}}
          onOpenSearch={() => {}}
          onOpenSettings={() => {}}
          open
          
        />
      </I18nProvider>,
    );

    expect(screen.queryByTestId('entry-nav-community')).toBeNull();
    expect(screen.queryByTestId('entry-nav-plugins')).toBeNull();
    fireEvent.click(screen.getByTestId('entry-nav-store'));
    fireEvent.click(screen.getByTestId('entry-nav-search-item'));
    fireEvent.click(screen.getByTestId('entry-settings-button'));

    expect(analytics.track).toHaveBeenCalledWith('ui_click', expect.objectContaining({
      area: 'entry_nav',
      element: 'nav_item',
      target: 'home',
      entry_from: 'sidebar',
    }), undefined);
    expect(analytics.track).toHaveBeenCalledWith('ui_click', expect.objectContaining({
      area: 'entry_nav',
      element: 'search',
      target: 'search',
      entry_from: 'sidebar',
    }), undefined);
    expect(analytics.track).toHaveBeenCalledWith('ui_click', expect.objectContaining({
      area: 'account_menu',
      element: 'settings',
    }), undefined);
  });
});
