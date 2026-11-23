import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button } from '@openpixo/components';
import { isCloudAccountAvailable, useOpenPixoAccount, useOpenPixoCredits } from '../../hooks/useOpenPixoAccount';
import { useT } from '../../i18n';
import { queueProjectComposerPrefill } from '../../state/composer-prefill';
import {
  advanceFirstRunGuide,
  finishFirstRunGuide,
  skipFirstRunGuide,
  useFirstRunGuide,
} from '../../state/first-run-guide';
import type { AgentInfo, AppConfig, ChatMessage, Project } from '../../types';
import { SignInDialog } from '../account/SignInDialog';
import { GUIDE_TUNING_KEY, firstRunHint, guideAgent, guideAsk, type GuideRun } from './guide-state';
import { FirstRunHintStrip, GuideCard, type GuideTone } from './GuideCard';
import styles from './GuideCard.module.css';

/** What the 游戏 view needs to carry the walkthrough's first two steps and the share hint. */
export interface GameViewGuide {
  /** Drawn under the stage. */
  render: (run: GuideRun) => ReactNode;
  /** Set while a step points at the stage: the class that rings it. */
  stageRing: string | null;
  /** Set while a step points at one tuning control: its key, and the class that rings it. 调参 opens for it. */
  tuning: { key: string; ring: string } | null;
  /** The user has been in the running game for a while; null while nothing waits for that. */
  onPlayed: (() => void) | null;
  /** A tuning change was saved. */
  onTuned: () => void;
}

export interface ProjectGuide {
  /** The walkthrough is running in this project. */
  active: boolean;
  /** Drawn above the composer. */
  chat: ReactNode;
  game: GameViewGuide | undefined;
}

export interface ProjectGuideInput {
  project: Project;
  messages: readonly ChatMessage[];
  /** The conversation's messages have been read. */
  messagesReady: boolean;
  /** An agent turn is in flight in this conversation. */
  running: boolean;
  agents: readonly AgentInfo[];
  config: AppConfig;
  onOpenPlans: () => void;
  onSetUpAgent: () => void;
  onNewGame: () => void;
}

/**
 * The first-login walkthrough in the sample game, and the one-time hints in the
 * user's own. Each step is done by doing it: playing, saving a tuning change,
 * and one real request to the AI. The card says so and waits for Next; it never
 * moves on by itself, so it never rearranges the page under someone playing.
 */
