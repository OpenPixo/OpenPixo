import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Button, Input, SegmentedTabs, Select, Textarea, VisuallyHidden } from '@openpixo/components';
import {
  OPENPIXO_MODEL3D_QUALITIES,
  OPENPIXO_MODEL3D_SERVICES,
  type OpenPixoModel3dQuality,
  type ProjectFile,
  type RecipeRun,
  type RecipeRunQuote,
  type RecipeRunRequest,
} from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import type { Dict } from '../../i18n/types';
import { isCloudAccountAvailable, refreshOpenPixoCredits, useOpenPixoAccount } from '../../hooks/useOpenPixoAccount';
import { quoteStudioRun, startStudioRun, StudioRequestError } from '../../providers/studio';
import { openMediaSettings } from '../../settings-navigation';
import { formatCredits } from '../account/account-format';
import { SignInPanel } from '../account/CloudSignIn';
import { studioMedia, studioServices, useCacheEntry } from '../studio/studio-cache';
import {
  AUDIO_KINDS, KIND_SPECS, generateEstimate, generateFormReady, generateRequest, ownToolMakes, tabOfKind, withKind,
  type GenerateForm, type GenerateKind,
} from './generate-request';
import styles from './GenerateView.module.css';

const REFERENCE_IMAGE = /\.(png|jpe?g|webp)$/iu;
const ASPECTS = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'] as const;
const SECONDS = [1, 2, 3, 5, 10] as const;
const PAUSED_RECHECK_MS = 30_000;

type Phase =
  | { kind: 'edit' }
  | { kind: 'working' }
  /** The cloud's price came back above the number on the button: nothing is spent until the user says so. */
  | { kind: 'confirm'; quote: Extract<RecipeRunQuote, { paid: true }>; request: RecipeRunRequest }
  | { kind: 'short' }
  | { kind: 'noTool' };

const KIND_LABEL: Record<GenerateKind, keyof Dict> = {
  image: 'studio.cloud.makeImage', sfx: 'studio.cloud.makeSfx', voice: 'studio.cloud.makeVoice', music: 'studio.cloud.makeMusic', model3d: 'studio.cloud.makeModel3d',
};
const PLACEHOLDER: Record<Exclude<GenerateKind, 'model3d'>, keyof Dict> = {
  image: 'studio.cloud.promptPlaceholder', sfx: 'studio.cloud.sfxPlaceholder', voice: 'studio.cloud.voicePlaceholder', music: 'studio.cloud.musicPlaceholder',
};
const QUALITY_LABEL: Record<OpenPixoModel3dQuality, keyof Dict> = {
  draft: 'studio.cloud.qualityDraft', medium: 'studio.cloud.qualityMedium', high: 'studio.cloud.qualityHigh',
};

/**
 * The 生成 box (specs/current/asset-generator.md §6.2): pick a kind, describe it,
 * press 生成. Every kind is a plain recipe run, priced first.
 *
 * It never spends more than it showed. The click asks the daemon for a price of
 * every candidate; a tool of the user's own makes it free, a price at or below the
 * button's number is spent at once (the click was the confirmation of that
 * number), and a higher price or a short balance stops and asks. The run carries
 * the price's id, so a retry finds the run it already paid for.
 */
