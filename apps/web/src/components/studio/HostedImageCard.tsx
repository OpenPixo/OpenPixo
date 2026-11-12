import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Button, Card, SegmentedTabs, Select, Textarea, VisuallyHidden } from '@openpixo/components';
import type { OpenPixoGenerationAspect, OpenPixoGenerationParams, OpenPixoGenerationQuote, OpenPixoGenerationService, ProjectFile } from '@openpixo/contracts';
import { OPENPIXO_MODEL3D_PROMPT, OPENPIXO_MODEL3D_QUALITIES, OPENPIXO_MODEL3D_SERVICE, type OpenPixoModel3dQuality } from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import { isCloudAccountAvailable, refreshOpenPixoCredits, useOpenPixoAccount } from '../../hooks/useOpenPixoAccount';
import { accountErrorCode, OpenPixoAccountRequestError } from '../../providers/openpixo-account';
import { generateCloudMedia, quoteCloudMedia, waitMediaTask, type MediaTaskWait } from '../../providers/openpixo-cloud-media';
import { projectRawUrl } from '../../providers/registry';
import { accountErrorMessage, formatCredits } from '../account/account-format';
import { SignInPanel } from '../account/CloudSignIn';
import { Model3dViewer } from '../Model3dViewer';
import { estimateGenerationCredits } from './hosted-estimate';
import { studioServices, useCacheEntry } from './studio-cache';
import styles from './HostedImageCard.module.css';

type Phase =
  | { kind: 'edit' }
  | { kind: 'quoting' }
  /** The quote came back above the number on the button: nothing is spent until the user says so. */
  | { kind: 'confirm'; quote: OpenPixoGenerationQuote; requestId: string }
  | { kind: 'short' }
  | { kind: 'running'; checking: boolean }
  | { kind: 'done'; name: string; preview: 'audio' | 'model' | null }
  /** `paidFile`: this request is paid and its file still waits to download, so generating it again would pay twice. */
  | { kind: 'failed'; message: string; retry?: { quote: OpenPixoGenerationQuote; requestId: string }; paidFile?: boolean };

/** What the card can make, in the order the control shows them. */
const MAKES = ['image', 'sfx', 'speech', 'music', 'model3d'] as const;
type Make = (typeof MAKES)[number];

function makeOf(service: OpenPixoGenerationService): Make | null {
  if (service.surface === 'image' || service.surface === 'model3d') return service.surface;
  return service.audioKind ?? null;
}

const OUTPUT: Record<Make, { folder: string; extension: string; fallback: string }> = {
  image: { folder: 'images', extension: 'png', fallback: 'image' },
  sfx: { folder: 'audio', extension: 'mp3', fallback: 'sound' },
  speech: { folder: 'audio', extension: 'mp3', fallback: 'voice' },
  music: { folder: 'audio', extension: 'mp3', fallback: 'music' },
  model3d: { folder: 'models', extension: 'glb', fallback: 'model' },
};

function outputName(prompt: string, make: Make): string {
  const { folder, extension, fallback } = OUTPUT[make];
  const slug = prompt.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '').slice(0, 40) || fallback;
  return `${folder}/${slug}-${Date.now().toString(36)}.${extension}`;
}

