// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { HomeHero } from '../../src/components/HomeHero';

afterEach(cleanup);

it('keeps the home composer free of inherited creation types and scenarios', () => {
  render(<HomeHero
    prompt=""
    onPromptChange={vi.fn()}
    onSubmit={vi.fn()}
    activePluginTitle={null}
    onClearActivePlugin={vi.fn()}
    pluginOptions={[]}
    pluginsLoading={false}
    pendingPluginId={null}
    onPickPlugin={vi.fn()}
    contextItemCount={0}
    error={null}
  />);

  expect(screen.queryByTestId('home-hero-type-row')).toBeNull();
  expect(screen.queryByTestId('home-hero-prompt-examples')).toBeNull();
  for (const name of ['Image', 'Video', 'WebGL', 'HyperFrames', 'More']) {
    expect(screen.queryByRole('button', { name })).toBeNull();
  }
  expect(document.querySelector('[data-chip-id], .home-hero__placeholder-carousel')).toBeNull();
  expect(screen.getByTestId('home-hero-input')).toBeTruthy();
});
