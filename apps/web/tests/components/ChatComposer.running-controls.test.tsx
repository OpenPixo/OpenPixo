// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatComposer } from '../../src/components/ChatComposer';
import { flushMounts } from '../helpers/lexical-composer';

afterEach(cleanup);

type ComposerProps = Parameters<typeof ChatComposer>[0];

function renderComposer(overrides: Partial<ComposerProps> = {}) {
  const onStop = vi.fn();
  const onSend = vi.fn();
  render(
    <ChatComposer
      projectId="project-1"
      projectFiles={[]}
      streaming
      onEnsureProject={async () => 'project-1'}
      onSend={onSend}
      onStop={onStop}
      {...overrides}
    />,
  );
  return { onStop, onSend };
}

describe('ChatComposer running controls', () => {
  it('offers stop immediately and keeps a separate running status without hovering', async () => {
    const { onStop, onSend } = renderComposer();
    await flushMounts();

    const stop = screen.getByRole('button', { name: /stop|停止/i });
    expect(stop.getAttribute('data-testid')).toBe('chat-stop');
    expect(stop.querySelector('[data-testid="composer-running-status"]')).toBeNull();

    const status = screen.getByTestId('composer-running-status');
    expect(status.getAttribute('role')).toBe('status');
    expect(status.textContent?.trim()).toBeTruthy();
    expect(screen.getByTestId('composer-running-dots').getAttribute('aria-hidden')).toBe('true');

    fireEvent.mouseLeave(stop);
    expect(screen.getByTestId('chat-stop-icon').getAttribute('aria-hidden')).toBe('true');
    fireEvent.click(stop);
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('keeps stop available while composing the next message', async () => {
    renderComposer({ initialDraft: 'Continue with the next step' });
    await flushMounts();

    expect(screen.getByRole('button', { name: /stop|停止/i }).getAttribute('disabled')).toBeNull();
    expect(screen.getByTestId('composer-running-status').getAttribute('role')).toBe('status');
  });

  it('removes the run controls when idle', async () => {
    renderComposer({ streaming: false });
    await flushMounts();

    expect(screen.queryByRole('button', { name: /stop|停止/i })).toBeNull();
    expect(screen.queryByTestId('composer-running-status')).toBeNull();
  });
});
