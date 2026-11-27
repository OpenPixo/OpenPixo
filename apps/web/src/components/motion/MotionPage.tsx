import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@openpixo/components';
import type { MotionCharacter, MotionSuggestion } from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import { useOpenPixoCredits } from '../../hooks/useOpenPixoAccount';
import { usePageNavigationReady } from '../../observability/navigation-timing';
import { dropMotionSuggestion, fetchMotionCharacters, motionErrorCode, refreshMotionStatus, useMotionStatus } from '../../providers/motion';
import { navigate } from '../../router';
import { formatCredits } from '../account/account-format';
import { Icon } from '../Icon';
import theme from '../generate/studio-theme.module.css';
import { errorText, isOpen } from './motion-text';
import { MotionCard } from './MotionCard';
import { MotionDetail } from './MotionDetail';
import { MotionMaker, useMotionMaker } from './MotionMaker';
import styles from './Motion.module.css';

export interface MotionPageGame { id: string; name: string; updatedAt?: number | string | undefined; createdAt?: number | string | undefined }

/** Work goes on in the cloud whether the page is open or not; this is only how often it is looked at. */
const LOOK_MS = 3_000;
/** A service that did not answer, or is paused, is asked again this often. */
const SERVICE_MS = 30_000;

/**
 * 动态角色: one character that moves, made from one portrait. Describe or show it, take the portrait,
 * confirm the price, and a few minutes later it moves here, ready to download or to put into a game.
 */
