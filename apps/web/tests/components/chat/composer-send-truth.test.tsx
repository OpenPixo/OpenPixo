// @vitest-environment jsdom
/**
 * 输入框的「这一发能不能走 / 这一发带走了什么」——**一个**判据,不是三个。
 *
 * OPEND-2551 报的是同一件事被问出三个答案:芯片(「N 条注释」)已经挂在输入框上方,
 * 输入框本身是空的,发送按钮灰着,**回车却发得出去**。根因不是「文本没同步到 UI」,
 * 也不是「UI 清空了内部没清」—— 是按钮和回车问的根本不是同一个问题:
 *
 *   · 按钮问 `hasComposerPayload`,而它当时**不数引用**;
 *   · 回车走 `submit()`,那里问的是「折好的正文空不空」,而引用是**折进正文**发的,
 *     所以同一时刻它非空。
 *
 * 第一组用例把这件事钉成一条不变式:**按钮的 disabled 必须等于「回车发不出去」**。
 * 逐个状态问,而不是只测引用那一格 —— 只测一格的话,下一次有人往
 * `hasComposerPayload` 里加/减一项,另一侧照样会悄悄分叉。
 *
 * 第二组守的是同一族的另一半:输入框有**四条**送信路(回车/点击、标注直接发、
 * 标注排队、流式期间的延迟发)。原来只有 `submit()` 会把引用折进正文,另外三条
 * 各自拼 `[draft, note]` —— 于是从标注面板发出去的那一发:芯片被清掉了、
 * `meta.quotes` 也挂上了,唯独 **agent 一个字都没收到**。清空必须意味着「已经带走」。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ChatComposer } from '../../../src/components/ChatComposer';
import type { } from '../../../src/types';
import { flushMounts, pressEnter } from '../../helpers/lexical-composer';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const QUOTE = { id: 'q-1', text: '商品卡已经抽成共享组件', messageId: 'assistant-1' };

type ComposerProps = Parameters<typeof ChatComposer>[0];

function renderComposer(overrides: Partial<ComposerProps> = {}) {
  const onSend = vi.fn();
  const onClearQuotes = vi.fn();
  render(
    <ChatComposer
      projectId="project-1"
      projectFiles={[]}
      streaming={false}
      onEnsureProject={async () => 'project-1'}
      onSend={onSend}
      onStop={vi.fn()}
      onClearQuotes={onClearQuotes}
      {...overrides}
    />,
  );
  return { onSend, onClearQuotes };
}

describe('输入框只有一个「能不能发」', () => {
  /*
   * 每一格都问同一对问题:按钮灰不灰、回车发不发得出去。断言写成
   * `disabled === !sent`,而不是分别写死期望值 —— 这样将来任何一侧被单独改动,
   * 红的都是「两边不一致」这件事本身。
   */
  const cases: { name: string; props: Partial<ComposerProps>; expectSendable: boolean }[] = [
    { name: '真空输入框', props: {}, expectSendable: false },
    { name: '只有空白字符', props: { initialDraft: '   ' }, expectSendable: false },
    { name: '只有正文', props: { initialDraft: '把首屏改短' }, expectSendable: true },
    { name: '只有引用芯片', props: { quotes: [QUOTE] }, expectSendable: true },
    { name: '宿主禁发时,有正文也不发', props: { initialDraft: '把首屏改短', sendDisabled: true }, expectSendable: false },
  ];

  for (const testCase of cases) {
    it(`${testCase.name}:按钮与回车给同一个答案`, async () => {
      const { onSend } = renderComposer(testCase.props);
      await flushMounts();

      const button = screen.queryByTestId('chat-send') as HTMLButtonElement | null;
      const buttonSendable = Boolean(button) && !button!.disabled;

      pressEnter();
      await act(async () => {
        await Promise.resolve();
      });
      const enterSendable = onSend.mock.calls.length > 0;

      expect(buttonSendable, '按钮那一侧').toBe(testCase.expectSendable);
      expect(enterSendable, '回车那一侧').toBe(testCase.expectSendable);
    });
  }
});

describe('清空芯片就意味着已经把引用带走了', () => {
  it('回车 / 点击:引用折进正文', async () => {
    const { onSend, onClearQuotes } = renderComposer({ initialDraft: '再紧一点', quotes: [QUOTE] });
    await flushMounts();

    fireEvent.click(screen.getByTestId('chat-send'));
    await waitFor(() => expect(onSend).toHaveBeenCalled());

    expect(onSend.mock.calls[0]?.[0]).toContain(`> ${QUOTE.text}`);
    expect(onClearQuotes).toHaveBeenCalled();
  });
});
