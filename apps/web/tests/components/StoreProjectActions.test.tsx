// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StoreProjectActions } from '../../src/components/StoreProjectActions';
import { setProjectArtStyle } from '../../src/providers/styles';
import { clearProjectComposerPrefill, takeProjectComposerPrefill } from '../../src/state/composer-prefill';

vi.mock('../../src/i18n', () => ({ useI18n: () => ({ locale: 'en', t: (key: string) => key }) }));
vi.mock('../../src/providers/styles', () => ({ setProjectArtStyle: vi.fn() }));
vi.mock('../../src/components/store/StoreView', () => ({
  StoreView: ({ onTryExample, onUseStyle }: { onTryExample: (prompt: string, styleId?: string) => void; onUseStyle: (id: string) => void }) => <>
    <button onClick={() => onTryExample('Make a knight')}>Try example</button>
    <button onClick={() => onTryExample('Make a knight in this style', 'pixel-16-bit')}>Try styled example</button>
    <button onClick={() => onUseStyle('pixel-16-bit')}>Use style</button>
  </>,
}));

afterEach(() => { cleanup(); clearProjectComposerPrefill('one'); clearProjectComposerPrefill('two'); });
beforeEach(() => { vi.clearAllMocks(); vi.mocked(setProjectArtStyle).mockResolvedValue({ styleId: 'pixel-16-bit', style: null, referenceImage: null }); });

describe('Store project actions', () => {
  it('picks a project and fills its composer without starting a run', async () => {
    const open = vi.fn();
    render(<StoreProjectActions projects={[{ id: 'one', name: 'First' }, { id: 'two', name: 'Second' }]} onOpenProject={open} />);
    fireEvent.click(screen.getByText('Try example'));
    expect(open).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('store.project'), { target: { value: 'two' } });
    fireEvent.click(screen.getByText('store.action.openProject'));
    await waitFor(() => expect(open).toHaveBeenCalledWith('two'));
    expect(takeProjectComposerPrefill('two')?.text).toBe('Make a knight');
    expect(takeProjectComposerPrefill('one')).toBeUndefined();
    expect(setProjectArtStyle).not.toHaveBeenCalled();
  });

  it('sets a styled example default before opening its sole project', async () => {
    const open = vi.fn(() => { expect(setProjectArtStyle).toHaveBeenCalledWith('one', 'pixel-16-bit', undefined, 'en'); });
    render(<StoreProjectActions projects={[{ id: 'one', name: 'First' }]} onOpenProject={open} />);
    fireEvent.click(screen.getByText('Try styled example'));
    await waitFor(() => expect(open).toHaveBeenCalledWith('one'));
    expect(takeProjectComposerPrefill('one')?.text).toBe('Make a knight in this style');
  });

  it('keeps failures visible and does not navigate after a failed style write', async () => {
    vi.mocked(setProjectArtStyle).mockRejectedValue(new Error('Write failed'));
    const open = vi.fn();
    render(<StoreProjectActions projects={[{ id: 'one', name: 'First' }]} onOpenProject={open} />);
    fireEvent.click(screen.getByText('Use style'));
    expect((await screen.findByRole('alert')).textContent).toContain('Write failed');
    expect(open).not.toHaveBeenCalled();
  });

  it('explains the project requirement when there is no project', () => {
    render(<StoreProjectActions projects={[]} onOpenProject={vi.fn()} />);
    fireEvent.click(screen.getByText('Try example'));
    expect(screen.getByText('store.action.projectRequired')).toBeTruthy();
  });
});
