// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolRow } from '../../../src/components/chat/primitives/ToolRow';
import type { ToolRow as ToolRowData } from '../../../src/runtime/chat/contract';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function row(overrides: Partial<ToolRowData>): ToolRowData {
  return {
    kind: 'tool', id: 't', tool: 'edit', name: 'Edit', title: '', rawTitle: false,
    file: { path: 'C:/games/demo/src/game.js', label: 'game.js' }, pattern: null, hits: null, delta: { added: 1, removed: 1 },
    elapsedMs: null, pending: false, failed: false, failReason: null, command: null, terminal: null, ...overrides,
  };
}

const edit = { kind: 'edit' as const, edits: [{ before: 'const a = 1;', after: 'const a = 2;' }] };
const scope = { projectId: 'p', projectResolvedDir: 'C:/games/demo' };

describe('a file row with content', () => {
  it('names the file and its line counts, and expands in place to the change', () => {
    const { container } = render(<ToolRow row={row({ preview: edit })} fileScope={scope} />);
    expect(container).toHaveTextContent('+1');
    expect(container).toHaveTextContent('−1');
    expect(screen.queryByTestId('chat-code-view')).toBeNull();
    fireEvent.click(container.querySelector('summary')!);
    const code = screen.getByTestId('chat-code-view');
    expect(code).toHaveTextContent('src/game.js');
    expect(code).not.toHaveTextContent('C:/games');
    expect(code).toHaveTextContent('const a = 1;');
    expect(code).toHaveTextContent('const a = 2;');
  });

  it('copies the code as it now is', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const { container } = render(<ToolRow row={row({ preview: edit })} fileScope={scope} />);
    fireEvent.click(container.querySelector('summary')!);
    const copy = within(screen.getByTestId('chat-code-view')).getByTestId('chat-code-copy');
    fireEvent.click(copy);
    expect(writeText).toHaveBeenCalledWith('const a = 2;');
    await waitFor(() => expect(copy).toHaveTextContent('Copied'));
  });

  it('goes to the full diff from the code block and from the file name', () => {
    const onOpenFile = vi.fn();
    const { container } = render(<ToolRow row={row({ preview: edit })} fileScope={scope} onOpenFile={onOpenFile} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open game.js' }));
    expect(onOpenFile).toHaveBeenLastCalledWith('src/game.js');
    fireEvent.click(container.querySelector('summary')!);
    fireEvent.click(within(screen.getByTestId('chat-code-view')).getByRole('button', { name: 'Open in panel' }));
    expect(onOpenFile).toHaveBeenCalledTimes(2);
  });

  it('stays one line while the call is still writing, so nothing jumps', () => {
    const { container } = render(<ToolRow row={row({ preview: edit, pending: true })} fileScope={scope} running />);
    expect(container.querySelector('details')).toBeNull();
  });

  it('stays one line when the runtime gave no content (Codex)', () => {
    const { container } = render(<ToolRow row={row({ preview: null })} fileScope={scope} />);
    expect(container.querySelector('details')).toBeNull();
  });

  it('keeps long content from flooding the chat', () => {
    const text = Array.from({ length: 1000 }, (_, index) => `line ${index}`).join('\n');
    const { container } = render(<ToolRow row={row({ tool: 'write', name: 'Write', preview: { kind: 'write', text } })} fileScope={scope} />);
    fireEvent.click(container.querySelector('summary')!);
    const code = screen.getByTestId('chat-code-view');
    expect(code).toHaveTextContent('line 399');
    expect(code).not.toHaveTextContent('line 400');
    expect(code).toHaveTextContent('600 more lines');
  });
});

describe('a command row', () => {
  const command = row({ tool: 'exec', name: 'Bash', title: 'Build', file: null, delta: null, command: 'npm run build', terminal: 'ok' });

  it('copies the command and the output separately', () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const { container } = render(<ToolRow row={command} deferBody={false} />);
    fireEvent.click(container.querySelector('summary')!);
    fireEvent.click(screen.getByRole('button', { name: 'Copy command' }));
    expect(writeText).toHaveBeenLastCalledWith('npm run build');
    fireEvent.click(screen.getByRole('button', { name: 'Copy output' }));
    expect(writeText).toHaveBeenLastCalledWith('ok');
  });

  it('offers more room only for output too long for the window', () => {
    const { container, rerender } = render(<ToolRow row={command} deferBody={false} />);
    fireEvent.click(container.querySelector('summary')!);
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
    rerender(<ToolRow row={{ ...command, terminal: Array.from({ length: 30 }, (_, index) => `line ${index}`).join('\n') }} deferBody={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true');
  });
});
