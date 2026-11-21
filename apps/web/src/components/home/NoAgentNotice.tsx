import { useEffect, useRef } from 'react';
import { Button } from '@openpixo/components';
import { TriangleAlert } from 'lucide-react';
import { isCloudAccountAvailable, useOpenPixoAccount, useOpenPixoCredits } from '../../hooks/useOpenPixoAccount';
import { useI18n } from '../../i18n';
import type { AgentInfo, AppConfig } from '../../types';
import { noAgentNotice, type NoAgentNotice as NoAgentNoticeState } from '../onboarding/setup-readiness';
import type { Dict } from '../../i18n/types';
import { publishHomeSetupInputs } from './home-setup-facts';
import styles from './NoAgentNotice.module.css';

const BODY_KEYS: Record<NoAgentNoticeState['kind'], keyof Dict> = {
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
 * An inline notice above the Home composer when no AI can build a game yet:
 * one line saying so and the one way out that fits (sign in, buy credits, or
 * set up the user's own tools), with own tools as a quiet alternative. The
 * rule lives in `noAgentNotice`; this only draws it.
 *
 * It is also where the shell's agent and config facts reach Home, so it
 * publishes them for the getting-started list (`home-setup-facts`).
 */
export function NoAgentNotice({ agents, agentsLoading, config, onSignIn, onBuyCredits, onSetUpOwnTools }: NoAgentNoticeProps) {
  const { t } = useI18n();
  const account = useOpenPixoAccount();
  const cloudAvailable = isCloudAccountAvailable(account.status);
  const signedIn = cloudAvailable && account.status?.signedIn === true;
  const credits = useOpenPixoCredits(signedIn);

  const setUpRef = useRef(onSetUpOwnTools);
  setUpRef.current = onSetUpOwnTools;
  useEffect(() => {
    publishHomeSetupInputs({ agents, agentsLoading, config, openSetup: () => setUpRef.current() });
  }, [agents, agentsLoading, config]);
  useEffect(() => () => publishHomeSetupInputs(null), []);

  const notice = noAgentNotice({
    loading: agentsLoading || (account.loading && !account.status) || (signedIn && credits.loading && !credits.credits),
    cloudAvailable,
    cloud: { signedIn, credits: credits.credits },
    agents,
    config,
  });
  if (!notice) return null;
  const action = notice.kind === 'sign-in'
    ? <Button variant="primary" size="sm" onClick={onSignIn} data-testid="home-no-agent-sign-in">{t('home.noAgent.signIn')}</Button>
    : notice.kind === 'buy-credits'
      ? <Button variant="primary" size="sm" onClick={onBuyCredits} data-testid="home-no-agent-buy">{t('home.noAgent.buyCredits')}</Button>
      : <Button variant="primary" size="sm" onClick={onSetUpOwnTools} data-testid="home-no-agent-own-tools">{t('home.noAgent.ownTools')}</Button>;
  return (
    <div className={styles.notice} role="status" aria-label={t('home.noAgent.title')}
      data-testid="home-no-agent-notice" data-kind={notice.kind}>
      <span className={styles.icon} aria-hidden="true"><TriangleAlert size={16} /></span>
      <p className={styles.message}>
        {t(BODY_KEYS[notice.kind])}
        {notice.kind !== 'own-tools-only' && <>
          {' '}
          <button type="button" className={styles.alt} onClick={onSetUpOwnTools} data-testid="home-no-agent-own-tools">
            {t('home.noAgent.ownToolsAlt')}
          </button>
        </>}
      </p>
      <div className={styles.action}>{action}</div>
    </div>
  );
}
