// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/i18n', () => ({
  useT: () => (key: string) => key,
}));

import { ExperienceSurvey } from '../src/components/ExperienceSurvey';
import {
  SURVEY_DELAY_MS,
  notifyArtifactDelivered,
} from '../src/components/experience-survey-trigger';

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function openImprovementQuestion() {
  const onSubmit = vi.fn();
  render(<ExperienceSurvey metricsConsent onSubmit={onSubmit} />);
  act(() => {
    notifyArtifactDelivered();
    vi.advanceTimersByTime(SURVEY_DELAY_MS);
  });
  fireEvent.click(screen.getByRole('button', { name: /^9$/ }));
  act(() => {
    vi.advanceTimersByTime(180);
  });
  return onSubmit;
}

describe('experience survey improvement choices', () => {
  it.each([
    ['wrongOutput', 0],
    ['falseDone', 1],
    ['hardToUse', 2],
    ['stuck', 4],
    ['slow', 5],
    ['looks', 6],
    ['regression', 7],
  ] as const)('preserves the analytics value for %s', (choice, value) => {
    const onSubmit = openImprovementQuestion();
    expect(screen.queryByText('experienceSurvey.improvement.upgradePrompts')).toBeNull();

    fireEvent.click(screen.getByRole('button', {
      name: 'experienceSurvey.improvement.' + choice,
    }));
    act(() => {
      vi.advanceTimersByTime(180);
    });

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ recommendation: 9, improvement: value });
  });

  it('keeps Other as a free-text answer', () => {
    const onSubmit = openImprovementQuestion();
    fireEvent.click(screen.getByRole('button', { name: 'experienceSurvey.improvement.other' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'experienceSurvey.otherPlaceholder' }), {
      target: { value: ' Better game engine feedback ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'experienceSurvey.submit' }));

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({
      recommendation: 9,
      improvementOther: 'Better game engine feedback',
    });
  });
});
