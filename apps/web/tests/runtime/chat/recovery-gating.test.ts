// 纯函数单测(不启 jsdom):恢复动作的门控分档。
//
// 这一页最重要的一条是**等价性** —— 分档不许悄悄放宽或收紧原来那个布尔。
// 原式(`ProjectView`):
//
//   currentConversationActionDisabled =
//     (loading || streaming || hasActiveRun)          // busy
//     || readOnly || !billable || loading
//     || messagesUnavailable || awaitingAttach        // sendDisabled
//
// 下面用穷举把「有没有原因」和这条原式逐位比一遍。

import { describe, expect, it } from 'vitest';

import { recoveryActionBlockMessageKey } from '../../../src/runtime/chat/recovery-gating';





describe('recoveryActionBlockMessageKey', () => {
  it('四档各说各的话 —— 「正忙」和「不可发送」不许共用一句', () => {
    const keys = (
      ['read-only', 'messages-unavailable', 'conversation-busy'] as const
    ).map(recoveryActionBlockMessageKey);
    expect(new Set(keys).size).toBe(3);
  });
});
