import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { Button, Dialog, DialogBody, DialogDescription, DialogFooter, DialogTitle } from '@openpixo/components';
import type { ArtStyle, GameExperience } from '@openpixo/contracts';
import { X } from 'lucide-react';
import { useI18n } from '../../i18n';
import { listArtStyles } from '../../providers/styles';
import {
  ArtStep, ConceptStep, ExperienceStep, NotesField, PROBLEM_KEYS, ReviewSummary, SetupStep, SizeStep, ViewStep,
  stepLabelKey, type SummaryContext,
} from './WizardSteps';
import {
  furthestReachableStep,
  isBeginner,
  perspectiveDimension,
  stepComplete,
  stepProblems,
  withSuggestedSetup,
  markEdited,
  type StepContext,
  type WizardDraft,
  type WizardReference,
  type WizardStepId,
} from './wizard-state';
import { wizardStyleList } from './style-order';
import styles from './GameSetupWizard.module.css';

export interface GameSetupWizardProps {
  title: string;
  context: StepContext;
  /** The screens in order (`wizardSteps`). */
  steps: readonly WizardStepId[];
  draft: WizardDraft;
  onDraftChange: (draft: WizardDraft) => void;
  step: WizardStepId;
  onStepChange: (step: WizardStepId) => void;
  /** The experience screen's answer, while it is being chosen. */
  onExperienceChange?: (experience: GameExperience) => void;
  references: WizardReference[];
  onReferencesChange: (references: WizardReference[]) => void;
  /** Create mode: the engine picker above the technical fields. */
  engineLead?: ReactNode;
  /** The starter the engine screen should open on, given the answers so far. */
  suggestTemplate?: (draft: WizardDraft) => string;
  /** Create mode: name and location below the summary. */
  reviewTail?: ReactNode;
  /** Extra controls for the review screen (e.g. the kickoff toggle). */
  reviewOptions?: ReactNode;
  /** `extraReferences`: images the project already has, counted with the new ones. */
  summary: Omit<SummaryContext, 'styleTitle' | 'referenceCount'> & { extraReferences?: number };
  finishLabel: string;
  finishBusyLabel: string;
  busy: boolean;
  /** Prevents closing while a host picker or request is pending. */
  locked?: boolean;
  error?: ReactNode;
  footerNote?: ReactNode;
  onFinish: () => void;
  /** Focus target when the review screen's own fields block Create. */
  onBlockedFinish?: () => void;
  onStartOver?: () => void;
  closing: boolean;
  onRequestClose: () => void;
  onClosed: () => void;
  initialFocusRef?: RefObject<HTMLElement>;
}

/** The system's reduced-motion setting, followed live. Without matchMedia it assumes full motion. */
function usePrefersReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(query);
    const sync = () => setReduced(media.matches);
    sync();
    media.addEventListener?.('change', sync);
    return () => media.removeEventListener?.('change', sync);
  }, []);
  return reduced;
}

/**
 * A guided setup, one main question per screen. Continue stays disabled until
 * the screen's required answers exist; Back keeps every value; the caller owns
 * the draft, so closing never loses it. Screens slide in from the side they
 * come from, and a progress bar moves with them; with reduced motion they only
 * fade (`data-motion="reduced"`).
 */
