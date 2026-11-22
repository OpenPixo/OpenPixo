// @vitest-environment jsdom
/**
 * C18 (2026-11-21): the queue row's leading button says what it does.
 *
 * It used to read 「引导对话」 on every agent and every row, while a click on a
 * runtime that cannot take a message mid-turn stopped the running turn and
 * resent — on Codex the turn was then recorded as cancelled by the user. Now
 * there are three faces, picked from the daemon's answer
 * (`AgentInfo.midTurnSteering`), never from an agent's name:
 *
 *   · 引导对话 / Steer — a turn is running and the daemon can put the message
 *     into it; the turn keeps its work.
 *   · 停止并发送 / Stop and send — a turn is running and it cannot take the
 *     message (or the row carries more than text); asks first, because the
 *     running turn ends.
 *   · 立即发送 / Send now — nothing is running; it simply sends.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import { I18nProvider } from '../../../src/i18n';
import { QueuedSendStrip } from '../../../src/components/ChatPane';
import { en } from '../../../src/i18n/locales/en';

type StripProps = Parameters<typeof QueuedSendStrip>[0];

function renderStrip(overrides: Partial<StripProps> = {}) {
  const props: StripProps = {
    items: [{ id: 'q1', prompt: 'make the jump higher' }],
    onEdit: () => {},
    onRemove: () => {},
    onReorder: () => {},
    onSendNow: () => {},
    ...overrides,
  };
  return render(
    <I18nProvider>
      <QueuedSendStrip {...props} />
    </I18nProvider>,
  );
}

afterEach(cleanup);

describe('queue row leading button faces', () => {
  it('has copy for every face', () => {
    for (const key of [
      'chat.queuedSteer',
      'chat.queuedStopAndSend',
      'chat.queuedSendNow',
      'chat.queuedStopAndSendTitle',
      'chat.queuedStopAndSendBody',
      'chat.queuedStopAndSendConfirm',
    ] as const) {
      expect((en[key] ?? '').length, key).toBeGreaterThan(0);
    }
  });

  it('offers stop-and-send, with a confirm step, when the running turn cannot take the message', () => {
    const onSendNow = vi.fn();
    const onSteer = vi.fn();
    renderStrip({ turnInFlight: true, midTurnSteering: false, onSendNow, onSteer });

    const button = screen.getByTestId('chat-queued-send-steer');
    expect(button.textContent?.trim()).toBe(en['chat.queuedStopAndSend']);
    expect(button.getAttribute('aria-label')).toBe(en['chat.queuedStopAndSend']);
    expect(button.getAttribute('aria-label')).not.toBe(en['chat.queuedSteer']);

    fireEvent.click(button);
    // Nothing is stopped until the user confirms.
    expect(onSendNow).not.toHaveBeenCalled();
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toContain(en['chat.queuedStopAndSendBody']);
    fireEvent.click(within(dialog).getByRole('button', { name: en['chat.queuedStopAndSendConfirm'] }));
    expect(onSendNow).toHaveBeenCalledWith('q1');
    expect(onSteer).not.toHaveBeenCalled();
  });

  it('steers when the daemon says the running turn can take the message', () => {
    const onSendNow = vi.fn();
    const onSteer = vi.fn();
    renderStrip({ turnInFlight: true, midTurnSteering: true, onSendNow, onSteer });

    const button = screen.getByTestId('chat-queued-send-steer');
    expect(button.textContent?.trim()).toBe(en['chat.queuedSteer']);
    fireEvent.click(button);
    expect(onSteer).toHaveBeenCalledWith('q1');
    expect(onSendNow).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('falls back to stop-and-send for a row that carries more than text', () => {
    renderStrip({
      turnInFlight: true,
      midTurnSteering: true,
      onSteer: () => {},
      items: [
        { id: 'text', prompt: 'shorter' },
        { id: 'image', prompt: 'like this', attachments: [{ path: 'a.png', name: 'a.png', kind: 'image' }] },
      ],
    });
    const [text, image] = screen.getAllByTestId('chat-queued-send-steer');
    expect(text!.textContent?.trim()).toBe(en['chat.queuedSteer']);
    expect(image!.textContent?.trim()).toBe(en['chat.queuedStopAndSend']);
  });

  it('just sends when nothing is running', () => {
    const onSendNow = vi.fn();
    renderStrip({ turnInFlight: false, midTurnSteering: true, onSendNow, onSteer: () => {} });

    const button = screen.getByTestId('chat-queued-send-steer');
    expect(button.textContent?.trim()).toBe(en['chat.queuedSendNow']);
    fireEvent.click(button);
    expect(onSendNow).toHaveBeenCalledWith('q1');
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});
