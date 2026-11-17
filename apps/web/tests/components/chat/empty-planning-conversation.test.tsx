// @vitest-environment jsdom
/**
 * A new game whose creator unticked 「创建后立即开始规划」 opened on a blank chat that
 * said only 「描述想完成的任务」, and the composer's examples were about polishing an
 * existing game. Nothing said planning comes first or how to start it (seen 2026-11-18).
 * The empty chat of a game still in planning now says what happens and offers the same
 * first message the setup dialog would have sent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ProjectMetadata } from '@openpixo/contracts';
import { ChatPane, blankComposerScenarios } from '../../../src/components/ChatPane';
import { I18nProvider, tForLanguageTag } from '../../../src/i18n';

const planning: ProjectMetadata = {
  kind: 'prototype',
  gamePlan: { status: 'planning', startedAt: 1_700_000_000_000 },
  gameSetup: { title: '跳跳猫', genre: 'platformer', scope: 'quick' },
} as ProjectMetadata;

function renderPane(metadata: ProjectMetadata | undefined, onSend = vi.fn()) {
  render(
    <I18nProvider initial="zh-CN">
      <ChatPane
        projectKindForTracking="prototype"
        messages={[]}
        streaming={false}
        error={null}
        projectId="project-1"
        projectFiles={[]}
        {...(metadata ? { projectMetadata: metadata } : {})}
        onEnsureProject={async () => 'project-1'}
        onSend={onSend}
        onStop={() => {}}
        conversations={[]}
        activeConversationId="conversation-1"
        onSelectConversation={() => {}}
        onDeleteConversation={() => {}}
      />
    </I18nProvider>,
  );
  return onSend;
}

describe('empty chat of a game still in planning', () => {
  const originalScrollIntoView = Element.prototype.scrollIntoView;
  if (typeof HTMLElement.prototype.scrollTo !== 'function') {
    HTMLElement.prototype.scrollTo = function () { /* jsdom has none */ };
  }
  beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); });
  afterEach(() => {
    cleanup();
    Element.prototype.scrollIntoView = originalScrollIntoView;
    vi.restoreAllMocks();
  });

  it('says planning comes first and starts it with the setup dialog\'s first message', () => {
    const onSend = renderPane(planning);
    const empty = screen.getByTestId('chat-empty-conversation');
    expect(empty.textContent).toContain('先和 AI 定下玩法');
    fireEvent.click(screen.getByRole('button', { name: '开始规划' }));
    expect(onSend).toHaveBeenCalledOnce();
    const [prompt] = onSend.mock.calls[0]!;
    expect(prompt).toContain('一起规划《跳跳猫》');
    expect(prompt).toContain('平台跳跃');
  });

  // The empty composer's rotating examples are sent as the message when the user
  // presses send without typing; during planning they asked to run and fix the game.
  it('offers the planning message, not build tasks, as the empty composer example', () => {
    const t = tForLanguageTag('zh-CN')!;
    const planningTexts = blankComposerScenarios(t, planning).map((scenario) => scenario.text);
    expect(planningTexts).toHaveLength(1);
    expect(planningTexts[0]).toContain('一起规划《跳跳猫》');
    const approved = blankComposerScenarios(t, { ...planning, gamePlan: { status: 'approved', startedAt: 1 } } as ProjectMetadata);
    expect(approved.map((scenario) => scenario.text).join(' ')).toContain('按照项目现有的引擎和启动说明运行游戏');
  });

  it('keeps the general empty chat once the plan is approved', () => {
    renderPane({ ...planning, gamePlan: { status: 'approved', startedAt: 1, approvedAt: 2 } } as ProjectMetadata);
    expect(screen.getByTestId('chat-empty-conversation').textContent).toContain('开始和 AI 一起做游戏');
    expect(screen.queryByRole('button', { name: '开始规划' })).toBeNull();
  });
});
