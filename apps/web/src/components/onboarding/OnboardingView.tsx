import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@openpixo/components';
import { GAME_EXPERIENCE_LEVELS, type GameExperience } from '@openpixo/contracts';
import { Gamepad2, Sprout, Trophy } from 'lucide-react';
import { useI18n } from '../../i18n';
import type { Dict } from '../../i18n/types';
import { isCloudAccountAvailable, useOpenPixoAccount, useOpenPixoCredits } from '../../hooks/useOpenPixoAccount';
import { createByokAccount, createCloudAccountPreference } from '../../state/account';
import { declineFirstRunGuide } from '../../state/first-run-guide';
import type { AppConfig } from '../../types';
import { findProvider, type MediaProviderId } from '../../media/models';
import { formatCredits, unavailableReasonKey } from '../account/account-format';
import { SignInPanel } from '../account/CloudSignIn';
import { Icon } from '../Icon';
import { OpenPixoLogo } from '../OpenPixoLogo';
import { AgentSetup, codexAppWithoutCli, type AgentSetupProps } from './AgentSetup';
import { ImageSetup } from './ImageSetup';
import { PlanStep } from './PlanStep';
import { PricingDialog } from './PricingDialog';
import {
  cloudCanSpend,
  HOSTED_AGENT_ID,
  readyAgentSource,
  readyImageSource,
  returningSetupSatisfied,
  setupGate,
  type AgentSource,
  type ImageSource,
  type SetupPiece,
} from './setup-readiness';
import { useCodexImageStatus } from './useCodexImageStatus';
import { WelcomeHero } from './WelcomeHero';
import styles from './Onboarding.module.css';
import setup from './Setup.module.css';

export { ONBOARDING_LOCAL_AUTO_TEST_DELAY_MS } from './AgentSetup';

export interface OnboardingViewProps extends Omit<AgentSetupProps, 'onFinish'> {
  onFinish: () => void;
  onStartSample?: () => void;
  /**
   * This installation was never offered the walkthrough: setup ends in it (after one
   * question about experience), and payment waits until the user has seen a game work.
   */
  offerGuide?: boolean;
  /** Opens the sample game with the walkthrough. */
  onStartGuide?: () => void;
  onOpenDoctor?: () => void;
  /** Opens Settings › Account & credits, where plans and top-ups are bought. */
  onOpenAccount?: () => void;
}

type Stage = 'welcome' | 'own-tools-check' | 'plan' | 'experience' | 'image' | 'agent' | 'ready';
type Path = 'cloud' | 'byok';

type Step = { stage: Stage; label: keyof Dict; piece?: SetupPiece };

const STEPS: Record<Path, Step[]> = {
  cloud: [
    { stage: 'welcome', label: 'onboarding.stepSignIn' },
    { stage: 'plan', label: 'onboarding.stepPlan', piece: 'image' },
    { stage: 'ready', label: 'onboarding.stepReady' },
  ],
  byok: [
    { stage: 'image', label: 'onboarding.stepImages', piece: 'image' },
    { stage: 'agent', label: 'onboarding.stepAgent', piece: 'agent' },
    { stage: 'ready', label: 'onboarding.stepReady' },
  ],
};

/** A new user on credits: choosing a plan is a step only for someone who already picked one. */
function guidedSteps(plan: boolean): Step[] {
  return [
    { stage: 'welcome', label: 'onboarding.stepSignIn' },
    ...(plan ? [{ stage: 'plan', label: 'onboarding.stepPlan', piece: 'image' } as Step] : []),
    { stage: 'experience', label: 'onboarding.stepStart' },
  ];
}

const EXPERIENCE_ICONS = { first: Sprout, some: Gamepad2, experienced: Trophy };

const MISSING: Record<SetupPiece, keyof Dict> = {
  image: 'onboarding.missingImage',
  agent: 'onboarding.missingAgent',
};

