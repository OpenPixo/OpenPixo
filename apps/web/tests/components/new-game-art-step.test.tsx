// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArtStyle } from '@openpixo/contracts';

import { ArtStep, SetupStep } from '../../src/components/new-game/WizardSteps';
import { emptyDraft, type WizardDraft } from '../../src/components/new-game/wizard-state';

afterEach(cleanup);

const style = (id: string): ArtStyle => ({ id, title: id, description: '', dimension: ['2d'], medium: [] }) as unknown as ArtStyle;

function Art({ styleList = [], stylesFailed = false, onRetry = vi.fn() }: { styleList?: ArtStyle[]; stylesFailed?: boolean; onRetry?: () => void }) {
  const [draft, setDraft] = useState<WizardDraft>(emptyDraft('t'));
  return (
    <ArtStep draft={draft} update={patch => setDraft(current => ({ ...current, ...patch }))} showProblems={false}
      styleList={styleList} stylesLoading={false} stylesFailed={stylesFailed} onRetryStyles={onRetry}
      references={[]} onReferences={vi.fn()} onReferenceError={vi.fn()} />
  );
}

describe('ArtStep style list', () => {
  it('tells a failed fetch apart from no styles installed, and retries', () => {
    const onRetry = vi.fn();
    render(<Art stylesFailed onRetry={onRetry} />);
    expect(screen.getByRole('alert').textContent).toContain("Couldn't load the art styles.");
    expect(screen.queryByText(/No art styles/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('keeps the empty message for a real empty list', () => {
    render(<Art />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(/No art styles/i)).toBeTruthy();
  });

  it('has one tab stop, and arrow keys move focus and selection', () => {
    render(<Art styleList={[style('a'), style('b')]} />);
    const group = screen.getAllByRole('radiogroup')[0]!;
    const [a, b, custom] = screen.getAllByRole('radio').filter(radio => group.contains(radio));
    expect([a!.tabIndex, b!.tabIndex, custom!.tabIndex]).toEqual([0, -1, -1]);

    a!.focus();
    fireEvent.keyDown(a!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(b);
    expect(b!.getAttribute('aria-checked')).toBe('true');
    expect([a!.tabIndex, b!.tabIndex, custom!.tabIndex]).toEqual([-1, 0, -1]);

    fireEvent.keyDown(b!, { key: 'End' });
    expect(document.activeElement).toBe(custom);
    fireEvent.keyDown(custom!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(a);
  });
});

describe('SetupStep resolution', () => {
  it('moves through resolutions with the arrow keys', () => {
    function Setup() {
      const [draft, setDraft] = useState<WizardDraft>(emptyDraft('t'));
      return <SetupStep draft={draft} update={patch => setDraft(current => ({ ...current, ...patch }))} showProblems={false} />;
    }
    render(<Setup />);
    const group = screen.getAllByRole('radiogroup')[0]!;
    const radios = screen.getAllByRole('radio').filter(radio => group.contains(radio));
    expect(radios.filter(radio => radio.tabIndex === 0)).toHaveLength(1);
    const start = radios.find(radio => radio.tabIndex === 0)!;
    start.focus();
    fireEvent.keyDown(start, { key: 'ArrowLeft' });
    const moved = document.activeElement as HTMLElement;
    expect(moved).not.toBe(start);
    expect(moved.getAttribute('aria-checked')).toBe('true');
    expect(moved.tabIndex).toBe(0);
  });
});
