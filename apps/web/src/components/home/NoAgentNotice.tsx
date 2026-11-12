import { Button } from '@openpixo/components';
import { isCloudAccountAvailable, useOpenPixoAccount, useOpenPixoCredits } from '../../hooks/useOpenPixoAccount';
import { useI18n } from '../../i18n';
import type { AgentInfo, AppConfig } from '../../types';
import { Icon } from '../Icon';
import { noAgentNotice, type NoAgentNotice as Notice } from '../onboarding/setup-readiness';
import type { Dict } from '../../i18n/types';
import styles from './NoAgentNotice.module.css';

const BODY_KEYS: Record<Notice['kind'], keyof Dict> = {
  'sign-in': 'home.noAgent.bodySignIn',
  'buy-credits': 'home.noAgent.bodyBuy',
  'own-tools-only': 'home.noAgent.bodyOwnTools',
};

export interface NoAgentNoticeProps {
  agents: readonly AgentInfo[];
  agentsLoading: boolean;
  config: AppConfig;
  onSignIn: () => void;
  onBuyCredits: () => void;
  /** Opens the first-run setup again, where own tools are set up step by step. */
  onSetUpOwnTools: () => void;
}

/**
 * A card above the Home composer when no AI can build a game yet, with the
 * way out first: sign in, buy credits, or set up the user's own tools. The
 * rule lives in `noAgentNotice`; this only draws it.
 */
export function NoAgentNotice({ agents, agentsLoading, config, onSignIn, onBuyCredits, onSetUpOwnTools }: NoAgentNoticeProps) {
  const { t } = useI18n();
  const account = useOpenPixoAccount();
  const cloudAvailable = isCloudAccountAvailable(account.status);
  const signedIn = cloudAvailable && account.status?.signedIn === true;
  const credits = useOpenPixoCredits(signedIn);
  const notice = noAgentNotice({
    loading: agentsLoading || (account.loading && !account.status) || (signedIn && credits.loading && !credits.credits),
    cloudAvailable,
    cloud: { signedIn, credits: credits.credits },
    agents,
    config,
  });
  if (!notice) return null;
  const ownTools = (
    <Button variant={notice.kind === 'own-tools-only' ? 'primary' : 'secondary'} size="sm" onClick={onSetUpOwnTools}
      data-testid="home-no-agent-own-tools">
      {t('home.noAgent.ownTools')}
    </Button>
  );
  return (
    <div className={styles.notice} role="status" data-testid="home-no-agent-notice" data-kind={notice.kind}>
      <span className={styles.icon} aria-hidden="true"><Icon name="info" size={16} /></span>
      <div className={styles.copy}>
        <p className={styles.title}>{t('home.noAgent.title')}</p>
        <p className={styles.body}>{t(BODY_KEYS[notice.kind])}</p>
      </div>
      <div className={styles.actions}>
        {notice.kind === 'sign-in' ? (
          <Button variant="primary" size="sm" onClick={onSignIn} data-testid="home-no-agent-sign-in">
            {t('home.noAgent.signIn')}
          </Button>
        ) : null}
        {notice.kind === 'buy-credits' ? (
          <Button variant="primary" size="sm" onClick={onBuyCredits} data-testid="home-no-agent-buy">
            {t('home.noAgent.buyCredits')}
          </Button>
        ) : null}
        {ownTools}
      </div>
    </div>
  );
}