/**
 * First run. The main road is the OpenPixo account: sign in, say whether you
 * have made a game before, and either follow the walkthrough in the sample game
 * or go Home. A new user sees a game work before being asked to pay: the
 * walkthrough's AI step offers the plans, and so does Home. Someone who picked a
 * plan in the prices window pays right after signing in, and a re-run of setup
 * still goes through the plans. The hosted agent and hosted image generation are
 * paid with credits, so there is nothing to install or paste. A clearly visible second
 * road is for people who already pay for an AI account. The welcome says that
 * road is not free and needs a terminal, because newcomers read "no OpenPixo
 * credits" as "free" and then stall on API keys and command lines; unless a
 * working agent is already on this computer, a check screen asks for both
 * before the steps begin. That road walks a user through their own tools one
 * piece at a time: something
 * that makes images (Codex with a ChatGPT login, or an image API key), then an
 * agent (a CLI found on this computer, or an API key). Either road ends on a
 * checklist that says what is missing and what that means; nothing is forced.
 * A returning user whose chosen road still works never sees any of it.
 */
export function OnboardingView(props: OnboardingViewProps) {
  const { t, locale } = useI18n();
  const cloud = useOpenPixoAccount();
  const accountAvailable = isCloudAccountAvailable(cloud.status);
  const signedIn = accountAvailable && cloud.status?.signedIn === true;
  const checkingAccount = cloud.loading && !cloud.status && !cloud.failed;
  const creditsState = useOpenPixoCredits(signedIn);
  const credits = creditsState.credits;
  const codex = useCodexImageStatus();

  const [stage, setStage] = useState<Stage>('welcome');
  const [path, setPath] = useState<Path>(props.config.account?.mode === 'byok' ? 'byok' : 'cloud');
  const [agentReturn, setAgentReturn] = useState<Stage>('image');
  const [agentUntested, setAgentUntested] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [pricingOpen, setPricingOpen] = useState(false);
  const [chosenSku, setChosenSku] = useState<string | null>(null);
  const creditsChoiceRef = useRef<HTMLDivElement>(null);
  const interacted = useRef(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const flowAttempt = useRef(0);
  const renderedAttempt = flowAttempt.current;
  const latestConfig = useRef(props.config);
  latestConfig.current = props.config;

  const cloudFacts = { signedIn, credits };
  const canSpend = cloudCanSpend(cloudFacts);
  const image = readyImageSource({
    cloud: cloudFacts,
    codexImage: codex.status,
    mediaProviders: props.config.mediaProviders,
    preferCloud: path === 'cloud',
  });
  const agent = readyAgentSource({ cloud: cloudFacts, agents: props.agents, config: props.config });
  const gate = setupGate(image, agent);
  const offerGuide = props.offerGuide === true && props.onStartGuide !== undefined;
  /** Where the credits road ends: the walkthrough's question for a new user, else the checklist. */
  const cloudEnd: Stage = offerGuide ? 'experience' : 'ready';

  const firstRender = useRef(true);
  useEffect(() => {
    // Focus follows the flow, but the very first screen keeps the page's natural focus.
    if (firstRender.current) { firstRender.current = false; return; }
    titleRef.current?.focus();
  }, [stage]);

  // Facts a returning user's auto-finish depends on have all answered.
  const factsSettled = !checkingAccount && !(signedIn && creditsState.loading)
    && codex.status !== null && !props.agentsLoading;
  const returning = props.config.account != null;
  const autoFinish = stage === 'welcome' && !interacted.current && returning && factsSettled
    && returningSetupSatisfied(props.config, gate);
  useEffect(() => {
    if (autoFinish) void finish('home');
    // `finish` reads the latest config through a ref; only the decision matters here.
  }, [autoFinish]);

  // A plan bought in the browser (or credits already there) ends the plan step.
  useEffect(() => {
    if (stage === 'plan' && canSpend) goTo(cloudEnd);
  }, [stage, canSpend]);

  function goTo(next: Stage) {
    interacted.current = true;
    flowAttempt.current += 1;
    setStage(next);
  }

  // A signed-in agent CLI or a filled API key already shows the user has a
  // paid account and a terminal, so only everyone else sees the check.
  const ownToolsAgent = agent && agent.kind !== 'hosted' ? agent : null;

  function chooseOwnTools() {
    setPath('byok');
    goTo(accountAvailable && !ownToolsAgent ? 'own-tools-check' : 'image');
  }

  /** A plan or pack picked in the prices window: sign in next, then pay for it. */
  function choosePrice(sku: string) {
    setChosenSku(sku);
    setPricingOpen(false);
    // State set here is not visible until the next render, so the pick is handed on.
    if (signedIn) { afterSignIn(sku); return; }
    // After the window's exit, put the cursor where signing in starts.
    window.setTimeout(() => creditsChoiceRef.current?.querySelector<HTMLInputElement>('input')?.focus(), 160);
  }

  function switchToCredits() {
    setPath('cloud');
    goTo('welcome');
  }

  /** Pays for a plan picked in the prices window first; otherwise a new user goes on to the free walkthrough. */
  function afterSignIn(sku: string | null = chosenSku) {
    setPath('cloud');
    goTo(canSpend || (offerGuide && !sku) ? cloudEnd : 'plan');
  }

  /** The one question before a new user's first game; only a beginner is walked through it. */
  function chooseExperience(level: GameExperience) {
    if (level === 'experienced') declineFirstRunGuide();
    void finish(level === 'experienced' ? 'home' : 'guide', level);
  }

  function openAgentStep(from: Stage) {
    setAgentReturn(from);
    goTo('agent');
  }

  function accountPreference() {
    return path === 'cloud' && signedIn ? createCloudAccountPreference() : createByokAccount();
  }

  /** Saves the chosen road and the agent the app will run with, then leaves. */
  async function finish(to: 'home' | 'sample' | 'guide', experience?: GameExperience) {
    if (finishing) return;
    setFinishing(true);
    const base = latestConfig.current;
    const next: AppConfig = { ...base, account: accountPreference(), ...agentConfig(agent, base),
      ...(experience ? { gameExperience: experience } : {}) };
    try {
      await props.onConfigPersist(next);
    } catch {
      // The daemon copy retries on the next save; finishing must not strand the user.
    }
    props.onFinish();
    if (to === 'guide') props.onStartGuide?.();
    else if (to === 'sample') props.onStartSample?.();
  }

  // The welcome screen is a choice between two roads, so it shows no steps.
  const steps = stage === 'welcome' ? null
    : path === 'cloud' && offerGuide ? guidedSteps(stage === 'plan' || chosenSku !== null) : STEPS[path];
  const stepIndex = steps?.findIndex((step) => step.stage === stage) ?? -1;

  if (autoFinish || (stage === 'welcome' && returning && !interacted.current && !factsSettled)) {
    return (
      <div className={styles.page}>
        <div className={styles.topBar}><OpenPixoLogo compact /></div>
        <p className={setup.centerStatus} role="status"><Icon name="spinner" size={16} className="icon-spin" /></p>
      </div>
    );
  }

  return (
    <div className={styles.page} data-stage={stage}>
      <div className={styles.column}>
      <div className={styles.topBar}><OpenPixoLogo compact /></div>
      <section className={styles.flow} aria-labelledby="onboarding-step-title" data-stage={stage}>
        <div className={`${styles.flowContent} ${stage === 'image' || stage === 'agent' || stage === 'plan' || stage === 'experience' ? styles.setupContent : ''}`} key={stage}>
          {steps && stepIndex >= 0 && !checkingAccount ? <Stepper steps={steps} current={stepIndex} missing={gate.missing} agentUntested={agentUntested} /> : null}
          {stage === 'ready' && gate.complete && !agentUntested && <span className={styles.readyCheck} aria-hidden="true"><Icon name="check" size={22} /></span>}
          <h1 id="onboarding-step-title" className={styles.flowTitle} ref={titleRef} tabIndex={-1}>{t(stageTitle(stage, gate.complete && !agentUntested))}</h1>
          <p className={styles.flowSubtitle}>{stageSubtitle()}</p>

          {stage === 'welcome' && renderWelcome()}

          {stage === 'own-tools-check' && renderOwnToolsCheck()}

          {stage === 'plan' && (
            <>
              {creditsState.loading && !credits ? (
                <p className={styles.aiScanning} role="status"><Icon name="spinner" size={14} className="icon-spin" />{t('account.loading')}</p>
              ) : <PlanStep credits={credits} initialSku={chosenSku} />}
              {renderStepFooter({ onBack: () => goTo('welcome'), onSkip: () => goTo(cloudEnd) })}
            </>
          )}

          {stage === 'experience' && renderExperience()}

          {stage === 'image' && (
            <>
              <ImageSetup
                config={props.config}
                codexStatus={codex.status}
                codexChecking={codex.checking}
                onRecheckCodex={codex.recheck}
                onConfigPersist={(next) => props.onConfigPersist({ ...next, account: accountPreference() })}
                codexAppWithoutCli={codexAppWithoutCli(props.agents)}
              />
              {renderStepFooter({
                onBack: () => goTo(path === 'cloud' ? 'ready' : 'welcome'),
                onSkip: () => openAgentStep('image'),
                onContinue: image ? () => (path === 'cloud' ? goTo('ready') : openAgentStep('image')) : undefined,
              })}
            </>
          )}

          {stage === 'agent' && (
            <>
              <AgentSetup {...props}
                agents={canSpend ? props.agents : props.agents.filter((item) => item.id !== HOSTED_AGENT_ID)}
                onConfigPersist={(next) => props.onConfigPersist({
                  ...next,
                  onboardingCompleted: latestConfig.current.onboardingCompleted,
                  account: accountPreference(),
                })}
                onFinish={verified => {
                  if (renderedAttempt !== flowAttempt.current) return;
                  setAgentUntested(!verified);
                  goTo('ready');
                }} />
              {/* With an agent to test, the step's own "skip check" is the way past it. */}
              {renderStepFooter({
                onBack: () => goTo(agentReturn),
                onSkip: agent ? undefined : () => { setAgentUntested(true); goTo('ready'); },
                extra: !agent && props.onOpenDoctor ? (
                  <Button variant="ghost" size="sm" className={styles.textLink} onClick={props.onOpenDoctor}>
                    {t('onboarding.environmentCheck')}
                  </Button>
                ) : null,
              })}
            </>
          )}

          {stage === 'ready' && renderReady()}
        </div>
      </section>
      </div>
      {stage === 'welcome' ? <WelcomeHero /> : null}
      <PricingDialog open={pricingOpen} onClose={() => setPricingOpen(false)} onChoose={choosePrice} />
    </div>
  );

  function stageSubtitle(): string {
    if (stage === 'welcome') {
      if (signedIn) return t('onboarding.welcomeSignedIn', { email: cloud.status?.user?.email ?? '' });
      return accountAvailable ? t('onboarding.welcomePitch') : t('onboarding.welcomeSubtitle');
    }
    if (stage === 'own-tools-check') return t('onboarding.ownToolsCheckSubtitle');
    if (stage === 'plan') return t('onboarding.planSubtitle');
    if (stage === 'experience') return t('game.wizard.stepHint.experience');
    if (stage === 'image') return t('onboarding.imageStepSubtitle');
    if (stage === 'agent') return t('onboarding.agentStepSubtitle');
    return gate.complete && !agentUntested ? t('onboarding.readySubtitle') : t('onboarding.almostSubtitle');
  }

  function renderWelcome() {
    if (checkingAccount) {
      return <p className={styles.altLine} role="status"><Icon name="spinner" size={14} className="icon-spin" /></p>;
    }
    if (!accountAvailable) {
      const reason = unavailableReasonKey(cloud.status && !cloud.failed ? cloud.status.availability : null);
      return (
        <div className={styles.stack}>
          <Button size="lg" variant="primary" className={styles.wide} onClick={chooseOwnTools}>{t('onboarding.getStarted')}</Button>
          {reason ? <p className={setup.fineprint}>{t(reason)}</p> : null}
        </div>
      );
    }
    // Two ways in, each saying what it costs and what it needs, so nobody
    // takes the own-tools road believing it is the free one.
    const foundAgent = ownToolsAgent?.kind === 'local' ? agentName(ownToolsAgent.agentId) : null;
    return (
      <div className={setup.choices}>
        <div className={setup.choice} data-primary="true" data-testid="onboarding-credits-choice" ref={creditsChoiceRef}>
          <span className={setup.choiceHead}>
            <strong>{t('onboarding.creditsChoiceTitle')}</strong>
            <span className={setup.recommended}>{t('onboarding.recommended')}</span>
          </span>
          <span className={setup.choiceBody}>
            {t('onboarding.creditsChoiceBody')}{' '}
            <Button variant="ghost" size="sm" className={`${styles.textLink} ${setup.pricesLink}`} data-testid="onboarding-see-prices"
              onClick={() => setPricingOpen(true)}>
              {t('onboarding.seePrices')}
            </Button>
          </span>
          <div className={`${styles.signIn} ${setup.choiceAction}`}>
            {!signedIn ? (
              <SignInPanel key={renderedAttempt} autoFocus={false} onSignedIn={() => {
                if (renderedAttempt === flowAttempt.current) afterSignIn();
              }} />
            ) : (
              <Button size="lg" variant="primary" className={styles.wide} onClick={() => afterSignIn()}>{t('onboarding.continue')}</Button>
            )}
          </div>
        </div>
        <button type="button" className={setup.choice} data-testid="onboarding-own-tools" onClick={chooseOwnTools}>
          <span className={setup.choiceHead}>
            <Icon name="terminal" size={15} />
            <strong>{t('onboarding.ownToolsTitle')}</strong>
            <Icon name="chevron-right" size={14} className={setup.choiceChevron} />
          </span>
          <span className={setup.choiceBody}>{t('onboarding.ownToolsBody')}</span>
          {foundAgent ? (
            <span className={setup.choiceFound} data-testid="onboarding-own-tools-found">
              <Icon name="check" size={13} />{t('onboarding.ownToolsFound', { agent: foundAgent })}
            </span>
          ) : null}
        </button>
      </div>
    );
  }

  /** Asked once, here instead of in the first new game: it decides between the walkthrough and Home. */
  function renderExperience() {
    return (
      <>
        <div className={setup.choices}>
          {GAME_EXPERIENCE_LEVELS.map((level) => {
            const LevelIcon = EXPERIENCE_ICONS[level];
            return (
              <button key={level} type="button" className={setup.choice} data-testid={`onboarding-experience-${level}`}
                disabled={finishing} onClick={() => chooseExperience(level)}>
                <span className={setup.choiceHead}>
                  <LevelIcon size={17} strokeWidth={1.75} aria-hidden="true" />
                  <strong>{t(`game.wizard.experience.${level}` as keyof Dict)}</strong>
                  <Icon name="chevron-right" size={14} className={setup.choiceChevron} />
                </span>
                <span className={setup.choiceBody}>{t(`game.wizard.experienceHint.${level}` as keyof Dict)}</span>
                <span className={setup.choiceNext}>{t(level === 'experienced' ? 'onboarding.experienceHome' : 'onboarding.experienceGuide')}</span>
              </button>
            );
          })}
        </div>
        <div className={styles.footerLinks}>
          <span />
          <Button variant="ghost" size="sm" className={styles.textLink} data-testid="onboarding-experience-skip"
            disabled={finishing} onClick={() => void finish('home')}>
            {t('onboarding.enterHome')}
          </Button>
        </div>
      </>
    );
  }

  /** What the own-tools road needs, asked before its setup steps begin. */
  function renderOwnToolsCheck() {
    return (
      <>
        <ul className={setup.needs} aria-label={t('onboarding.ownToolsCheckTitle')}>
          <li>
            <span className={setup.needIcon} aria-hidden="true"><Icon name="key" size={15} /></span>
            <span className={styles.aiCopy}>
              <strong>{t('onboarding.ownToolsNeedAccountTitle')}</strong>
              <small>{t('onboarding.ownToolsNeedAccountBody')}</small>
            </span>
          </li>
          <li>
            <span className={setup.needIcon} aria-hidden="true"><Icon name="terminal" size={15} /></span>
            <span className={styles.aiCopy}>
              <strong>{t('onboarding.ownToolsNeedTerminalTitle')}</strong>
              <small>{t('onboarding.ownToolsNeedTerminalBody')}</small>
            </span>
          </li>
        </ul>
        <div className={styles.stack}>
          <Button size="lg" variant="primary" className={styles.wide} data-testid="onboarding-own-tools-confirm" onClick={() => goTo('image')}>
            {t('onboarding.ownToolsConfirm')}
          </Button>
          <Button size="lg" variant="secondary" className={styles.wide} data-testid="onboarding-use-credits" onClick={switchToCredits}>
            {t('onboarding.useCreditsInstead')}
          </Button>
        </div>
      </>
    );
  }

  function renderReady() {
    // A missing image path on the subscription road means "choose a plan";
    // changing a working one, or the own-tools road, opens the image step.
    const fixImage = () => (!image && path === 'cloud' && signedIn ? goTo('plan') : goTo('image'));
    return (
      <>
        <ul className={setup.checklist} aria-label={t('onboarding.checklistAria')}>
          <ChecklistRow
            testId="onboarding-check-image"
            title={t('onboarding.checkImage')}
            ready={image ? imageSourceLabel(image) : null}
            missing={t(MISSING.image)}
            onFix={fixImage}
          />
          <ChecklistRow
            testId="onboarding-check-agent"
            title={t('onboarding.checkAgent')}
            ready={agent ? agentUntested ? t('onboarding.agentNotTested') : agentSourceLabel(agent) : null}
            untested={Boolean(agent) && agentUntested}
            missing={t(MISSING.agent)}
            onFix={() => openAgentStep('ready')}
          />
        </ul>
        {signedIn ? (
          <div className={setup.creditsLine}>
            <span>{t('onboarding.creditsLabel')}</span>
            <strong data-testid="onboarding-credits">{formatCredits(credits?.available ?? 0, locale)}</strong>
          </div>
        ) : null}
        <div className={`${styles.stack} ${setup.readyActions}`}>
          {gate.complete ? (
            <>
              <Button size="lg" variant="primary" className={styles.wide} data-testid="onboarding-ready-start"
                onClick={() => void finish(offerGuide ? 'guide' : 'sample')} disabled={finishing}>
                {t(offerGuide ? 'onboarding.startGuide' : 'onboarding.startSample')}
              </Button>
              <Button variant="ghost" className={styles.wide} onClick={() => void finish('home')} disabled={finishing}>
                {t('onboarding.enterHome')}
              </Button>
            </>
          ) : (
            <>
              {/* The walkthrough's first half needs no AI, so it is open to someone with nothing set up yet. */}
              {offerGuide ? (
                <Button size="lg" variant="primary" className={styles.wide} data-testid="onboarding-ready-start"
                  onClick={() => void finish('guide')} disabled={finishing}>
                  {t('onboarding.startGuide')}
                </Button>
              ) : null}
              <Button size="lg" variant={offerGuide ? 'ghost' : 'primary'} className={styles.wide} data-testid="onboarding-finish-anyway"
                onClick={() => void finish('home')} disabled={finishing}>
                {t('onboarding.finishAnyway')}
              </Button>
              {/* Someone stuck on their own tools gets the road with nothing to install. */}
              {path === 'byok' && accountAvailable ? (
                <Button size="lg" variant="secondary" className={styles.wide} data-testid="onboarding-use-credits"
                  onClick={switchToCredits} disabled={finishing}>
                  {t('onboarding.useCreditsInstead')}
                </Button>
              ) : null}
            </>
          )}
        </div>
      </>
    );
  }

  function imageSourceLabel(source: ImageSource): string {
    if (source.kind === 'cloud') return t('onboarding.sourceCloudImage');
    if (source.kind === 'codex') return t('onboarding.sourceCodexImage');
    return t('onboarding.sourceKeyImage', { provider: findProvider(source.providerId as MediaProviderId)?.label ?? source.providerId });
  }

  function agentSourceLabel(source: AgentSource): string {
    if (source.kind === 'hosted') return t('onboarding.sourceHostedAgent');
    if (source.kind === 'api') return t('onboarding.sourceApiAgent', { model: props.config.model });
    return t('onboarding.sourceLocalAgent', { agent: agentName(source.agentId) });
  }

  function agentName(agentId: string): string {
    return props.agents.find((item) => item.id === agentId)?.name ?? agentId;
  }

  /** Back, then Skip, which needs no second question: the last step lists what is missing. */
  function renderStepFooter({ onBack, onSkip, onContinue, extra }: {
    onBack: () => void;
    onSkip?: () => void;
    onContinue?: () => void;
    extra?: ReactNode;
  }) {
    return (
      <div className={setup.stepFooter}>
        {onContinue ? (
          <Button size="lg" variant="primary" className={styles.wide} data-testid="onboarding-step-continue" onClick={onContinue}>
            {t('onboarding.continue')}
          </Button>
        ) : null}
        <div className={styles.footerLinks}>
          <Button variant="ghost" size="sm" className={styles.textLink} onClick={onBack}>
            <Icon name="arrow-left" size={13} />{t('onboarding.back')}
          </Button>
          {extra}
          {!onContinue && onSkip ? (
            <Button variant="ghost" size="sm" className={styles.textLink} data-testid="onboarding-skip" onClick={onSkip}>
              {t('onboarding.skipForNow')}
            </Button>
          ) : null}
        </div>
      </div>
    );
  }
}

function stageTitle(stage: Stage, complete: boolean): keyof Dict {
  if (stage === 'welcome') return 'onboarding.welcomeTitle';
  if (stage === 'own-tools-check') return 'onboarding.ownToolsCheckTitle';
  if (stage === 'plan') return 'onboarding.planTitle';
  if (stage === 'experience') return 'game.wizard.step.experience';
  if (stage === 'image') return 'onboarding.imageStepTitle';
  if (stage === 'agent') return 'onboarding.agentStepTitle';
  return complete ? 'onboarding.readyTitle' : 'onboarding.almostTitle';
}

/** The run settings that make `agent` the one the app uses. */
function agentConfig(agent: AgentSource | null, base: AppConfig): Partial<AppConfig> {
  if (!agent) return {};
  if (agent.kind === 'api') return { mode: 'api' };
  return base.mode === 'daemon' && base.agentId === agent.agentId ? {} : { mode: 'daemon', agentId: agent.agentId };
}

/** A step behind the current one is "done" only if its piece is really ready; a skipped one says so. */
function Stepper({ steps, current, missing, agentUntested }: { steps: Step[]; current: number; missing: SetupPiece[]; agentUntested: boolean }) {
  const { t } = useI18n();
  return (
    <ol className={setup.stepper} aria-label={t('onboarding.stepOf', { n: current + 1, total: steps.length })}>
      {steps.map((step, index) => {
        const skipped = index < current && step.piece !== undefined && missing.includes(step.piece);
        const state = index === current ? 'current' : index > current ? 'todo' : skipped ? 'skipped'
          : step.piece === 'agent' && agentUntested ? 'todo' : 'done';
        return (
          <li key={step.label} data-state={state} aria-current={index === current ? 'step' : undefined}>
            <span className={setup.stepDot}>
              {state === 'done' ? <Icon name="check" size={11} /> : state === 'skipped' ? <Icon name="alert-triangle" size={10} /> : index + 1}
            </span>
            <span>{t(step.label)}</span>
          </li>
        );
      })}
    </ol>
  );
}

function ChecklistRow({ title, ready, missing, untested, onFix, testId }: {
  title: string;
  ready: string | null;
  missing: string;
  untested?: boolean;
  onFix: () => void;
  testId: string;
}) {
  const { t } = useI18n();
  return (
    <li className={setup.checkRow} data-ready={untested ? 'untested' : ready ? 'true' : 'false'} data-testid={testId}>
      <span className={setup.checkMark} aria-hidden="true">
        <Icon name={untested ? 'info' : ready ? 'check' : 'alert-triangle'} size={14} />
      </span>
      <span className={styles.aiCopy}>
        <strong>{title}</strong>
        <small>{ready ?? missing}</small>
      </span>
      <Button size="sm" variant={ready ? 'ghost' : 'secondary'} onClick={onFix}>
        {ready ? t('onboarding.change') : t('onboarding.setUp')}
      </Button>
    </li>
  );
}
