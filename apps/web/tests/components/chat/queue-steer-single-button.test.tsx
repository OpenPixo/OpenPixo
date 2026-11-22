// @vitest-environment jsdom
/**
 * 队列行的领头动作键**只有一颗**,带可见文字标签,三处名字与标签逐字相同。
 *
 * ## 历史
 *
 * 2026-09-08 曾把两副面孔并成永远叫「引导对话」的一颗,而按下去在每个 agent 上
 * 都是「掐掉这一轮再发」。C18(2026-11-21)实测:Codex 上那一轮随后被记成
 * 「已取消 · 本次运行已按你的操作停止」—— 名字许诺的是引导,做的却是停止。
 * 所以名字改成说出按下去会发生什么(三副面孔见
 * `queue-leading-action-faces.test.tsx`),这一页只守**一颗、带标签、名字一致、
 * 排在最前**这几件和面孔无关的事。
 *
 * ## 稿子怎么画的
 *
 * `git show 729fa43ce7:docs/design/chat-panel-next.html` 组件 17「Queue」:
 * 每一行的动作组里领头的是一颗 `<svg/><span>…</span>` 的带标签键;稿子里**没有**
 * 只有图标的「立即发送」那一颗。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { I18nProvider } from '../../../src/i18n';
import { QueuedSendStrip } from '../../../src/components/ChatPane';
import { en } from '../../../src/i18n/locales/en';

type StripProps = Parameters<typeof QueuedSendStrip>[0];

function renderStrip(overrides: Partial<StripProps> = {}) {
  const props: StripProps = {
    items: [{ id: 'q1', prompt: '把首屏文案改短一点' }],
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

describe('队列行领头动作键:一颗、带标签、名字一致', () => {
  it('先证明这把尺子够得着 —— 三副面孔的文案在词典里确实存在且非空', () => {
    for (const key of ['chat.queuedSteer', 'chat.queuedStopAndSend', 'chat.queuedSendNow'] as const) {
      expect(typeof en[key]).toBe('string');
      expect((en[key] ?? '').length).toBeGreaterThan(0);
    }
  });

  it('没有在跑的一轮时,领头那颗是带文字标签的「立即发送」,不叫「引导对话」', () => {
    renderStrip();

    const lead = screen.getByTestId('chat-queued-send-steer');
    expect(lead.textContent?.trim()).toBe(en['chat.queuedSendNow']);
    expect(lead.textContent?.trim()).not.toBe(en['chat.queuedSteer']);
    expect(lead.querySelector('svg')).not.toBeNull();
    // 退回态那颗无标签图标键在稿子里根本不存在。
    expect(screen.queryByTestId('chat-queued-send-now')).toBeNull();
  });

  it.each([
    [{ turnInFlight: false }, 'chat.queuedSendNow'],
    [{ turnInFlight: true, midTurnSteering: false }, 'chat.queuedStopAndSend'],
    [{ turnInFlight: true, midTurnSteering: true, onSteer: () => {} }, 'chat.queuedSteer'],
  ] as const)('三处名字与可见标签逐字相同 (%o)', (overrides, key) => {
    renderStrip(overrides);

    const lead = screen.getByTestId('chat-queued-send-steer');
    const expected = en[key];
    expect(lead.textContent?.trim()).toBe(expected);
    expect(lead.getAttribute('aria-label')).toBe(expected);
    expect(lead.getAttribute('data-tooltip')).toBe(expected);
    expect(lead.getAttribute('title')).toBe(expected);
    expect(lead.getAttribute('aria-label')).not.toBe(en['chat.queuedSteerInterrupts']);
  });

  it('只有一颗:带标签的样式永远生效', () => {
    renderStrip({ turnInFlight: true });

    const lead = screen.getByTestId('chat-queued-send-steer');
    expect(lead.classList.contains('chat-queued-send-action')).toBe(true);
    expect(lead.classList.contains('chat-queued-send-action-steer')).toBe(true);
    expect(screen.getAllByTestId('chat-queued-send-steer')).toHaveLength(1);
  });

  it('没在跑时点下去直接把这一条发出去', () => {
    const onSendNow = vi.fn();
    renderStrip({ onSendNow });

    fireEvent.click(screen.getByTestId('chat-queued-send-steer'));
    expect(onSendNow).toHaveBeenCalledTimes(1);
    expect(onSendNow).toHaveBeenCalledWith('q1');
  });

  it('顺序:领头 → 编辑 → 删除(OPEND-2715)', () => {
    renderStrip({ turnInFlight: true });

    const labels = [...document.querySelectorAll('.chat-queued-send-action')].map(
      (el) => el.getAttribute('aria-label') ?? '',
    );
    expect(labels).toEqual([
      en['chat.queuedStopAndSend'],
      en['chat.queuedEdit'],
      en['common.remove'],
    ]);
  });
});