/** A 3D model has no prompt, so it is named after the picture it came from. */
function modelOutputName(reference: string | undefined): string {
  return outputName((reference ?? '').replace(/^.*\//u, '').replace(/\.[^.]+$/u, ''), 'model3d');
}

const REFERENCE_IMAGE = /\.(png|jpe?g|webp)$/iu;
const PAUSED_RECHECK_MS = 30_000;
const WAIT_RETRY_MS = 1500;
const LENGTH_CHOICES = [1, 3, 5, 10];
/** The character count appears once this much of a voice line's limit is used. */
const COUNT_FROM = 0.8;
/** Tall enough to turn the model, short enough to keep Generate in view. */
const MODEL_PREVIEW_HEIGHT = 220;

/** No HTTP answer at all, or a server-side one. A 4xx is the daemon saying no. */
function isTransientWaitError(cause: unknown): boolean {
  if (!(cause instanceof OpenPixoAccountRequestError)) return true;
  return cause.status >= 500;
}

function lengthChoices(limits: NonNullable<OpenPixoGenerationService['durationSeconds']>): number[] {
  const within = LENGTH_CHOICES.filter(value => value >= limits.min && value <= limits.max);
  return within.includes(limits.default) ? within : [...within, limits.default].sort((a, b) => a - b);
}

/**
 * Hosted generation paid with OpenPixo credits, in one click: images, sound
 * effects, voice lines, music and 3D models, whichever the cloud's catalogue
 * offers. The button shows an approximate cost; clicking it is the user's
 * confirmation of that amount. The cloud still prices and charges exactly: the
 * card fetches a quote and submits it straight away with a stable request id, and
 * the cloud charges only once the file can be delivered; a failure returns the
 * reservation.
 *
 * It never spends more than was shown. A quote above the number on the button
 * stops and asks, and a quote the balance can't cover stops and offers credits.
 * The running balance lives in the bottom-left of the app, not here. Hidden when
 * this build has no cloud, so local-only use never sees it.
 */
export function HostedImageCard({ projectId, files = [], readOnly, onSaved, onOpenFile, onOpenAccount }: {
  projectId: string; files?: ProjectFile[]; readOnly?: boolean; onSaved: () => Promise<void>; onOpenFile: (path: string) => void;
  onOpenAccount?: () => void;
}) {
  const { t, locale } = useI18n();
  const account = useOpenPixoAccount();
  const available = isCloudAccountAvailable(account.status);
  const signedIn = available && Boolean(account.status?.signedIn);
  const servicesEntry = studioServices();
  const { value: catalog } = useCacheEntry(servicesEntry);
  const [makeChoice, setMakeChoice] = useState<Make | null>(null);
  const [serviceId, setServiceId] = useState('');
  // Each kind keeps its own text: an image description is not a line to speak.
  const [prompts, setPrompts] = useState<Partial<Record<Make, string>>>({});
  const [aspectChoice, setAspectChoice] = useState<OpenPixoGenerationAspect>('1:1');
  const [styleChoice, setStyleChoice] = useState('');
  const [lengthChoice, setLengthChoice] = useState<number | null>(null);
  const [references, setReferences] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>({ kind: 'edit' });
  const [error, setError] = useState('');
  const estimateId = useId();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const generationPaused = catalog?.generationPaused ?? false;
  // A paused service can open while this card is on screen, so it checks again when the window
  // regains focus and, while paused, on a timer. A failed recheck keeps what is already shown.
  useEffect(() => {
    if (!available) return;
    const recheck = () => { void servicesEntry.refresh(); };
    recheck();
    window.addEventListener('focus', recheck);
    const timer = generationPaused ? window.setInterval(recheck, PAUSED_RECHECK_MS) : undefined;
    return () => { window.removeEventListener('focus', recheck); window.clearInterval(timer); };
  }, [available, generationPaused, servicesEntry]);

  const services = catalog?.services.filter(entry => makeOf(entry)) ?? [];
  const makes = MAKES.filter(value => services.some(entry => makeOf(entry) === value));
  const make: Make = makeChoice && makes.includes(makeChoice) ? makeChoice : makes[0] ?? 'image';
  const isModel = make === 'model3d';
  const listed = services.filter(entry => makeOf(entry) === make);
  // 3D comes in quality tiers, shown draft to high whatever order the cloud lists them in.
  const tierRank = (entry: OpenPixoGenerationService) => entry.quality ? OPENPIXO_MODEL3D_QUALITIES.indexOf(entry.quality) : OPENPIXO_MODEL3D_QUALITIES.length;
  const makeServices = isModel ? [...listed].sort((a, b) => tierRank(a) - tierRank(b)) : listed;
  const tiered = isModel && makeServices.length > 1 && makeServices.every(entry => entry.quality);
  // Medium is the default tier, not whichever the list starts with.
  const fallback = isModel ? makeServices.find(entry => entry.id === OPENPIXO_MODEL3D_SERVICE) ?? makeServices[0] : makeServices[0];
  const service = makeServices.find(entry => entry.id === serviceId) ?? fallback ?? null;
  const servicePicker = makeServices.length > 1 && !tiered;
  const prompt = prompts[make] ?? '';
  const setPrompt = (value: string) => setPrompts(previous => ({ ...previous, [make]: value }));
  // A 3D model is priced from its picture alone, so nothing else about it can be chosen.
  const aspects = isModel ? [] : service?.aspects ?? [];
  const aspect = aspects.includes(aspectChoice) ? aspectChoice : aspects[0];
  const styleOptions = isModel ? [] : service?.styles ?? [];
  const style = styleOptions.includes(styleChoice) ? styleChoice : styleOptions[0] ?? '';
  const limits = isModel ? undefined : service?.durationSeconds;
  const lengths = limits ? lengthChoices(limits) : [];
  const length = limits ? (lengthChoice !== null && lengths.includes(lengthChoice) ? lengthChoice : limits.default) : undefined;
  useEffect(() => { setReferences(previous => previous.length ? [] : previous); }, [service?.id]);
  // Any edit makes this a different request: the price it was stopped on no longer applies, and a
  // retry must not reuse a request id and quote bound to the old parameters. A failure's message
  // stays, because it can carry the billing truth.
  useEffect(() => {
    setPhase(previous => previous.kind === 'confirm' || previous.kind === 'short' ? { kind: 'edit' }
      : previous.kind === 'failed' && (previous.retry || previous.paidFile) ? { kind: 'failed', message: previous.message } : previous);
  }, [service?.id, prompt, aspect, style, length, references.join('|')]);
  // What was just saved belongs to the kind that made it.
  useEffect(() => { setPhase(previous => previous.kind === 'done' ? { kind: 'edit' } : previous); }, [make]);

  if (!available || !catalog || !services.length) return null;
  const audio = service?.surface === 'audio';
  const params: OpenPixoGenerationParams = isModel ? { prompt: OPENPIXO_MODEL3D_PROMPT }
    : { prompt, ...(aspect ? { aspect } : {}), ...(style ? { style } : {}), ...(length !== undefined ? { duration: length } : {}) };
  const promptChars = [...prompt].length;
  const minPrompt = service?.minPromptChars ?? 0;
  const maxPrompt = service?.maxPromptChars ?? Number.POSITIVE_INFINITY;
  const promptLongEnough = [...prompt.trim()].length >= minPrompt;
  const promptReady = isModel || (Boolean(prompt.trim()) && promptLongEnough && promptChars <= maxPrompt);
  const referenceLimits = service?.references ?? { min: 0, max: 0 };
  const referencesReady = references.length >= referenceLimits.min && references.length <= referenceLimits.max;
  const estimate = service ? estimateGenerationCredits(service, params.prompt, references.length) : 0;
  const imageFiles = files.filter(file => REFERENCE_IMAGE.test(file.name)).map(file => file.name);
  const toggleReference = (name: string) => setReferences(previous => previous.includes(name)
    ? previous.filter(value => value !== name) : previous.length < referenceLimits.max ? [...previous, name] : previous);
  const busy = phase.kind === 'quoting' || phase.kind === 'running';
  const makeLabels: Record<Make, string> = { image: t('studio.cloud.makeImage'), sfx: t('studio.cloud.makeSfx'), speech: t('studio.cloud.makeVoice'), music: t('studio.cloud.makeMusic'), model3d: t('studio.cloud.makeModel3d') };
  const placeholders: Record<Make, string> = { image: t('studio.cloud.promptPlaceholder'), sfx: t('studio.cloud.sfxPlaceholder'), speech: t('studio.cloud.voicePlaceholder'), music: t('studio.cloud.musicPlaceholder'), model3d: '' };
  const qualityLabels: Record<OpenPixoModel3dQuality, string> = { draft: t('studio.cloud.qualityDraft'), medium: t('studio.cloud.qualityMedium'), high: t('studio.cloud.qualityHigh') };
  const qualityHints: Record<OpenPixoModel3dQuality, string> = { draft: t('studio.cloud.qualityDraftHint'), medium: t('studio.cloud.qualityMediumHint'), high: t('studio.cloud.qualityHighHint') };

  /** One click: price it silently, then spend only if that is what the button showed. */
  async function generate(event: FormEvent) {
    event.preventDefault();
    if (!service || !promptReady || readOnly || !referencesReady || busy) return;
    // After a failure that may have reached the cloud, trying again is the same request, so it can't pay twice.
    if (phase.kind === 'failed' && phase.retry) { void submit(phase.retry.quote, phase.retry.requestId); return; }
    const shown = estimate;
    setPhase({ kind: 'quoting' }); setError('');
    let quote: OpenPixoGenerationQuote;
    try {
      quote = await quoteCloudMedia(projectId, service.id, params, references);
    } catch (cause) {
      if (!mounted.current) return;
      if (accountErrorCode(cause) === 'INSUFFICIENT_CREDITS') { setPhase({ kind: 'short' }); void refreshOpenPixoCredits(); return; }
      setPhase({ kind: 'edit' }); setError(accountErrorMessage(cause, t));
      return;
    }
    if (!mounted.current) return;
    void refreshOpenPixoCredits();
    if (quote.available < quote.credits) { setPhase({ kind: 'short' }); return; }
    const requestId = `studio-${crypto.randomUUID()}`;
    if (quote.credits > shown) { setPhase({ kind: 'confirm', quote, requestId }); return; }
    await submit(quote, requestId);
  }

  async function follow(taskId: string) {
    let since = 0;
    let reservedSeen = false;
    for (;;) {
      let snapshot: MediaTaskWait;
      try {
        snapshot = await waitMediaTask(taskId, since);
      } catch (cause) {
        // Music and 3D can take minutes. A wait that drops says nothing about the job, which keeps going
        // and can still charge, so it must not read as a failure. Only a refusal ends the wait.
        if (!isTransientWaitError(cause)) throw cause;
        if (!mounted.current) return;
        await new Promise(resolve => setTimeout(resolve, WAIT_RETRY_MS));
        if (!mounted.current) return;
        continue;
      }
      if (!mounted.current) return;
      since = snapshot.nextSince;
      // The daemon reserves after it accepts the task; the balance moves as soon as that exists.
      if (!reservedSeen && snapshot.progress.some(line => line.includes('credits reserved'))) {
        reservedSeen = true;
        void refreshOpenPixoCredits();
      }
      if (snapshot.progress.some(line => line.includes('not confirmed'))) setPhase({ kind: 'running', checking: true });
      if (snapshot.status === 'done') {
        setPhase({ kind: 'done', name: snapshot.file?.name ?? '', preview: audio ? 'audio' : isModel ? 'model' : null });
        void refreshOpenPixoCredits();
        await onSaved();
        return;
      }
      if (snapshot.status === 'failed' || snapshot.status === 'interrupted') {
        void refreshOpenPixoCredits();
        if (snapshot.error?.code === 'INSUFFICIENT_CREDITS') { setPhase({ kind: 'short' }); return; }
        // The daemon writes these for the user, and they carry the billing truth:
        // a job can be paid with only the download failing, so the generic
        // "nothing was charged" is only for a failure that says nothing.
        setPhase({ kind: 'failed', message: snapshot.error?.message ?? t('studio.cloud.failedGeneric'),
          ...(snapshot.error?.code === 'OPENPIXO_DOWNLOAD_FAILED' ? { paidFile: true } : {}) });
        return;
      }
    }
  }

  async function submit(quote: OpenPixoGenerationQuote, requestId: string) {
    if (!service) return;
    setPhase({ kind: 'running', checking: false }); setError('');
    try {
      const { taskId } = await generateCloudMedia(projectId, { service: service.id, surface: service.surface, params,
        output: isModel ? modelOutputName(references[0]) : outputName(prompt, make),
        images: references, quoteId: quote.quoteId, cloudRequestId: requestId });
      void refreshOpenPixoCredits();
      await follow(taskId);
    } catch (cause) {
      if (!mounted.current) return;
      const code = accountErrorCode(cause);
      if (code === 'INSUFFICIENT_CREDITS') { setPhase({ kind: 'short' }); void refreshOpenPixoCredits(); return; }
      // Retrying under the same request id can never pay twice; a stale quote needs a new one, which Generate fetches.
      const retry = code === 'GENERATION_QUOTE_EXPIRED' || code === 'GENERATION_QUOTE_INVALID' ? undefined : { quote, requestId };
      setPhase({ kind: 'failed', message: accountErrorMessage(cause, t), ...(retry ? { retry } : {}) });
    }
  }

  return <Card className={styles.card} data-testid="studio-hosted-image">
    {!signedIn ? <div className={styles.signIn}>
      <p className={styles.muted}>{t('studio.cloud.signedOut')}</p>
      <SignInPanel onSignedIn={() => { void refreshOpenPixoCredits(); }} />
    </div> : catalog.generationPaused ? <p className={styles.muted} role="status">{t('studio.cloud.paused')}</p> : <form className={styles.form} onSubmit={event => void generate(event)}>
      {makes.length > 1 && <SegmentedTabs className={styles.makes} label={t('studio.cloud.make')} value={make}
        items={makes.map(value => ({ value, label: makeLabels[value], disabled: busy }))}
        onValueChange={value => setMakeChoice(value as Make)} />}
      {tiered && service?.quality ? <div className={styles.quality}>
        <SegmentedTabs label={t('studio.cloud.quality')} value={service.id}
          items={makeServices.map(entry => ({ value: entry.id, label: qualityLabels[entry.quality!], count: formatCredits(entry.credits, locale), disabled: busy || readOnly }))}
          onValueChange={setServiceId} />
        <p className={styles.note}>{qualityHints[service.quality]}</p>
      </div> : null}
      {isModel ? <p className={styles.note}>{t('studio.cloud.model3dHint')}</p> : <>
        <label className={styles.field}><VisuallyHidden>{t('studio.cloud.prompt')}</VisuallyHidden>
          <Textarea value={prompt} rows={3} maxLength={service?.maxPromptChars} disabled={busy || readOnly} required
            placeholder={placeholders[make]} onChange={event => setPrompt(event.target.value)} /></label>
        {make === 'speech' && service && promptChars >= service.maxPromptChars * COUNT_FROM && <p className={styles.count}>
          {t('studio.cloud.charCount', { count: promptChars, max: service.maxPromptChars })}</p>}
        {prompt.trim() && !promptLongEnough ? <p className={styles.note}>{t('studio.cloud.promptTooShort', { min: minPrompt })}</p> : null}
      </>}
      {servicePicker || aspects.length > 0 || lengths.length > 0 || styleOptions.length > 0 ? <div className={styles.row}>
        {servicePicker && <label className={styles.field}><span>{t('studio.cloud.service')}</span>
          <Select value={service?.id ?? ''} disabled={busy || readOnly} onChange={event => setServiceId(event.target.value)}>
            {makeServices.map(entry => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
          </Select></label>}
        {aspects.length > 0 && <label className={styles.field}><span>{t('studio.cloud.aspect')}</span>
          <Select value={aspect} disabled={busy || readOnly} onChange={event => setAspectChoice(event.target.value as OpenPixoGenerationAspect)}>
            {aspects.map(value => <option key={value} value={value}>{value}</option>)}
          </Select></label>}
        {styleOptions.length ? <label className={styles.field}><span>{t(make === 'speech' ? 'studio.cloud.voice' : 'studio.cloud.style')}</span>
          <Select value={style} disabled={busy || readOnly} onChange={event => setStyleChoice(event.target.value)}>
            {styleOptions.map(value => <option key={value} value={value}>{value.replace(/^.*\//u, '').replace(/_/gu, ' ')}</option>)}
          </Select></label> : null}
        {lengths.length > 0 && <label className={styles.field}><span>{t('studio.cloud.length')}</span>
          <Select value={String(length)} disabled={busy || readOnly} onChange={event => setLengthChoice(Number(event.target.value))}>
            {lengths.map(value => <option key={value} value={value}>{t('studio.cloud.seconds', { count: value })}</option>)}
          </Select></label>}
      </div> : null}
      {make === 'music' && <p className={styles.note}>{t('studio.cloud.musicNote')}</p>}
      {referenceLimits.max > 0 && <fieldset className={styles.references} disabled={busy || readOnly}>
        <legend>{isModel ? t('studio.cloud.model3dPicture') : t('studio.cloud.references', { min: referenceLimits.min, max: referenceLimits.max })}</legend>
        {!isModel && <p className={styles.note}>{t('studio.cloud.referencesHint')}</p>}
        {imageFiles.length ? <div className={styles.referenceList}>{imageFiles.map(name => <label key={name} className={styles.referenceOption}>
          <input type="checkbox" checked={references.includes(name)} onChange={() => toggleReference(name)}
            disabled={!references.includes(name) && references.length >= referenceLimits.max} />
          <span>{references.includes(name) ? `${references.indexOf(name) + 1}. ` : ''}{name}</span>
        </label>)}</div> : <p className={styles.muted}>{t('studio.cloud.noImages')}</p>}
      </fieldset>}
      {phase.kind === 'running' && <p className={styles.status} role="status">
        {phase.checking ? t('studio.cloud.checking') : t('studio.cloud.generating')}</p>}
      {phase.kind === 'done' && <div className={styles.outcome} role="status">
        <span>{t('studio.cloud.done', { name: phase.name })}</span>
        <Button size="sm" variant="secondary" onClick={() => onOpenFile(phase.name)}>{t('studio.cloud.open')}</Button>
        {phase.preview === 'audio' && phase.name ? <audio className={styles.player} controls preload="metadata" src={projectRawUrl(projectId, phase.name)} data-testid="studio-hosted-audio" /> : null}
        {phase.preview === 'model' && phase.name ? <div className={styles.modelPreview}>
          <Model3dViewer src={projectRawUrl(projectId, phase.name)} name={phase.name} height={MODEL_PREVIEW_HEIGHT} />
        </div> : null}
      </div>}
      {phase.kind === 'short' && <div className={styles.failure} role="alert">
        <span>{t('studio.cloud.notEnough')}</span>
        {onOpenAccount && <Button size="sm" variant="secondary" onClick={onOpenAccount}>{t('studio.cloud.getCredits')}</Button>}
      </div>}
      {phase.kind === 'failed' && <p className={styles.failure} role="alert">{t('studio.cloud.failed', { message: phase.message })}</p>}
      {error && <p className={styles.failure} role="alert">{error}</p>}
      <p className={styles.note}>{t(audio ? 'studio.cloud.privacyAudio' : isModel ? 'studio.cloud.privacyModel3d' : 'studio.cloud.privacy')}</p>
      {phase.kind === 'confirm' ? <div className={styles.footer}>
        <span className={styles.realPrice} role="status">{t('studio.cloud.realPrice', { count: formatCredits(phase.quote.credits, locale) })}</span>
        <div className={styles.actions}>
          <Button type="button" variant="ghost" onClick={() => setPhase({ kind: 'edit' })}>{t('studio.cloud.cancel')}</Button>
          <Button type="button" variant="primary" onClick={() => { void submit(phase.quote, phase.requestId); }}>{t('studio.cloud.confirm', { count: formatCredits(phase.quote.credits, locale) })}</Button>
        </div>
      </div> : <div className={styles.footer}>
        <span id={estimateId} className={styles.estimate}>{estimate === 1 ? t('studio.cloud.aboutOne') : t('studio.cloud.about', { count: formatCredits(estimate, locale) })}</span>
        <Button type="submit" variant="primary" aria-describedby={estimateId} disabled={busy || readOnly || !promptReady || !referencesReady || (phase.kind === 'failed' && phase.paidFile === true)} aria-busy={busy}>
          {phase.kind === 'failed' && phase.retry ? t('studio.cloud.retry') : t('studio.generate')}</Button>
      </div>}
    </form>}
    <VisuallyHidden role="status" aria-live="polite">{phase.kind === 'done' ? t('studio.cloud.doneShort') : ''}</VisuallyHidden>
  </Card>;
}
