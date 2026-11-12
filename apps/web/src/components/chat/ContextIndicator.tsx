import type { ReactElement } from 'react';
import { useT } from '../../i18n';
import type { Dict } from '../../i18n/types';
import { formatContextTokens, type ContextUsageView } from '../../runtime/chat/context-usage';
import styles from './ContextIndicator.module.css';

/**
 * How much of the conversation's context is in use, beside the run status above the
 * composer. The numbers are the runtime's own; `latestContextUsage` returns null when it
 * has none, and then this is not mounted at all (chat/AGENTS.md §3).
 */
export function ContextIndicator({ usage }: { usage: ContextUsageView }): ReactElement {
  const t = useT();
  const used = formatContextTokens(usage.usedTokens);
  const limit = formatContextTokens(usage.limitTokens);
  const summary = t('chat.context.summary', { used, limit, percent: usage.percent });
  // Close means the next long tool result or file read could set off a compaction.
  const near = usage.untilCompactTokens !== null && usage.untilCompactTokens <= usage.limitTokens * 0.1;
  const { parts } = usage;
  const rows: Array<[keyof Dict, number | undefined]> = [
    ['chat.context.partFresh', parts.freshInputTokens],
    ['chat.context.partCached', parts.cachedInputTokens],
    ['chat.context.partCacheWrite', parts.cacheWriteTokens],
    ['chat.context.partOutput', parts.outputTokens],
    ['chat.context.partReasoning', parts.reasoningTokens],
  ];
  const meter = (
    <span className={styles.bar} aria-hidden>
      <span className={styles.fill} data-near={near || undefined} style={{ width: `${usage.percent}%` }} />
      {usage.autoCompactPercent ? <span className={styles.tick} style={{ left: `${usage.autoCompactPercent}%` }} /> : null}
    </span>
  );
  return (
    <span className={styles.root} tabIndex={0} aria-label={summary} data-testid="context-indicator">
      {meter}
      <span className={styles.value}>{used} / {limit}</span>
      <span className={styles.percent} data-near={near || undefined}>{usage.percent}%</span>
      <span className={styles.popover} role="tooltip" data-testid="context-indicator-tooltip">
        <strong className={styles.title}>{summary}</strong>
        <span className={styles.wideMeter}>{meter}</span>
        <span className={styles.rows}>
          {rows.map(([label, tokens]) => (tokens ? <Row key={label} label={t(label)} value={formatContextTokens(tokens)} /> : null))}
          {usage.autoCompactAtTokens
            ? <Row strong label={t('chat.context.compactAt')} value={formatContextTokens(usage.autoCompactAtTokens)} />
            : null}
          {usage.untilCompactTokens !== null
            ? <Row label={t('chat.context.untilCompact')} value={formatContextTokens(usage.untilCompactTokens)} />
            : null}
          <Row label={t('chat.context.compactions')} value={t('chat.context.compactionsValue', { count: usage.compactions })} />
        </span>
        <span>{t('chat.context.what')}</span>
        <span>{t('chat.context.when')}</span>
        <span>{t('chat.context.after')}</span>
      </span>
    </span>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }): ReactElement {
  return (
    <span className={styles.row} data-strong={strong || undefined}>
      <span>{label}</span>
      <span className={styles.rowValue}>{value}</span>
    </span>
  );
}

/** The short line a turn keeps when the runtime compacted the conversation during it. */
export function ContextCompactedNote({ tokensBefore }: { tokensBefore?: number | undefined }): ReactElement {
  const t = useT();
  return (
    <p className={styles.note} data-testid="context-compacted-note">
      {tokensBefore
        ? t('chat.context.compactedFrom', { tokens: formatContextTokens(tokensBefore) })
        : t('chat.context.compacted')}
    </p>
  );
}
