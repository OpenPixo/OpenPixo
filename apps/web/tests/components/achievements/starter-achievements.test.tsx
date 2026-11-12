// @vitest-environment jsdom
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ProjectNextStepsResponse } from '@openpixo/contracts';
import { AchievementToast } from '../../../src/components/achievements/AchievementToast';
import { advanceAchievementSnapshot } from '../../../src/components/achievements/starter-achievements';
import { achievementStorageKey, useStarterAchievements } from '../../../src/components/achievements/useStarterAchievements';
import { I18nProvider } from '../../../src/i18n';

const ids = ['environment', 'run-game', 'agent-task', 'media-assets', 'verify'] as const;
function facts(done = 0, projectId = 'game one'): ProjectNextStepsResponse {
  return {
    projectId, engine: 'godot', dismissed: false,
    steps: ids.map((id, index) => ({ id, status: index < done ? 'done' : 'todo', action: { kind: 'open-settings', value: 'environment' } })),
  };
}

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('seeds existing completions quietly and awards an incomplete step only once', () => {
  const initial = advanceAchievementSnapshot(null, facts(1).steps);
  expect(initial.unlocked).toEqual([]);
  const changed = advanceAchievementSnapshot(initial.snapshot, facts(2).steps);
  expect(changed.unlocked).toEqual(['run-game']);
  const unchanged = advanceAchievementSnapshot(changed.snapshot, facts(2).steps);
  expect(unchanged.unlocked).toEqual([]);
  const reverted = advanceAchievementSnapshot(unchanged.snapshot, facts(1).steps);
  expect(advanceAchievementSnapshot(reverted.snapshot, facts(2).steps).unlocked).toEqual([]);
});

it('persists the transition per project so remounts never repeat the achievement', () => {
  const view = renderHook(({ projectId, data }) => useStarterAchievements(projectId, data), {
    initialProps: { projectId: 'game one', data: facts() },
  });
  expect(view.result.current.achievement).toBeNull();
  view.rerender({ projectId: 'game one', data: facts(1) });
  expect(view.result.current.achievement).toBe('environment');
  expect(window.localStorage.getItem(achievementStorageKey('game one'))).not.toBeNull();
  act(() => view.result.current.dismiss());
  view.unmount();

  const restoredData = facts(1);
  const restored = renderHook(() => useStarterAchievements('game one', restoredData));
  expect(restored.result.current.achievement).toBeNull();
  const independent = renderHook(({ data }) => useStarterAchievements('another game', data), {
    initialProps: { data: facts(0, 'another game') },
  });
  independent.rerender({ data: facts(1, 'another game') });
  expect(independent.result.current.achievement).toBe('environment');
});

it('renders no portal markup on the server', () => {
  expect(renderToString(<I18nProvider initial="en"><AchievementToast achievement="verify" onDismiss={() => {}} /></I18nProvider>)).toBe('');
});

it('dismisses the accessible toast at four seconds using the virtual clock', async () => {
  vi.useFakeTimers();
  const onDismiss = vi.fn();
  const view = render(<I18nProvider initial="en"><AchievementToast achievement="run-game" onDismiss={onDismiss} /></I18nProvider>);
  const status = view.getByRole('status');
  expect(status).toHaveTextContent(/achievement/i);
  await act(async () => { await vi.advanceTimersByTimeAsync(3_999); });
  expect(onDismiss).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(onDismiss).toHaveBeenCalledOnce();

  view.rerender(<I18nProvider initial="en"><AchievementToast achievement={null} onDismiss={onDismiss} /></I18nProvider>);
  expect(status).toHaveAttribute('data-visible', 'false');
  expect(document.body.contains(status)).toBe(true);
});
