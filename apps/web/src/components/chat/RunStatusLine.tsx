/**
 * 输入框上方那一行:**现在整体在干什么**,用一句人话说(判据在 `runtime/chat/run-status.ts`)。
 *
 * 用户原话:「希望能有一个地方一直展示当前整体在干什么,因为有些小白用户可能看不太懂
 * 整体的运行状态」。所以这一行**一直在**:跑着说在跑什么,停下说停在哪(等你回答 /
 * 已完成 / 出错),没开始说「就绪」。它永远挂着,高度不变,不会在一轮开始和结束时
 * 把输入框顶上顶下。
 *
 * ── 为什么不是 Plan 药丸的扩展 ──────────────────────────────────────────
 * 药丸只在「跑着 + 有清单 + 贴着底」时出现,往上一滚就让位给「回到最新」,一轮跑完就走;
 * 而这一行要的恰恰是**永远看得见**,而且没有清单的 agent(Codex 的一些轮次、简单问答)
 * 也得有话说。两个问题不同,就是两个东西:药丸答「第几步」并保留悬停清单,这一行答
 * 「此刻在干什么」并把当前那一步的名字当细节带上 —— 不再写一遍 N/M,免得两处各数一遍。
 *
 * ── 滚动管线 ────────────────────────────────────────────────────────────
 * 它住在 `ChatPane` 的 `composerNode` 里,也就是 `chat-composer-slot`(或 portal 出去的
 * 那一层)之内。那个插槽本来就在 `ChatPane` 的 ResizeObserver 名单上、挂载 / 卸载由
 * 面板级 MutationObserver 跟踪(`syncComposerSlot`),所以这一行**不需要**自己的
 * `containerRef`:它长高变矮都算进插槽的高度里。何况它的高度是钉死的一行。
 */
import type { ReactElement, ReactNode } from 'react';
import { Button } from '@openpixo/components';
import { useT } from '../../i18n';
import type { Dict } from '../../i18n/types';
import type { RunActivity, RunStatusLine as RunStatusLineData } from '../../runtime/chat/run-status';
import { Orb } from './primitives/Orb';
import record from './primitives/record.module.css';
import styles from './RunStatusLine.module.css';

const LABEL: Record<Exclude<RunActivity, 'generating'>, keyof Dict> = {
  idle: 'chat.status.idle',
  starting: 'chat.status.starting',
  thinking: 'chat.status.thinking',
  planning: 'chat.status.planning',
  reading: 'chat.status.reading',
  searching: 'chat.status.searching',
  browsing: 'chat.status.browsing',
  coding: 'chat.status.coding',
  writing: 'chat.status.writing',
  installing: 'chat.status.installing',
  testing: 'chat.status.testing',
  previewing: 'chat.status.previewing',
  running: 'chat.status.running',
  working: 'chat.status.working',
  replying: 'chat.status.replying',
  awaitingAnswer: 'chat.status.awaitingAnswer',
  awaitingApproval: 'chat.status.awaitingApproval',
  reconnecting: 'chat.status.reconnecting',
  done: 'chat.status.done',
  failed: 'chat.status.failed',
  stopped: 'chat.status.stopped',
};

const GENERATING: Record<NonNullable<RunStatusLineData['surface']>, keyof Dict> = {
  image: 'chat.status.generatingImage',
  audio: 'chat.status.generatingAudio',
  video: 'chat.status.generatingVideo',
  model3d: 'chat.status.generatingModel3d',
};

export function RunStatusLine({
  status,
  trailing,
  onJumpToQuestion,
}: {
  status: RunStatusLineData;
  trailing?: ReactNode;
  /**
   * Given while a question form waits for the user's answer: the waiting
   * sentence becomes a button ("A question above is waiting for you ↑") that
   * brings the form back into view (owner decision 2026-11-10). It lives in
   * this always-mounted, fixed-height line so no new pinned element is needed.
   */
  onJumpToQuestion?: () => void;
}): ReactElement {
  const t = useT();
  const busy = status.tone === 'busy';
  const jump = status.activity === 'awaitingAnswer' && onJumpToQuestion ? onJumpToQuestion : null;

  let activity = status.activity === 'generating'
    ? t(GENERATING[status.surface ?? 'image'])
    : t(LABEL[status.activity]);
  if (status.activity === 'generating' && status.progress) {
    activity += status.progress.done != null
      ? t('chat.status.progress', { done: status.progress.done, total: status.progress.total })
      : t('chat.status.progressTotal', { total: status.progress.total });
  }
  /* 当前那一步就是这句话本身时(activeForm 恰好等于状态词),不说两遍 */
  const step = status.step && status.step !== activity ? status.step : undefined;

  return (
    <div
      className={styles.line}
      data-testid="chat-run-status"
      data-activity={status.activity}
      data-tone={status.tone}
      role="group"
      aria-label={t('chat.status.label')}
    >
      <span className={styles.mark} aria-hidden>
        {busy
          ? <Orb state="solving" label="" className={record.orb} />
          : <span className={styles.dot} />}
      </span>
      {/* 读屏只念这一句(礼貌地、换了才念)。这里**不跑秒**:执行记录壳头已经有一只表,
          两只表起点不同(轮次 vs 壳)会对不上,同屏两个数字比一个都没有更让人困惑 */}
      <span className={styles.text} role="status">
        {jump ? (
          <Button
            variant="primary-ghost"
            size="sm"
            className={styles.jump}
            data-testid="chat-run-status-jump"
            onClick={jump}
          >
            {t('chat.status.jumpToQuestion')}
          </Button>
        ) : step ? (
          <>
            <span className={styles.step}>{step}</span>
            <span className={styles.sep} aria-hidden>·</span>
            <span className={styles.activity}>{activity}</span>
          </>
        ) : (
          <span className={styles.step}>{activity}</span>
        )}
      </span>
      {trailing}
    </div>
  );
}
