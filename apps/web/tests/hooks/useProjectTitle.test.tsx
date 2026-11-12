// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useProjectTitle } from '../../src/hooks/useProjectTitle';

afterEach(cleanup);

it('shows the current project name, follows renames, and restores the home title on leaving', () => {
  const { rerender, unmount } = renderHook(({ name }) => useProjectTitle(name), {
    initialProps: { name: 'Moon Garden' },
  });

  expect(document.title).toBe('Moon Garden — OpenPixo');
  rerender({ name: 'Moon Garden 2' });
  expect(document.title).toBe('Moon Garden 2 — OpenPixo');
  unmount();
  expect(document.title).toBe('OpenPixo');
});
