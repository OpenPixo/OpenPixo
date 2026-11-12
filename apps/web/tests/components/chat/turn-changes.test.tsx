// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TurnChanges } from '../../../src/components/chat/TurnChanges';
import type { TurnChangeRow } from '../../../src/runtime/chat/turn-changes';

afterEach(cleanup);

const row = (path: string, overrides: Partial<TurnChangeRow> = {}): TurnChangeRow => ({
  path, status: 'modified', added: 2, removed: 1, checkpointId: 'cp-1', ...overrides,
});

describe('TurnChanges', () => {
  it('says how many files and lines changed, and opens a row', () => {
    const onOpenRow = vi.fn();
    const rows = [row('src/game.js'), row('README.md', { status: 'added', added: 3, removed: 0 })];
    render(<TurnChanges rows={rows} onOpenRow={onOpenRow} />);
    const section = screen.getByTestId('chat-turn-changes');
    expect(within(section).getByText('Files changed: 2')).toBeInTheDocument();
    expect(section).toHaveTextContent('+5');
    expect(section).toHaveTextContent('−1');
    fireEvent.click(screen.getByTestId('chat-turn-change-src/game.js'));
    expect(onOpenRow).toHaveBeenCalledWith(rows[0]);
  });

  it('draws nothing for a turn that changed no files', () => {
    const { container } = render(<TurnChanges rows={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('does not make up a total when a file has no line counts', () => {
    render(<TurnChanges rows={[row('a.js'), row('b.bin', { added: null, removed: null })]} />);
    const head = screen.getByText('Files changed: 2').parentElement!;
    expect(head).not.toHaveTextContent('+2');
  });

  it('keeps a long list short until asked', () => {
    render(<TurnChanges rows={Array.from({ length: 8 }, (_, index) => row(`f${index}.js`))} onOpenRow={vi.fn()} />);
    expect(screen.queryByTestId('chat-turn-change-f7.js')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show 3 more' }));
    expect(screen.getByTestId('chat-turn-change-f7.js')).toBeInTheDocument();
  });

  it('offers the whole view only where it was given, and leaves a gone file unclickable', () => {
    const onViewAll = vi.fn();
    const { rerender } = render(<TurnChanges rows={[row('a.js')]} onViewAll={onViewAll} />);
    fireEvent.click(screen.getByTestId('chat-turn-changes-all'));
    expect(onViewAll).toHaveBeenCalled();
    rerender(<TurnChanges rows={[row('gone.js', { status: 'deleted', checkpointId: null })]} onOpenRow={vi.fn()} />);
    expect(screen.queryByTestId('chat-turn-changes-all')).toBeNull();
    expect(screen.getByTestId('chat-turn-change-gone.js').tagName).toBe('DIV');
    expect(screen.getByText('gone.js')).toBeInTheDocument();
  });
});