export function MotionPage({ characterId, games, onOpenAccount, onOpenProject }: {
  characterId: string | undefined;
  games: readonly MotionPageGame[];
  onOpenAccount: () => void;
  onOpenProject: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  const status = useMotionStatus(), signedIn = Boolean(status?.signedIn);
  const { credits } = useOpenPixoCredits(signedIn);
  const [characters, setCharacters] = useState<MotionCharacter[] | null>(null), [suggestions, setSuggestions] = useState<MotionSuggestion[]>([]);
  const [failed, setFailed] = useState<string | null>(null);
  const maker = useMotionMaker();
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const read = useCallback(async (): Promise<void> => {
    try {
      const next = await fetchMotionCharacters();
      if (!alive.current) return;
      setCharacters(next.characters);
      setSuggestions(next.suggestions);
      setFailed(null);
    } catch (error) {
      if (!alive.current) return;
      if (motionErrorCode(error) === 'ACCOUNT_SIGNED_OUT') void refreshMotionStatus();
      else setFailed(errorText(t, error));
    }
  }, [t]);
  useEffect(() => { if (signedIn) void read(); else setCharacters(null); }, [signedIn, read]);

  const unserved = signedIn && (!status?.service || status.service.paused);
  useEffect(() => {
    if (!unserved) return;
    const timer = setInterval(() => { if (document.visibilityState !== 'hidden') void refreshMotionStatus(); }, SERVICE_MS);
    return () => clearInterval(timer);
  }, [unserved]);

  // while something is made, look again
  const working = characters?.filter(c => c.state === 'making' || isOpen(c.job)).map(c => c.id).join() ?? '';
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => { if (document.visibilityState !== 'hidden') void read(); }, LOOK_MS);
    return () => clearInterval(timer);
  }, [working, read]);

  const sortedGames = useMemo(() => [...games].sort((a, b) => time(b) - time(a)), [games]);
  const open = characterId ? characters?.find(c => c.id === characterId) : undefined;
  usePageNavigationReady({ page: 'motion', visible: status !== null, ready: characters !== null || !signedIn, failure: failed !== null });

  const balance = credits ? <button type="button" className={styles.credits} onClick={onOpenAccount} data-testid="motion-credits">
    <span className={styles.creditsDot} aria-hidden="true" /><span>{t('generate.balance', { count: formatCredits(credits.available, locale) })}</span><span className={styles.topUp}>{t('generate.topUp')}</span>
  </button> : null;

  if (open && status?.available && signedIn) {
    return <main className={`${theme.studio} ${styles.page}`} data-theme="dark" data-testid="motion-detail">
      <MotionDetail key={open.id} character={open} games={sortedGames} balance={balance} onBack={() => navigate({ kind: 'home', view: 'motion' })} onOpenProject={onOpenProject}
        onChange={next => setCharacters(all => all?.map(c => c.id === next.id ? next : c) ?? null)}
        onDeleted={id => { setCharacters(all => all?.filter(c => c.id !== id) ?? null); navigate({ kind: 'home', view: 'motion' }, { replace: true }); }} />
    </main>;
  }

  let body;
  if (!status) body = <div className={styles.empty} aria-busy="true">{t('common.loading')}</div>;
  else if (!status.available) body = <div className={styles.empty}><p>{t('motion.unavailable')}</p></div>;
  else if (!status.signedIn) body = <div className={styles.empty}><p>{t('motion.signedOut')}</p><Button variant="primary" onClick={onOpenAccount}>{t('motion.signIn')}</Button></div>;
  else if (!characters) body = failed ? <div className={styles.empty} role="alert"><p>{failed}</p><Button onClick={() => void read()}>{t('motion.retry')}</Button></div> : <div className={styles.empty} aria-busy="true">{t('common.loading')}</div>;
  else {
    const failedOnes = characters.filter(c => c.state === 'failed'), others = characters.filter(c => c.state !== 'failed');
    const card = (c: MotionCharacter) => <MotionCard key={c.id} character={c} onOpen={() => navigate({ kind: 'home', view: 'motion', motionId: c.id })}
      onDeleted={() => setCharacters(all => all?.filter(x => x.id !== c.id) ?? null)} onChange={() => void read()} />;
    body = <>
      {status.service?.paused && <p className={styles.notice} role="status">{t('motion.paused')}</p>}
      {failed && <p className={styles.notice} role="alert">{failed}</p>}
      <MotionMaker maker={maker} service={status.service} available={credits?.available ?? null} onOpenAccount={onOpenAccount}
        onOrdered={job => { void read().then(() => { if (alive.current) navigate({ kind: 'home', view: 'motion', motionId: job.characterId }); }); }} />
      {suggestions.map(s => <div key={s.id} className={styles.suggestion}>
        <div><strong>{t('motion.suggested', { game: s.projectName })}</strong><p>{s.text}</p></div>
        <Button size="sm" variant="primary" onClick={() => { maker.setText(s.text); maker.setStep({ kind: 'describe' }); setSuggestions(all => all.filter(x => x.id !== s.id)); void dropMotionSuggestion(s.id).catch(() => {}); }}>{t('motion.useSuggestion')}</Button>
        <Button size="sm" variant="ghost" onClick={() => { setSuggestions(all => all.filter(x => x.id !== s.id)); void dropMotionSuggestion(s.id).catch(() => {}); }}>{t('motion.dismiss')}</Button>
      </div>)}
      <h2 className={styles.heading}>{t('motion.mine')} <span>{others.length || ''}</span></h2>
      {others.length ? <div className={styles.cards}>{others.map(card)}</div> : <p className={styles.none}>{t('motion.none')}</p>}
      {failedOnes.length > 0 && <><h2 className={styles.heading}>{t('motion.failedHeading')}</h2><div className={styles.cards}>{failedOnes.map(card)}</div></>}
    </>;
  }

  return <main className={`${theme.studio} ${styles.page}`} data-theme="dark" data-testid="motion-page">
    <div className={styles.scroll}>
      <header className={styles.header}>
        <h1>{t('motion.title')}</h1>
        <div className={styles.right}>{balance}</div>
      </header>
      {status?.available && <p className={styles.lead}>{t('motion.lead')}</p>}
      {characterId && characters && !open && <p className={styles.notice} role="status"><Icon name="info" size={14} /> {t('motion.gone')}</p>}
      {body}
    </div>
  </main>;
}

const time = (g: MotionPageGame): number => { const v = g.updatedAt ?? g.createdAt; return typeof v === 'number' ? v : Date.parse(v ?? '') || 0; };
