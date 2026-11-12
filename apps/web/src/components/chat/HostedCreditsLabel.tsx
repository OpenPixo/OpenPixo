import type { ReactElement } from 'react';
import { formatAgentCredits } from '@openpixo/contracts';
import { useT } from '../../i18n';
import styles from './HostedCreditsLabel.module.css';

export interface HostedCreditsUsage {
  requests: number;
  costMicrocredits: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

/** Latest running total a run on the OpenPixo-credits model reported, or null. */
export function latestHostedUsage(
  events: ReadonlyArray<{ kind?: string } & Partial<HostedCreditsUsage>> | undefined,
): HostedCreditsUsage | null {
  for (let index = (events?.length ?? 0) - 1; index >= 0; index--) {
    const event = events![index]!;
    if (event.kind !== 'hosted_usage') continue;
    return {
      requests: event.requests ?? 0,
      costMicrocredits: event.costMicrocredits ?? 0,
      inputTokens: event.inputTokens ?? 0,
      cachedInputTokens: event.cachedInputTokens ?? 0,
      outputTokens: event.outputTokens ?? 0,
    };
  }
  return null;
}

/** Metered usage, not whole-credit charges: the cloud carries sub-credit remainders. */
export function HostedCreditsLabel({ usage }: { usage: HostedCreditsUsage }): ReactElement {
  const t = useT();
  const credits = formatAgentCredits(usage.costMicrocredits);
  return (
    <span
      className={styles.label}
      data-testid="assistant-hosted-credits"
      title={t('assistant.hostedCreditsDetail', {
        requests: String(usage.requests),
        input: String(usage.inputTokens),
        cached: String(usage.cachedInputTokens),
        output: String(usage.outputTokens),
      })}
    >
      {t('assistant.hostedCreditsUsed', { credits })}
    </span>
  );
}