export function useProjectGuide(input: ProjectGuideInput): ProjectGuide {
  const { project, messages, messagesReady, running, agents, config, onOpenPlans, onSetUpAgent, onNewGame } = input;
  const t = useT();
  const guide = useFirstRunGuide();
  const active = guide?.status === 'active' && guide.projectId === project.id;
  const step = active ? guide.step : null;

  const [done, setDone] = useState<{ projectId: string; played: boolean; tuned: boolean }>({ projectId: project.id, played: false, tuned: false });
  const facts = done.projectId === project.id ? done : { projectId: project.id, played: false, tuned: false };
  const mark = useCallback((fact: 'played' | 'tuned') => {
    setDone((previous) => ({
      ...(previous.projectId === project.id ? previous : { played: false, tuned: false }),
      projectId: project.id,
      [fact]: true,
    }));
  }, [project.id]);
  const onPlayed = useCallback(() => mark('played'), [mark]);
  const onTuned = useCallback(() => mark('tuned'), [mark]);

  // Step 3 asks who can answer; nothing is read for the account before then.
  const asking = step === 'ask';
  const account = useOpenPixoAccount({ load: asking });
  const cloudAvailable = isCloudAccountAvailable(account.status);
  const signedIn = cloudAvailable && account.status?.signedIn === true;
  const credits = useOpenPixoCredits(asking && signedIn);
  const agent = guideAgent({
    loading: (account.loading && !account.status) || (signedIn && credits.loading && !credits.credits),
    cloudAvailable,
    cloud: { signedIn, credits: credits.credits },
    agents,
    config,
  });
  const ask = guideAsk(messages, running);
  const canAsk = agent === 'credits' || agent === 'own';
  const [signInOpen, setSignInOpen] = useState(false);

  const prompt = t('guide.ask.prompt');
  const fillComposer = useCallback(() => queueProjectComposerPrefill(project.id, prompt), [project.id, prompt]);
  // The request waits in the composer, ready to send, unless something was already said here.
  const fill = asking && canAsk && messagesReady && messages.length === 0 && !running;
  useEffect(() => { if (fill) fillComposer(); }, [fill, fillComposer]);

  const next = <Button size="sm" variant="primary" onClick={advanceFirstRunGuide} data-testid="first-run-guide-next">{t('guide.next')}</Button>;
  const nextQuiet = <Button size="sm" variant="secondary" onClick={advanceFirstRunGuide} data-testid="first-run-guide-next">{t('guide.next')}</Button>;

  function gameCard(run: GuideRun): ReactNode {
    if (step === 'play') {
      const tone: GuideTone = run === 'failed' ? 'problem' : run === 'starting' ? 'working' : facts.played ? 'done' : 'todo';
      const body = run === 'failed' ? t('guide.play.failed')
        : run === 'starting' ? t('guide.play.starting')
          : facts.played ? t('guide.play.done') : t(run === 'stopped' ? 'guide.play.stopped' : 'guide.play.body');
      return <GuideCard step="play" tone={tone} title={t('guide.play.title')} body={body}
        actions={run === 'starting' ? null : facts.played ? next : nextQuiet} onSkip={skipFirstRunGuide} />;
    }
    if (step === 'tune') {
      return <GuideCard step="tune" tone={facts.tuned ? 'done' : 'todo'} title={t('guide.tune.title')}
        body={t(facts.tuned ? 'guide.tune.done' : 'guide.tune.body')} actions={facts.tuned ? next : nextQuiet} onSkip={skipFirstRunGuide} />;
    }
    return null;
  }

  function askCard(): ReactNode {
    const later = <Button size="sm" variant="ghost" onClick={advanceFirstRunGuide} data-testid="first-run-guide-later">{t('guide.ask.later')}</Button>;
    if (ask === 'working') {
      return <GuideCard step="ask" tone="working" title={t('guide.ask.title')} body={t('guide.ask.working')} onSkip={skipFirstRunGuide} />;
    }
    if (ask === 'done') {
      return <GuideCard step="ask" tone="done" title={t('guide.ask.title')} body={t('guide.ask.done')} actions={next} onSkip={skipFirstRunGuide} />;
    }
    if (!canAsk && agent !== 'loading') {
      const [title, body, label, act] = agent === 'needs-setup'
        ? [t('guide.ask.setupTitle'), t('guide.ask.setupBody'), t('guide.ask.setup'), onSetUpAgent] as const
        : agent === 'needs-sign-in'
          ? [t('guide.ask.creditsTitle'), t('guide.ask.creditsBody'), t('guide.ask.signIn'), () => setSignInOpen(true)] as const
          : [t('guide.ask.creditsTitle'), t('guide.ask.creditsBody'), t('guide.ask.choosePlan'), onOpenPlans] as const;
      return <GuideCard step="ask" tone="todo" title={title} body={body} onSkip={skipFirstRunGuide}
        actions={<><Button size="sm" variant="primary" onClick={act} data-testid="first-run-guide-fix">{label}</Button>{later}</>} />;
    }
    return <GuideCard step="ask" tone={ask === 'failed' ? 'problem' : 'todo'} title={t('guide.ask.title')}
      body={ask === 'failed' ? t('guide.ask.failed') : t(agent === 'own' ? 'guide.ask.bodyOwn' : 'guide.ask.body')} onSkip={skipFirstRunGuide}
      actions={<>
        <Button size="sm" variant="secondary" onClick={fillComposer} data-testid="first-run-guide-fill">{t('guide.ask.fill')}</Button>
        {later}
      </>} />;
  }

  const makeCard = () => <GuideCard step="make" tone="todo" title={t('guide.make.title')} body={t('guide.make.body')} onSkip={skipFirstRunGuide}
    actions={<>
      <Button size="sm" variant="primary" data-testid="first-run-guide-make" onClick={() => { finishFirstRunGuide(); onNewGame(); }}>{t('guide.make.action')}</Button>
      <Button size="sm" variant="ghost" data-testid="first-run-guide-finish" onClick={finishFirstRunGuide}>{t('guide.make.later')}</Button>
    </>} />;

  const hint = useMemo(
    () => firstRunHint({ guide, metadata: project.metadata, messages, running }),
    [guide, project.metadata, messages, running],
  );
  const chat = step === 'ask' ? <>{askCard()}<SignInDialog open={signInOpen} onClose={() => setSignInOpen(false)} /></>
    : step === 'make' ? makeCard()
      : hint && hint !== 'share' ? <FirstRunHintStrip hint={hint} /> : null;
  const inGame = step === 'play' || step === 'tune';
  const game: GameViewGuide | undefined = inGame || hint === 'share' ? {
    render: inGame ? gameCard : () => <FirstRunHintStrip hint="share" />,
    stageRing: step === 'play' && !facts.played ? styles.ring! : null,
    tuning: step === 'tune' ? { key: GUIDE_TUNING_KEY, ring: facts.tuned ? '' : styles.ring! } : null,
    onPlayed: step === 'play' && !facts.played ? onPlayed : null,
    onTuned,
  } : undefined;
  return { active, chat, game };
}