export function GenerateBox({ projectId, files, form, onFormChange, readOnly, againRequest, onStarted, onOpenAccount }: {
  projectId: string;
  files: ProjectFile[];
  form: GenerateForm;
  onFormChange: (form: GenerateForm) => void;
  readOnly?: boolean;
  /** 再来一次 from a result: generate what the box now holds, once per nonce. */
  againRequest?: number;
  onStarted: (run: RecipeRun) => void;
  onOpenAccount?: (() => void) | undefined;
}) {
  const { t, locale } = useI18n();
  const account = useOpenPixoAccount();
  const cloudAvailable = isCloudAccountAvailable(account.status);
  const signedIn = cloudAvailable && Boolean(account.status?.signedIn);
  const mediaEntry = studioMedia();
  const servicesEntry = studioServices();
  const { value: media } = useCacheEntry(mediaEntry);
  const { value: catalog } = useCacheEntry(servicesEntry);
  const [phase, setPhase] = useState<Phase>({ kind: 'edit' });
  const [error, setError] = useState('');
  const estimateId = useId();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const paused = catalog?.generationPaused ?? false;
  // Own tools and the cloud's catalogue can change while 生成 is open; look again when the window comes back.
  useEffect(() => {
    const recheck = () => { void mediaEntry.refresh(); if (cloudAvailable) void servicesEntry.refresh(); };
    recheck();
    window.addEventListener('focus', recheck);
    const timer = paused ? window.setInterval(recheck, PAUSED_RECHECK_MS) : undefined;
    return () => { window.removeEventListener('focus', recheck); window.clearInterval(timer); };
  }, [cloudAvailable, paused, mediaEntry, servicesEntry]);
  // Any edit makes it a different request: a price it was stopped on no longer applies.
  useEffect(() => { setPhase(previous => previous.kind === 'edit' || previous.kind === 'working' ? previous : { kind: 'edit' }); },
    [form]);

  const ownTool = ownToolMakes(form, media);
  const services = catalog?.services ?? [];
  const estimate = ownTool ? null : generateEstimate(form, services);
  const ready = generateFormReady(form);
  const busy = phase.kind === 'working';
  const spec = KIND_SPECS[form.kind];
  const tab = tabOfKind(form.kind);
  const set = (patch: Partial<GenerateForm>) => onFormChange({ ...form, ...patch });
  const imageFiles = files.map(file => file.name).filter(name => REFERENCE_IMAGE.test(name));
  const voices = services.find(entry => entry.id === KIND_SPECS.voice.service)?.styles ?? [];

  async function generate(event?: FormEvent) {
    event?.preventDefault();
    if (readOnly || busy || !ready) return;
    setError('');
    const request = generateRequest(form, { ownTool });
    setPhase({ kind: 'working' });
    try {
      const quote = await quoteStudioRun(projectId, request);
      if (!mounted.current) return;
      if (!quote.paid) { await start(request); return; }
      void refreshOpenPixoCredits();
      if (quote.available < quote.credits) { setPhase({ kind: 'short' }); return; }
      const paid = { ...request, quoteId: quote.quoteId };
      if (estimate === null || quote.credits > estimate) { setPhase({ kind: 'confirm', quote, request: paid }); return; }
      await start(paid);
    } catch (cause) { fail(cause); }
  }
  async function start(request: RecipeRunRequest) {
    setPhase({ kind: 'working' });
    try {
      const run = await startStudioRun(projectId, request);
      if (!mounted.current) return;
      if (!('candidates' in run)) throw new Error('A code recipe has no results here');
      if (request.quoteId) void refreshOpenPixoCredits();
      onStarted(run);
      setPhase({ kind: 'edit' });
    } catch (cause) { fail(cause); }
  }
  function fail(cause: unknown) {
    if (!mounted.current) return;
    const code = cause instanceof StudioRequestError ? cause.code : undefined;
    if (code === 'INSUFFICIENT_CREDITS') { setPhase({ kind: 'short' }); void refreshOpenPixoCredits(); return; }
    if (code === 'RECIPE_NO_MODEL') { setPhase({ kind: 'noTool' }); return; }
    setPhase({ kind: 'edit' });
    setError(cause instanceof Error && cause.message.trim() ? cause.message : t('generate.failed'));
  }

  // 再来一次 runs the box as it now stands, once per request.
  const lastAgain = useRef(againRequest);
  useEffect(() => {
    if (againRequest === undefined || againRequest === lastAgain.current) return;
    lastAgain.current = againRequest;
    void generate();
  });

  function toggleReference(name: string) {
    const picked = form.references.includes(name);
    if (spec.maxReferences === 1) { set({ references: picked ? [] : [name] }); return; }
    set({ references: picked ? form.references.filter(value => value !== name)
      : form.references.length < spec.maxReferences ? [...form.references, name] : form.references });
  }

  const tabs = [{ value: 'image', label: t('studio.cloud.makeImage') }, { value: 'audio', label: t('generate.audio') }, { value: 'model3d', label: t('studio.cloud.makeModel3d') }];
  const priceLine = ownTool ? t('generate.ownTool')
    : estimate === null ? '' : estimate === 1 ? t('studio.cloud.aboutOne') : t('studio.cloud.about', { count: formatCredits(estimate, locale) });
  const privacyKey: keyof Dict = form.kind === 'model3d' ? 'studio.cloud.privacyModel3d' : tab === 'audio' ? 'studio.cloud.privacyAudio' : 'studio.cloud.privacy';

  return <form className={styles.box} onSubmit={event => void generate(event)} data-testid="generate-box">
    <SegmentedTabs className={styles.tabs} label={t('studio.cloud.make')} value={tab}
      items={tabs.map(item => ({ ...item, disabled: busy }))}
      onValueChange={value => onFormChange(withKind(form, value === 'audio' ? (AUDIO_KINDS.includes(form.kind) ? form.kind : 'sfx') : value as GenerateKind))} />
    {tab === 'audio' && <SegmentedTabs className={styles.subTabs} label={t('generate.audio')} value={form.kind}
      items={AUDIO_KINDS.map(kind => ({ value: kind, label: t(KIND_LABEL[kind]), disabled: busy }))}
      onValueChange={value => onFormChange(withKind(form, value as GenerateKind))} />}

    <fieldset className={styles.fields} disabled={busy || readOnly}>
      {form.kind === 'model3d' ? <p className={styles.note}>{t('studio.cloud.model3dHint')}</p> : <label className={styles.prompt}>
        <VisuallyHidden>{form.kind === 'voice' ? t('generate.line') : t('studio.cloud.prompt')}</VisuallyHidden>
        <Textarea value={form.text} rows={3} required data-testid="generate-text"
          placeholder={t(PLACEHOLDER[form.kind])} onChange={event => set({ text: event.target.value })}
          onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void generate(); }} />
      </label>}

      {spec.maxReferences > 0 && <fieldset className={styles.references}>
        <legend>{form.kind === 'model3d' ? t('studio.cloud.model3dPicture') : t('generate.references', { max: spec.maxReferences })}</legend>
        {imageFiles.length ? <div className={styles.referenceList}>{imageFiles.map(name => {
          const index = form.references.indexOf(name);
          return <label key={name} className={styles.referenceOption}>
            <input type={spec.maxReferences === 1 ? 'radio' : 'checkbox'} name={`${estimateId}-references`} checked={index >= 0}
              onChange={() => toggleReference(name)} onClick={() => { if (spec.maxReferences === 1 && index >= 0) toggleReference(name); }}
              disabled={index < 0 && spec.maxReferences > 1 && form.references.length >= spec.maxReferences} />
            <span>{index >= 0 && spec.maxReferences > 1 ? `${index + 1}. ` : ''}{name}</span>
          </label>;
        })}</div> : <p className={styles.muted}>{t('studio.cloud.noImages')}</p>}
      </fieldset>}

      <div className={styles.options}>
        {form.kind === 'image' && <>
          <label className={styles.option}><span>{t('studio.cloud.aspect')}</span>
            <Select value={form.aspect} onChange={event => set({ aspect: event.target.value })}>
              {ASPECTS.map(value => <option key={value} value={value}>{value}</option>)}
            </Select></label>
          <label className={styles.check}><Input type="checkbox" checked={form.transparent} onChange={event => set({ transparent: event.target.checked })} />
            {t('generate.transparent')}</label>
        </>}
        {form.kind === 'sfx' && <label className={styles.option}><span>{t('studio.cloud.length')}</span>
          <Select value={String(form.seconds)} onChange={event => set({ seconds: Number(event.target.value) })}>
            {SECONDS.map(value => <option key={value} value={value}>{t('studio.cloud.seconds', { count: value })}</option>)}
          </Select></label>}
        {form.kind === 'voice' && <label className={styles.option}><span>{t('studio.cloud.voice')}</span>
          {!ownTool && voices.length ? <Select value={form.voice} required onChange={event => set({ voice: event.target.value })} data-testid="generate-voice">
            <option value="" disabled>{t('generate.pickVoice')}</option>
            {voices.map(value => <option key={value} value={value}>{value.replace(/^.*\//u, '').replace(/_/gu, ' ')}</option>)}
          </Select> : <Input value={form.voice} required placeholder={t('generate.voicePlaceholder')} onChange={event => set({ voice: event.target.value })} data-testid="generate-voice" />}
        </label>}
        {form.kind === 'model3d' && !ownTool && signedIn && <SegmentedTabs label={t('studio.cloud.quality')} value={form.quality}
          items={OPENPIXO_MODEL3D_QUALITIES.map(quality => {
            const credits = services.find(entry => entry.id === OPENPIXO_MODEL3D_SERVICES[quality])?.credits;
            return { value: quality, label: t(QUALITY_LABEL[quality]), ...(credits !== undefined ? { count: formatCredits(credits, locale) } : {}) };
          })}
          onValueChange={value => set({ quality: value as OpenPixoModel3dQuality })} />}
        <label className={styles.option}><span>{t('generate.count')}</span>
          <Select value={String(form.count)} onChange={event => set({ count: Number(event.target.value) })} data-testid="generate-count">
            {Array.from({ length: spec.maxCount }, (_, index) => index + 1).map(value => <option key={value} value={value}>{value}</option>)}
          </Select></label>
      </div>
      {form.kind === 'music' && !ownTool && <p className={styles.note}>{t('studio.cloud.musicNote')}</p>}
    </fieldset>

    {!ownTool && cloudAvailable && !signedIn && <div className={styles.signIn}>
      <p className={styles.muted}>{t('studio.cloud.signedOut')}</p>
      <SignInPanel autoFocus={false} onSignedIn={() => { void refreshOpenPixoCredits(); }} />
    </div>}
    {!ownTool && signedIn && paused && <p className={styles.muted} role="status">{t('studio.cloud.paused')}</p>}
    {!ownTool && signedIn && <p className={styles.note}>{t(privacyKey)}</p>}
    {phase.kind === 'noTool' && <div className={styles.problem} role="alert">
      <span>{cloudAvailable && !signedIn ? t('generate.noToolSignIn') : t('generate.noTool')}</span>
      <Button size="sm" variant="secondary" onClick={openMediaSettings}>{t('generate.setUpTools')}</Button>
    </div>}
    {phase.kind === 'short' && <div className={styles.problem} role="alert">
      <span>{t('studio.cloud.notEnough')}</span>
      {onOpenAccount && <Button size="sm" variant="secondary" onClick={onOpenAccount}>{t('studio.cloud.getCredits')}</Button>}
    </div>}
    {error && <p className={styles.problem} role="alert">{t('studio.cloud.failed', { message: error })}</p>}

    {phase.kind === 'confirm' ? <div className={styles.footer}>
      <span className={styles.realPrice} role="status">{t('studio.cloud.realPrice', { count: formatCredits(phase.quote.credits, locale) })}</span>
      <div className={styles.actions}>
        <Button type="button" variant="ghost" onClick={() => setPhase({ kind: 'edit' })}>{t('studio.cloud.cancel')}</Button>
        <Button type="button" variant="primary" data-testid="generate-confirm" onClick={() => { void start(phase.request); }}>
          {t('studio.cloud.confirm', { count: formatCredits(phase.quote.credits, locale) })}</Button>
      </div>
    </div> : <div className={styles.footer}>
      <span id={estimateId} className={styles.estimate} data-testid="generate-estimate">{priceLine}</span>
      <Button type="submit" variant="primary" aria-describedby={estimateId} disabled={busy || readOnly || !ready} aria-busy={busy} data-testid="generate-submit">
        {t('studio.generate')}</Button>
    </div>}
  </form>;
}