export function GameSetupWizard(props: GameSetupWizardProps) {
  const { t, locale } = useI18n();
  const id = useId();
  const { draft, step: stepId, context, steps } = props;
  const [styleList, setStyleList] = useState<ArtStyle[]>([]);
  const [stylesLoading, setStylesLoading] = useState(true);
  const [stylesFailed, setStylesFailed] = useState(false);
  const [stylesAttempt, setStylesAttempt] = useState(0);
  const [attempted, setAttempted] = useState<Partial<Record<WizardStepId, boolean>>>({});
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');
  const [advance, setAdvance] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const reducedMotion = usePrefersReducedMotion();
  const index = Math.max(0, steps.indexOf(stepId));
  const beginner = isBeginner(context);

  useEffect(() => {
    const controller = new AbortController();
    setStylesLoading(true);
    setStylesFailed(false);
    void listArtStyles(controller.signal, locale).then(items => { if (!controller.signal.aborted) setStyleList(items); })
      .catch(() => { if (!controller.signal.aborted) { setStyleList([]); setStylesFailed(true); } })
      .finally(() => { if (!controller.signal.aborted) setStylesLoading(false); });
    return () => controller.abort();
  }, [locale, stylesAttempt]);

  // A new screen starts at the top of the scroll area.
  useEffect(() => { bodyRef.current?.scrollTo?.({ top: 0 }); }, [stepId]);

  // The perspective decides 2D or 3D, so only the styles that fit it are offered, in the curated order.
  // A retired style the setup already had when the dialog opened stays on offer, even after picking another.
  const dimension = perspectiveDimension(draft.perspective);
  const [openedStyleId] = useState(draft.styleId);
  const orderedStyles = useMemo(() => wizardStyleList(styleList, dimension, openedStyleId), [dimension, styleList, openedStyleId]);

  // Every step edit is the user's own; suggestions arrive through `withSuggestedSetup` instead.
  const update = (patch: Partial<WizardDraft>) => props.onDraftChange(markEdited(draft, patch));
  const problems = stepProblems(draft, stepId, context);
  const complete = stepComplete(draft, stepId, context);
  const reachable = furthestReachableStep(draft, context, steps);
  const last = index === steps.length - 1;
  const showProblems = attempted[stepId] === true;
  // Review cannot fix an earlier screen in place (an engine this computer lost, a restored draft),
  // so an unfinished earlier screen keeps Create disabled and is said at once.
  const earlierUnfinished = last && steps.slice(0, -1).some(earlier => !stepComplete(draft, earlier, context));

  function goTo(target: number) {
    // Going back is always allowed; going forward only up to the first unfinished screen.
    if ((target > index && target > reachable) || target === index || target < 0 || target >= steps.length) return;
    setDirection(target > index ? 'forward' : 'back');
    // The engine screen opens with suggestions from the earlier answers, never overriding the user's.
    if (steps[target] === 'setup') props.onDraftChange(withSuggestedSetup(draft, props.suggestTemplate?.(draft)));
    props.onStepChange(steps[target]!);
  }

  function next() {
    setAttempted(current => ({ ...current, [stepId]: true }));
    if (last) {
      if (complete) props.onFinish();
      else props.onBlockedFinish?.();
      return;
    }
    if (complete) goTo(index + 1);
  }

  // Enter on a card chooses it and continues, once the choice has rendered.
  useEffect(() => { if (advance) next(); }, [advance]); // eslint-disable-line react-hooks/exhaustive-deps

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || props.busy) return;
    const target = event.target as HTMLElement;
    if (target.getAttribute('role') !== 'radio') return;
    event.preventDefault();
    target.click();
    setAdvance(count => count + 1);
  }

  const styleTitle = styleList.find(style => style.id === draft.styleId)?.title;
  const referenceCount = props.references.length + (props.summary.extraReferences ?? 0);
  const summaryContext: SummaryContext = { templateName: props.summary.templateName, styleTitle, referenceCount };
  // Continue stays disabled until the screen is complete, so the footer always says what is missing.
  const problemText = (!last || showProblems || earlierUnfinished) && problems.length ? problems.map(problem => t(PROBLEM_KEYS[problem])).join(' ') : null;
  const blockClose = props.busy || props.locked;
  const progress = (index + 1) / steps.length;

  return (
    <Dialog
      ariaLabelledBy={id + '-title'}
      ariaDescribedBy={id + '-description'}
      open={!props.closing}
      onAfterClose={() => { if (props.closing) props.onClosed(); }}
      onClose={props.onClosed}
      initialFocusRef={props.initialFocusRef}
      className={styles.dialog}
      layout="sectioned"
      closeOnEscape={!blockClose}
      closeOnBackdrop={false}
      as="form"
      onSubmit={event => { event.preventDefault(); next(); }}
      data-step={stepId}
    >
      <div className={styles.frame} aria-busy={props.busy} data-motion={reducedMotion ? 'reduced' : 'full'} onKeyDown={onKeyDown}>
        <header className={styles.top}>
          <div className={styles.topRow}>
            <DialogTitle id={id + '-title'} className={styles.dialogTitle}>{props.title}</DialogTitle>
            <span className={styles.stepCount}>{t('game.wizard.stepOf', { current: String(index + 1), total: String(steps.length) })}</span>
            <span className={styles.topNote}>{props.footerNote}</span>
            {props.onStartOver && !props.busy ? (
              <Button variant="ghost" size="sm" onClick={props.onStartOver}>{t('game.wizard.startOver')}</Button>
            ) : null}
            <Button variant="ghost" size="sm" className={styles.close} onClick={props.onRequestClose} disabled={blockClose}
              aria-label={t('common.cancel')} title={t('common.cancel')}>
              <X size={16} aria-hidden="true" />
            </Button>
          </div>
          <div className={styles.progress} role="progressbar" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={index + 1}
            aria-label={t('game.wizard.stepOf', { current: String(index + 1), total: String(steps.length) })}>
            <span className={styles.progressFill} style={{ transform: `scaleX(${progress})` }} />
          </div>
        </header>

        <DialogBody className={styles.body}>
          <div ref={bodyRef} className={styles.scroll}>
            <div key={stepId} className={styles.stepPanel} data-direction={direction} data-testid={`wizard-step-${stepId}`}>
              <div className={styles.question}>
                <h3 className={styles.stepTitle}>{t(stepLabelKey(stepId, context.mode, 'step'))}</h3>
                <DialogDescription id={id + '-description'} className={styles.stepHint}>{t(stepLabelKey(stepId, context.mode, 'stepHint', beginner))}</DialogDescription>
              </div>
              <fieldset className={styles.stepFields} disabled={props.busy}>
                {stepId === 'experience' ? (
                  <ExperienceStep value={context.experience ?? null} onChange={value => props.onExperienceChange?.(value)} invalid={showProblems && !context.experience} />
                ) : null}
                {stepId === 'size' ? <SizeStep draft={draft} update={update} showProblems={showProblems} /> : null}
                {stepId === 'concept' ? <ConceptStep draft={draft} update={update} showProblems={showProblems} isNew={context.mode === 'create'} beginner={beginner} /> : null}
                {stepId === 'view' ? <ViewStep draft={draft} update={update} showProblems={showProblems} beginner={beginner} isNew={context.mode === 'create'} /> : null}
                {stepId === 'art' ? (
                  <ArtStep draft={draft} update={update} showProblems={showProblems} styleList={orderedStyles} stylesLoading={stylesLoading}
                    stylesFailed={stylesFailed} onRetryStyles={() => setStylesAttempt(attempt => attempt + 1)}
                    references={props.references} onReferences={props.onReferencesChange} onReferenceError={setReferenceError} beginner={beginner} />
                ) : null}
                {stepId === 'setup' ? <SetupStep draft={draft} update={update} showProblems={showProblems} lead={props.engineLead} beginner={beginner} /> : null}
                {stepId === 'review' ? (
                  <>
                    <ReviewSummary draft={draft} context={summaryContext} steps={steps} beginner={beginner} onEdit={target => goTo(steps.indexOf(target))} />
                    {props.reviewTail}
                    {props.reviewOptions}
                    <NotesField draft={draft} update={update} />
                  </>
                ) : null}
              </fieldset>
              {referenceError && stepId === 'art' ? <p className={styles.problem} role="alert">{referenceError}</p> : null}
              {props.error}
            </div>
          </div>
        </DialogBody>

        <DialogFooter className={styles.footer}>
          {index > 0 ? <Button variant="ghost" onClick={() => goTo(index - 1)} disabled={props.busy}>{t('game.wizard.back')}</Button> : null}
          <div className={styles.footerStart}>
            {problemText ? <p className={showProblems || earlierUnfinished ? styles.problem : styles.pending} role="status" aria-live="polite">{problemText}</p>
              : !last ? <p className={styles.enterHint} aria-hidden="true">{t('game.wizard.enterHint')}</p> : null}
          </div>
          <Button type="submit" variant="primary" className={styles.next} aria-busy={props.busy}
            disabled={props.busy || (!complete && (!last || earlierUnfinished)) || props.locked}
            data-testid="wizard-next">
            {props.busy ? <span className={styles.spinner} aria-hidden="true" /> : null}
            {last ? (props.busy ? props.finishBusyLabel : props.finishLabel) : t('game.wizard.next')}
          </Button>
        </DialogFooter>
      </div>
    </Dialog>
  );
}
