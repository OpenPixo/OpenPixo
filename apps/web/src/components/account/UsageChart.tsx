import { useMemo } from 'react';
import type { OpenPixoLedgerEntry } from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import { formatCredits } from './account-format';
import { usageDays } from './usage-days';
import styles from './UsageChart.module.css';

export type UsageRange = '7' | '30';
export const USAGE_RANGES: readonly UsageRange[] = ['7', '30'];

/** Fewer days with any use than this, over the longest range, and the page shows the list alone. */
export const USAGE_CHART_MIN_ACTIVE_DAYS = 2;

/** Whether the ledger read so far has enough dated use to be worth a chart. */
export function hasUsageChartData(entries: readonly OpenPixoLedgerEntry[], now = Date.now()): boolean {
  return usageDays(entries, Number(USAGE_RANGES[USAGE_RANGES.length - 1]), now, false).activeDays >= USAGE_CHART_MIN_ACTIVE_DAYS;
}

function formatDay(ms: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(new Date(ms));
}

/**
 * Credits used per day, as bars. The list below the chart is its table view, so
 * the chart itself is one labelled image; hover shows a day's exact amount.
 */
export function UsageChart({ entries, hasOlder, range, now = Date.now() }: {
  entries: readonly OpenPixoLedgerEntry[];
  /** The ledger has older entries than those read. */
  hasOlder: boolean;
  range: UsageRange;
  now?: number;
}) {
  const { t, locale } = useI18n();
  const count = Number(range);
  const usage = useMemo(() => usageDays(entries, count, now, hasOlder), [entries, count, now, hasOlder]);
  const max = Math.max(1, ...usage.days.map((day) => day.credits));
  const total = t('account.usage.total', { n: formatCredits(usage.total, locale), days: count });

  return (
    <div className={styles.chart} data-testid="account-usage-chart">
      <p className={styles.total}>{total}</p>
      <div className={styles.plot} role="img" aria-label={total}>
        <span className={styles.maxLine} aria-hidden="true"><span>{formatCredits(max, locale)}</span></span>
        <div className={styles.bars} data-range={range} aria-hidden="true">
          {usage.days.map((day) => {
            const tip = t('account.usage.dayTip', { date: formatDay(day.start, locale), n: formatCredits(day.credits, locale) });
            return (
              <div key={day.start} className={styles.column}>
                <span className={styles.bar} data-empty={day.credits === 0}
                  style={{ height: day.credits === 0 ? undefined : `max(2px, ${(day.credits / max) * 100}%)` }} />
                <span className={styles.tip}>{tip}</span>
              </div>
            );
          })}
        </div>
      </div>
      <div className={styles.axis} aria-hidden="true">
        <span>{formatDay(usage.days[0]!.start, locale)}</span>
        <span>{formatDay(usage.days[usage.days.length - 1]!.start, locale)}</span>
      </div>
      {usage.coveredFrom !== null && (
        <p className={styles.partial}>{t('account.usage.partial', { date: formatDay(usage.coveredFrom, locale) })}</p>
      )}
    </div>
  );
}
