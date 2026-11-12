// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssistantMessage } from '../../src/components/AssistantMessage';
import type { ChatMessage } from '../../src/types';

const t = (key: string) => key === 'chat.plus.mcp' ? 'MCP' : key;
vi.mock('../../src/i18n', () => ({
  useI18n: () => ({ locale: 'en', setLocale: () => undefined, t }),
  useT: () => t,
}));

afterEach(cleanup);

function message(streaming: boolean): ChatMessage {
  return {
    id: 'assistant-mcp-feedback', role: 'assistant', content: 'Code task completed.', createdAt: 1,
    runId: 'run-mcp-feedback', runStatus: streaming ? 'running' : 'succeeded', agentId: 'codex',
    events: [
      { kind: 'status', label: 'mcp_connection', detail: 'asset-tools: starting' },
      { kind: 'status', label: 'mcp_connection', detail: 'asset-tools: failed — MCP startup failed: connection timed out' },
      { kind: 'status', label: 'mcp_connection', detail: 'asset-tools: failed — MCP startup failed: connection timed out\nfilesystem: ready' },
      { kind: 'text', text: 'Code task completed.' },
    ],
  } as ChatMessage;
}

describe('Codex MCP connection feedback in chat', () => {
  it.each([true, false])('hides connection startup diagnostics when streaming=%s', streaming => {
    render(<AssistantMessage projectKind="prototype" conversationId="conv-mcp-feedback"
      message={message(streaming)} streaming={streaming} projectId="project-mcp-feedback" />);
    expect(screen.queryByTestId('mcp-connection-status')).toBeNull();
    expect(screen.getByTestId('assistant-message').textContent).not.toContain('MCP');
    expect(screen.getByTestId('assistant-message').textContent).not.toContain('asset-tools');
    expect(screen.getByTestId('assistant-message').textContent).not.toContain('connection timed out');
    expect(screen.queryByText('chat.record.runFailed')).toBeNull();
    expect(screen.getByText('Code task completed.')).toBeTruthy();
  });

  it('hides interleaved startup snapshots in history while preserving tool work and the answer', () => {
    const current = message(false);
    current.events!.splice(1, 0,
      { kind: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: 'README.md' } },
      { kind: 'tool_result', toolUseId: 'read-1', content: 'Project readme', isError: false },
    );
    render(<AssistantMessage projectKind="prototype" conversationId="conv-mcp-feedback"
      message={current} streaming={false} projectId="project-mcp-feedback" />);
    expect(screen.queryByTestId('mcp-connection-status')).toBeNull();
    expect(screen.getByTestId('assistant-message').textContent).not.toContain('MCP');
    fireEvent.click(screen.getByText('chat.record.done').closest('summary')!);
    expect(screen.getByTestId('assistant-message').textContent).toContain('README.md');
    expect(screen.getByText('Code task completed.')).toBeTruthy();
  });

  it('hides a startup status even when it carries no detail', () => {
    const current = message(false);
    current.events = [{ kind: 'status', label: 'mcp_connection' }, { kind: 'text', text: 'Code task completed.' }];
    render(<AssistantMessage projectKind="prototype" conversationId="conv-mcp-feedback"
      message={current} streaming={false} projectId="project-mcp-feedback" />);
    expect(screen.queryByTestId('status-pill')).toBeNull();
    expect(screen.getByText('Code task completed.')).toBeTruthy();
  });
});
