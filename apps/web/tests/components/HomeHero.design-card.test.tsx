// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';

import { HomeHero } from '../../src/components/HomeHero';
import { I18nProvider } from '../../src/i18n';

function renderComposer(overrides: Partial<ComponentProps<typeof HomeHero>> = {}) {
  const onSubmit = vi.fn();
  render(
    <I18nProvider initial="en">
      <HomeHero
        prompt="Build a platform game"
        onPromptChange={vi.fn()}
        onSubmit={onSubmit}
        activePluginTitle={null}
        onClearActivePlugin={vi.fn()}
        pluginOptions={[]}
        pluginsLoading={false}
        pendingPluginId={null}
        onPickPlugin={vi.fn()}
        contextItemCount={0}
        error={null}
        {...overrides}
      />
    </I18nProvider>,
  );
  return { onSubmit };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

it('lets the dashboard own the heading while retaining composer controls and its send hint', () => {
  const { onSubmit } = renderComposer({
    executionSwitcher: <button type="button">Codex · Default</button>,
    artStyleId: 'pixel-16-bit',
  });

  expect(screen.queryByRole('heading')).toBeNull();
  expect(screen.getByRole('button', { name: 'Codex · Default' })).toBeTruthy();
  expect(screen.getByTestId('home-hero-art-style').textContent).toBe('Style · pixel 16 bit');
  expect(screen.getByTestId('home-hero-input').getAttribute('aria-describedby'))
    .toBe(screen.getByTestId('home-hero-send-hint').id);
  fireEvent.click(screen.getByTestId('home-hero-submit'));
  expect(onSubmit).toHaveBeenCalledOnce();
});

it('keeps attachments reachable through the one "+" menu', () => {
  renderComposer();
  const input = screen.getByTestId('home-hero-file-input');
  const click = vi.spyOn(input, 'click').mockImplementation(() => undefined);
  // One add entry, as in the project composer: no second, labelled attach button.
  expect(screen.queryByRole('button', { name: 'Attachments' })).toBeNull();
  fireEvent.click(screen.getByTestId('home-hero-plus-trigger'));
  fireEvent.click(screen.getByTestId('composer-plus-attach'));
  expect(click).toHaveBeenCalledOnce();
  expect(screen.queryByTestId('home-hero-art-style')).toBeNull();
});

it('preserves an explicitly supplied embedded heading and the send guard', () => {
  const { onSubmit } = renderComposer({ title: 'Make a game', submitting: true });
  expect(screen.getByRole('heading', { name: 'Make a game' })).toBeTruthy();
  fireEvent.click(screen.getByTestId('home-hero-submit'));
  expect(onSubmit).not.toHaveBeenCalled();
});
