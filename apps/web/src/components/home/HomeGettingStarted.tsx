import { useId, useState } from 'react';
import { Button, VisuallyHidden } from '@openpixo/components';
import type { FirstRunGuidePrefs } from '@openpixo/contracts';
import { ArrowUpRight, Check, X } from 'lucide-react';
import { isCloudAccountAvailable, useOpenPixoAccount, useOpenPixoCredits } from '../../hooks/useOpenPixoAccount';
import { useI18n } from '../../i18n';
import type { Dict } from '../../i18n/types';
import type { Project } from '../../types';
import { readyAgentSource, readyImageSource } from '../onboarding/setup-readiness';
import { useCodexImageStatus } from '../onboarding/useCodexImageStatus';
import {
  gettingStartedSteps, readGettingStartedDismissed, writeGettingStartedDismissed,
  type GettingStartedStepId, type SetupFact,
} from './getting-started';
import { useHomeSetupInputs } from './home-setup-facts';
import styles from './HomeGettingStarted.module.css';

const COPY: Record<GettingStartedStepId, { title: keyof Dict; body: keyof Dict; action: keyof Dict }> = {
  ai: { title: 'home.start.aiTitle', body: 'home.start.aiBody', action: 'home.start.aiAction' },
  image: { title: 'home.start.imageTitle', body: 'home.start.imageBody', action: 'home.start.imageAction' },
  guide: { title: 'home.start.guideTitle', body: 'home.start.guideBody', action: 'home.start.guideAction' },
  'first-game': { title: 'home.start.gameTitle', body: 'home.start.gameBody', action: 'home.start.gameAction' },
  run: { title: 'home.start.runTitle', body: 'home.start.runBody', action: 'home.start.runAction' },
};

interface Props {
  projects: readonly Project[];
  /** The walkthrough's saved state; null or undefined while it was never started. */
  guide: FirstRunGuidePrefs | null | undefined;
  /** Starts the walkthrough, or goes on from where it stopped. */
  onStartGuide?: () => void;
  guideBusy?: boolean;
  onStartGame: () => void;
  onOpenProject: (id: string) => void;
}

/**
 * "开始做游戏": the first steps a new maker has not finished yet, each with
 * the one action that finishes it. Gone once every step is done, or for good
 * once dismissed (a browser preference: no app-config field fits it).
 */
export function HomeGettingStarted({ projects, guide, onStartGuide, guideBusy, onStartGame, onOpenProject }: Props) {
  const { t } = useI18n();
  const titleId = useId();
  const inputs = useHomeSetupInputs();
  const [dismissed, setDismissed] = useState(readGettingStartedDismissed);
  const watching = Boolean(inputs) && !dismissed;
  // NoAgentNotice already loads the account; read the shared answer only.
  const account = useOpenPixoAccount({ load: false });
  const cloudAvailable = isCloudAccountAvailable(account.status);
  const signedIn = cloudAvailable && account.status?.signedIn === true;
  const credits = useOpenPixoCredits(watching && signedIn);
  const codex = useCodexImageStatus(watching);

  const cloud = { signedIn, credits: credits.credits };
  const cloudLoading = (account.loading && !account.status) || (signedIn && credits.loading && !credits.credits);
  const agentReady: SetupFact = !inputs ? 'unknown'
    : inputs.agentsLoading || cloudLoading ? 'loading'
    : readyAgentSource({ cloud, agents: inputs.agents, config: inputs.config }) !== null;
  const imageReady: SetupFact = !inputs ? 'unknown'
    : cloudLoading || codex.status === null ? 'loading'
    : readyImageSource({ cloud, codexImage: codex.status, mediaProviders: inputs.config.mediaProviders }) !== null;

  if (dismissed) return null;
  const steps = gettingStartedSteps({ projects, guide, agentReady, imageReady });
  if (!steps) return null;
  const done = steps.filter(step => step.done).length;
  if (done === steps.length) return null;

  const latest = projects.reduce<Project | null>((best, item) => !best || item.updatedAt > best.updatedAt ? item : best, null);
  const action = (id: GettingStartedStepId): { onClick: () => void; external?: boolean; busy?: boolean } | null => {
    switch (id) {
      case 'ai':
      case 'image':
        return inputs ? { onClick: inputs.openSetup, external: true } : null;
      case 'guide':
        return onStartGuide ? { onClick: onStartGuide, busy: guideBusy } : null;
      case 'first-game':
        return { onClick: onStartGame };
      case 'run':
        return latest ? { onClick: () => onOpenProject(latest.id) } : null;
    }
  };

  return <section className={styles.card} aria-labelledby={titleId} data-testid="home-getting-started">
    <div className={styles.head}>
      <div className={styles.heading}>
        <h2 id={titleId} className={styles.title}>{t('home.start.title')}</h2>
        <p className={styles.lede}>{t('home.start.lede')}</p>
      </div>
      <div className={styles.meta}>
        <span className={styles.track} role="progressbar" aria-label={t('home.start.title')}
          aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done}>
          <span className={styles.fill} style={{ width: `${(done / steps.length) * 100}%` }} />
        </span>
        <span className={styles.count}>{t('home.start.progress', { done, total: steps.length })}</span>
        <Button variant="ghost" size="icon" className={styles.dismiss} aria-label={t('home.start.dismiss')}
          title={t('home.start.dismiss')} data-testid="home-getting-started-dismiss"
          onClick={() => { writeGettingStartedDismissed(); setDismissed(true); }}>
          <X size={14} aria-hidden="true" />
        </Button>
      </div>
    </div>
    <ol className={styles.rows}>
      {steps.map((step, index) => {
        const copy = COPY[step.id];
        const next = step.done ? null : action(step.id);
        return <li key={step.id} className={`${styles.row}${step.done ? ` ${styles.done}` : ''}`}
          data-step={step.id} data-done={step.done ? 'true' : 'false'}>
          <span className={styles.mark} aria-hidden="true">{step.done ? <Check size={12} strokeWidth={2.5} /> : index + 1}</span>
          <div className={styles.copy}>
            <p className={styles.rowTitle}>
              {step.done && <VisuallyHidden>{t('home.start.doneLabel')} </VisuallyHidden>}
              {t(copy.title)}
            </p>
            <p className={styles.rowBody}>{t(copy.body)}</p>
          </div>
          {next && <Button variant="secondary" size="sm" className={styles.action} disabled={next.busy}
            aria-busy={next.busy || undefined} onClick={next.onClick}>
            {next.busy ? t('home.start.sampleBusy')
              : t(step.id === 'guide' && guide?.projectId ? 'home.start.guideResume' : copy.action)}
            {next.external && <ArrowUpRight size={13} aria-hidden="true" />}
          </Button>}
        </li>;
      })}
    </ol>
  </section>;
}
