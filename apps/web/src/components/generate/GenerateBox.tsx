import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { Button, Input, SegmentedTabs, Select, Textarea, VisuallyHidden } from '@openpixo/components';
import {
  OPENPIXO_MODEL3D_QUALITIES,
  OPENPIXO_MODEL3D_SERVICES,
  type InputField,
  type OpenPixoModel3dQuality,
  type ProjectFile,
  type RecipeSummary,
  type RecipeRun,
  type RecipeRunQuote,
  type RecipeRunRequest,
} from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import type { Dict } from '../../i18n/types';
import { isCloudAccountAvailable, refreshOpenPixoCredits, useOpenPixoAccount } from '../../hooks/useOpenPixoAccount';
import { quoteStudioRun, startStudioRun, StudioRequestError } from '../../providers/studio';
import { projectRawUrl } from '../../providers/registry';
import { openMediaSettings } from '../../settings-navigation';
import { formatCredits } from '../account/account-format';
import { SignInPanel } from '../account/CloudSignIn';
import { Icon } from '../Icon';
import { localizedRecipeCopy, localizedRecipeInputs } from '../studio/localization';
import { missingRecipeCapabilities } from '../studio/media-capabilities';
import { studioMedia, studioRecipeDetail, studioServices, useCacheEntry } from '../studio/studio-cache';
import { StyleChoices, StyleThumbnail } from '../studio/StylePicker';
import type { useArtStyles } from '../studio/useArtStyles';
import { leadExample, PresetCards, recipeExampleUrl, type PresetSample } from './PresetCards';
import { ReferenceUpload, type UploadedReference } from './ReferenceUpload';
import { CountPicker, ShapePicker } from './SizePopover';
import {
  AUDIO_KINDS, KIND_SPECS, generateEstimate, generateFormReady, generateRequest, hostedServiceId, ownToolMakes, presetEstimate, presetFitsBox, sizeOffer,
  presetPromptField, presetReady, presetRequest, presetSettings, tabOfKind, withKind,
  type GenerateForm, type GenerateKind, type PresetRecipe,
} from './generate-request';
import styles from './GenerateBox.module.css';

const REFERENCE_IMAGE = /\.(png|jpe?g|webp)$/iu;
const SECONDS = [1, 2, 3, 5, 10] as const;
const PAUSED_RECHECK_MS = 30_000;

type Phase =
  | { kind: 'edit' }
  | { kind: 'working' }
  /** The cloud's price came back above the number on the button: nothing is spent until the user says so. */
  | { kind: 'confirm'; quote: Extract<RecipeRunQuote, { paid: true }>; request: RecipeRunRequest }
  | { kind: 'short' }
  | { kind: 'noTool' };

/** The box opens one panel at a time above the prompt: the style grid, the presets, or the game's pictures. */
type Panel = 'styles' | 'presets' | 'references' | null;
/** What the tile at the right of the prompt shows: the style (images only) or the presets. */
type Side = 'style' | 'presets';

const KIND_LABEL: Record<GenerateKind, keyof Dict> = {
  image: 'studio.cloud.makeImage', sfx: 'studio.cloud.makeSfx', voice: 'studio.cloud.makeVoice', music: 'studio.cloud.makeMusic', model3d: 'studio.cloud.makeModel3d',
};
const PLACEHOLDER: Record<Exclude<GenerateKind, 'model3d'>, keyof Dict> = {
  image: 'studio.cloud.promptPlaceholder', sfx: 'studio.cloud.sfxPlaceholder', voice: 'studio.cloud.voicePlaceholder', music: 'studio.cloud.musicPlaceholder',
};
const QUALITY_LABEL: Record<OpenPixoModel3dQuality, keyof Dict> = {
  draft: 'studio.cloud.qualityDraft', medium: 'studio.cloud.qualityMedium', high: 'studio.cloud.qualityHigh',
};


/** A setting's label, short enough for a pill: the words before any bracketed explanation. */
const pillLabel = (label: string) => label.replace(/\s*[（(].*$/u, '').trim() || label;

/**
 * The 生成 box (specs/current/asset-generator.md §6.2): pick a kind, describe it,
 * press 生成. Every kind is a plain recipe run, priced first; a preset picked from
 * the page sits in the box as a tag, and the description then fills its text field.
 *
 * It never spends more than it showed. The click asks the daemon for a price of
 * every candidate; a tool of the user's own makes it free, a price at or below the
 * button's number is spent at once (the click was the confirmation of that
 * number), and a higher price or a short balance stops and asks. The run carries
 * the price's id, so a retry finds the run it already paid for.
 *
 * Laid out on one grid: kind tabs on top; reference pictures, the description and
 * the style tile in three columns that share a label row and a picture row; settings
 * as pills and the Generate button along the bottom.
 */
export function GenerateBox({ projectId, files, uploads, onUploaded, form, onFormChange, readOnly, againRequest, focusRequest, onStarted, onOpenAccount,
  presets = [], onPickPreset, onOpenPreset, onOpenGameStyle, artStyles }: {
  /** The game the art is for, or null for none: references are then pictures uploaded here. */
  projectId: string | null;
  files: ProjectFile[];
  uploads: readonly UploadedReference[];
  onUploaded: (upload: UploadedReference) => void;
  form: GenerateForm;
  onFormChange: (form: GenerateForm) => void;
  readOnly?: boolean;
  /** 再来一次 from a result: generate what the box now holds, once per nonce. */
  againRequest?: number;
  /** Bring the box into view and put the cursor in the description, once per nonce. */
  focusRequest?: number;
  onStarted: (run: RecipeRun) => void;
  onOpenAccount?: (() => void) | undefined;
  /** The presets this page offers; the 预设 tile lists those of the picked kind. */
  presets?: readonly RecipeSummary[];
  /** A preset picked in the box's 预设 panel: the page puts it in the box, or opens its form. */
  onPickPreset?: ((recipe: RecipeSummary, sample?: PresetSample) => void) | undefined;
  /** Opens a preset's full form, with its examples. */
  onOpenPreset?: ((recipeId: string) => void) | undefined;
  /** Opens the picked game's own style setting, from the style panel. */
  onOpenGameStyle?: (() => void) | undefined;
  /** The installed styles and the game's own, read once by the page. */
  artStyles: ReturnType<typeof useArtStyles>;
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
  const [panel, setPanel] = useState<Panel>(null);
  const [side, setSide] = useState<Side>('style');
  const estimateId = useId();
  const mounted = useRef(true);
  const boxRef = useRef<HTMLFormElement | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  // A preset in the box: its fields come from its detail, read once and cached.
  const presetId = form.preset?.id ?? null;
  const presetEntry = presetId ? studioRecipeDetail(presetId) : null;
  const { value: presetDetail } = useCacheEntry(presetEntry);
  useEffect(() => { if (presetEntry && !presetEntry.get().value) void presetEntry.refresh(); }, [presetEntry]);
  const presetSummary = presetId ? presets.find(recipe => recipe.id === presetId) ?? null : null;
  const presetRecipe = useMemo<PresetRecipe | null>(() => presetDetail && presetDetail.id === presetId ? {
    id: presetDetail.id, surface: presetDetail.surface,
    fields: localizedRecipeInputs(presetDetail.manifest.pixo?.recipe?.inputs ?? [], locale),
    count: presetDetail.manifest.pixo?.recipe?.generation?.count,
  } : null, [presetDetail, presetId, locale]);
  // One that needs a picture or a character cannot run from here: it opens its own form.
  useEffect(() => {
    if (!presetRecipe || presetFitsBox(presetRecipe.fields)) return;
    onFormChange(withKind(form, form.kind));
    onOpenPreset?.(presetRecipe.id);
  });

  const paused = catalog?.generationPaused ?? false;
  // Own tools and the cloud's catalogue can change while 生成 is open; look again when the window comes back.
  useEffect(() => {
    const recheck = () => { void mediaEntry.refresh(); if (cloudAvailable) void servicesEntry.refresh(); };
    recheck();
    window.addEventListener('focus', recheck);
    const timer = paused ? window.setInterval(recheck, PAUSED_RECHECK_MS) : undefined;
    return () => { window.removeEventListener('focus', recheck); window.clearInterval(timer); };
  }, [cloudAvailable, paused, mediaEntry, servicesEntry]);
  // Any edit makes it a different request: a price it was stopped on, or the last one's error, no longer applies.
  useEffect(() => {
    setPhase(previous => previous.kind === 'edit' || previous.kind === 'working' ? previous : { kind: 'edit' });
    setError('');
  }, [form]);
  // Esc closes an open panel.
  useEffect(() => {
    if (!panel) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setPanel(null); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [panel]);
  // A card on the page put something in the box: show it and start typing.
  const lastFocus = useRef(focusRequest);
  useEffect(() => {
    if (focusRequest === undefined || focusRequest === lastFocus.current) return;
    lastFocus.current = focusRequest;
    const box = boxRef.current;
    box?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    box?.querySelector<HTMLTextAreaElement>('textarea')?.focus({ preventScroll: true });
  });

  const services = catalog?.services ?? [];
  const ownTool = presetId
    ? Boolean(media && presetSummary && presetSummary.requires.length && !missingRecipeCapabilities(presetSummary, media).length)
    : ownToolMakes(form, media);
  const estimate = ownTool ? null : presetId ? presetEstimate(form, presetSummary?.requires ?? [], services) : generateEstimate(form, services);
  const ready = presetId ? Boolean(presetRecipe && presetReady(form, presetRecipe)) : generateFormReady(form);
  const busy = phase.kind === 'working';
  const spec = KIND_SPECS[form.kind];
  const maxReferences = presetId ? 0 : spec.maxReferences;
  const maxCount = presetId ? presetRecipe?.count?.max ?? 4 : spec.maxCount;
  const takesCount = !presetRecipe?.fields.some(field => field.type === 'count');
  const tab = tabOfKind(form.kind);
  // An own tool takes any shape and size; credits buy what the hosted service sells.
  const imageService = ownTool ? undefined : services.find(entry => entry.id === hostedServiceId(form));
  const offer = sizeOffer(form, imageService);
  const set = (patch: Partial<GenerateForm>) => onFormChange({ ...form, ...patch });
  const setPresetInput = (name: string, value: unknown) => form.preset && set({ preset: { ...form.preset, inputs: { ...form.preset.inputs, [name]: value } } });
  const gameImages = projectId ? files.map(file => file.name).filter(name => REFERENCE_IMAGE.test(name)) : [];
  const referenceName = (ref: string) => uploads.find(upload => upload.ref === ref)?.name ?? ref;
  const referencePreview = (ref: string) => projectId ? projectRawUrl(projectId, ref) : uploads.find(upload => upload.ref === ref)?.preview;
  const gameStyle = artStyles.projectStyle?.style ?? null;
  const pickedStyle = form.styleId ? artStyles.styles.find(style => style.id === form.styleId) ?? null : null;
  const styleLabel = form.styleId === null ? t('studio.style.none')
    : form.styleId ? pickedStyle?.title ?? form.styleId
    : projectId ? gameStyle ? t('generate.gameStyleNamed', { name: gameStyle.title }) : t('studio.style.projectDefault') : t('generate.noStyle');
  const shownStyle = form.styleId === undefined ? (projectId ? gameStyle : null) : pickedStyle;
  // With no style yet, the tile shows a few of the styles there are to pick from.
  const styleCover = artStyles.styles.slice(0, 3);
  const voices = services.find(entry => entry.id === KIND_SPECS.voice.service)?.styles ?? [];
  const kindPresets = presets.filter(recipe => (recipe.surface === 'audio' ? 'audio' : recipe.surface) === tab);
  const canPick = Boolean(onPickPreset) && kindPresets.length > 0;
  const shownSide: Side | null = form.kind === 'image' && (side === 'style' || !canPick) ? 'style' : canPick ? 'presets' : null;
  const shownPanel: Panel = panel === 'styles' && form.kind !== 'image' ? null : panel === 'references' && (!projectId || !maxReferences) ? null
    : panel === 'presets' && !kindPresets.length ? null : panel;
  const presetCover = kindPresets.map(recipe => ({ recipe, lead: leadExample(recipe) })).filter(entry => entry.lead).slice(0, 3);
  const toggle = (next: Exclude<Panel, null>) => setPanel(open => open === next ? null : next);
  const promptField = presetRecipe ? presetPromptField(presetRecipe.fields) : null;
  const settings = presetRecipe ? presetSettings(presetRecipe.fields) : [];
  const presetTitle = presetSummary ? localizedRecipeCopy(presetSummary, locale).title
    : presetDetail ? localizedRecipeCopy({ ...presetDetail, title_i18n: presetDetail.manifest.title_i18n, description_i18n: presetDetail.manifest.description_i18n }, locale).title : presetId ?? '';
  const presetLead = presetSummary ? leadExample(presetSummary) : null;

  async function generate(event?: FormEvent) {
    event?.preventDefault();
    if (readOnly || busy || !ready) return;
    setError('');
    setPanel(null);
    const request = presetId && presetRecipe ? presetRequest(form, presetRecipe) : generateRequest(form, { ownTool });
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
    if (maxReferences === 1) { set({ references: picked ? [] : [name] }); return; }
    set({ references: picked ? form.references.filter(value => value !== name)
      : form.references.length < maxReferences ? [...form.references, name] : form.references });
  }

  const tabs = [
    { value: 'image', label: <span className={styles.tabLabel}><span className={styles.tabDot} data-tab="image" aria-hidden="true" />{t('studio.cloud.makeImage')}</span> },
    { value: 'audio', label: <span className={styles.tabLabel}><span className={styles.tabDot} data-tab="audio" aria-hidden="true" />{t('generate.audio')}</span> },
    { value: 'model3d', label: <span className={styles.tabLabel}><span className={styles.tabDot} data-tab="model3d" aria-hidden="true" />{t('studio.cloud.makeModel3d')}</span> },
  ];
  const priceLine = ownTool ? t('generate.ownTool')
    : estimate === null ? '' : estimate === 1 ? t('studio.cloud.aboutOne') : t('studio.cloud.about', { count: formatCredits(estimate, locale) });
  const privacyKey: keyof Dict = form.kind === 'model3d' ? 'studio.cloud.privacyModel3d' : tab === 'audio' ? 'studio.cloud.privacyAudio' : 'studio.cloud.privacy';
  const referenceLegend = form.kind === 'model3d' ? t('studio.cloud.model3dPicture') : t('generate.references', { max: maxReferences });
  const full = form.references.length >= maxReferences && maxReferences > 1;
  const placeholder = presetId ? promptField?.placeholder ?? promptField?.label ?? '' : form.kind === 'model3d' ? '' : t(PLACEHOLDER[form.kind]);

  return <form ref={boxRef} className={styles.box} onSubmit={event => void generate(event)} data-testid="generate-box" data-busy={busy || undefined} data-tab={tab}>
    {shownPanel === 'styles' && <section className={styles.panel} aria-label={t('studio.style.title')} data-testid="generate-style-panel">
      <header className={styles.panelHeader}>
        <span className={styles.panelTitle}>{t('studio.style.title')}</span>
        <span className={styles.panelMeta}>{t('generate.styleThisTime')}</span>
        {onOpenGameStyle && <Button type="button" size="sm" variant="ghost" className={styles.panelLink} onClick={() => { setPanel(null); onOpenGameStyle(); }}
          data-testid="generate-game-style">{t('generate.gameStyleSettings')}</Button>}
        <Button type="button" size="sm" variant="ghost" className={styles.panelClose} aria-label={t('generate.closePanel')} onClick={() => setPanel(null)}>
          <Icon name="close" size={14} /></Button>
      </header>
      <div className={styles.panelBody}>
        <StyleChoices items={artStyles.styles} value={form.styleId} disabled={artStyles.loading}
          onChange={id => { set({ styleId: id }); setPanel(null); }}
          firstLabel={projectId ? t('studio.style.projectDefault') : t('generate.noStyle')} firstStyle={projectId ? gameStyle : null}
          firstValue={undefined} includeNone={Boolean(projectId)} layout="grid" />
      </div>
    </section>}
    {shownPanel === 'presets' && <section className={styles.panel} aria-label={t('generate.presetsTitle')} data-testid="generate-preset-panel">
      <header className={styles.panelHeader}>
        <span className={styles.panelTitle}>{t('generate.presetsTitle')}</span>
        <span className={styles.panelMeta}>{t('generate.presetsLead')}</span>
        <Button type="button" size="sm" variant="ghost" className={styles.panelClose} aria-label={t('generate.closePanel')} onClick={() => setPanel(null)}>
          <Icon name="close" size={14} /></Button>
      </header>
      <div className={styles.panelBody}>
        <PresetCards recipes={kindPresets} compact activeId={presetId} onPick={(recipe, sample) => { setPanel(null); onPickPreset?.(recipe, sample); }} />
      </div>
    </section>}
    {shownPanel === 'references' && <section className={styles.panel} aria-label={t('generate.pickFromGame')} data-testid="generate-reference-panel">
      <header className={styles.panelHeader}>
        <span className={styles.panelTitle}>{t('generate.pickFromGame')}</span>
        <span className={styles.panelMeta}>{referenceLegend}</span>
        <Button type="button" size="sm" variant="ghost" className={styles.panelClose} aria-label={t('generate.closePanel')} onClick={() => setPanel(null)}>
          <Icon name="close" size={14} /></Button>
      </header>
      {gameImages.length ? <div className={styles.pictureGrid}>{gameImages.map(name => {
        const index = form.references.indexOf(name);
        return <label key={name} className={styles.picture} data-picked={index >= 0 || undefined} title={name}>
          <input type={maxReferences === 1 ? 'radio' : 'checkbox'} name={`${estimateId}-pick`} checked={index >= 0} className={styles.pictureInput}
            onChange={() => toggleReference(name)} onClick={() => { if (maxReferences === 1 && index >= 0) toggleReference(name); }}
            disabled={index < 0 && full} />
          <img src={projectRawUrl(projectId!, name)} alt="" loading="lazy" />
          <span className={styles.pictureName}>{name}</span>
          {index >= 0 && <span className={styles.pictureMark} aria-hidden="true">{maxReferences > 1 ? index + 1 : <Icon name="check" size={12} />}</span>}
        </label>;
      })}</div> : <p className={styles.muted}>{t('studio.cloud.noImages')}</p>}
    </section>}

    <div className={styles.top}>
      <SegmentedTabs className={styles.kindTabs} label={t('studio.cloud.make')} value={tab}
        items={tabs.map(item => ({ ...item, disabled: busy }))}
        onValueChange={value => onFormChange(withKind(form, value === 'audio' ? (AUDIO_KINDS.includes(form.kind) ? form.kind : 'sfx') : value as GenerateKind))} />
      {tab === 'audio' && !presetId && <SegmentedTabs className={styles.subTabs} label={t('generate.audio')} value={form.kind}
        items={AUDIO_KINDS.map(kind => ({ value: kind, label: t(KIND_LABEL[kind]), disabled: busy }))}
        onValueChange={value => onFormChange(withKind(form, value as GenerateKind))} />}
    </div>

    <fieldset className={styles.fields} disabled={busy || readOnly}>
      <div className={styles.main}>
        {maxReferences > 0 && <div className={styles.column}>
          <span className={styles.columnLabel} aria-hidden="true">
            {form.kind === 'model3d' ? t('studio.cloud.model3dPicture') : t('generate.referencesShort')}
            {maxReferences > 1 && <span className={styles.columnCount}>{form.references.length}/{maxReferences}</span>}
          </span>
          <fieldset className={styles.references}>
            <legend><VisuallyHidden>{referenceLegend}</VisuallyHidden></legend>
            {form.references.map((ref, index) => <label key={ref} className={styles.chip} title={referenceName(ref)}>
              <input type="checkbox" checked onChange={() => toggleReference(ref)} className={styles.pictureInput} />
              <ReferencePicture src={referencePreview(ref)} />
              <VisuallyHidden>{referenceName(ref)}</VisuallyHidden>
              {maxReferences > 1 && <span className={styles.chipIndex} aria-hidden="true">{index + 1}</span>}
              <span className={styles.chipRemove} aria-hidden="true"><Icon name="close" size={10} /></span>
            </label>)}
            {form.references.length < maxReferences && (projectId
              ? <Button type="button" variant="ghost" className={styles.addTile} aria-expanded={shownPanel === 'references'}
                onClick={() => toggle('references')} data-testid="generate-add-reference">
                <span className={styles.plus} aria-hidden="true" /><span>{form.kind === 'model3d' ? t('studio.cloud.model3dPicture') : t('generate.addPicture')}</span></Button>
              : <ReferenceUpload className={styles.addTile} disabled={busy || readOnly} onUploaded={upload => {
                onUploaded(upload);
                if (form.references.length < maxReferences) set({ references: maxReferences === 1 ? [upload.ref] : [...form.references, upload.ref] });
              }}><span className={styles.plus} aria-hidden="true" /><span>{form.kind === 'model3d' ? t('studio.cloud.model3dPicture') : t('generate.addPicture')}</span></ReferenceUpload>)}
          </fieldset>
        </div>}

        <div className={styles.promptColumn}>
          {presetId && <div className={styles.tagRow}>
            <span className={styles.tag} data-testid="generate-tag" data-recipe-id={presetId}>
              <span className={styles.tagArt} aria-hidden="true">
                {presetLead && <img alt="" src={recipeExampleUrl(presetId, presetLead.index, presetLead.example.after ? 'after' : 'cover')} />}
              </span>
              <span className={styles.tagName}>{presetTitle}</span>
              <button type="button" className={styles.tagRemove} aria-label={t('generate.removePreset', { name: presetTitle })}
                onClick={() => onFormChange(withKind(form, form.kind))} data-testid="generate-tag-remove"><Icon name="close" size={11} /></button>
            </span>
            {onOpenPreset && <button type="button" className={styles.tagMore} onClick={() => onOpenPreset(presetId)} data-testid="generate-tag-form">
              {t('generate.presetForm')}</button>}
          </div>}
          {form.kind === 'model3d' ? <p className={styles.hint}>{t('studio.cloud.model3dHint')}</p> : <label className={styles.prompt}>
            <VisuallyHidden>{presetId ? promptField?.label ?? t('studio.cloud.prompt') : form.kind === 'voice' ? t('generate.line') : t('studio.cloud.prompt')}</VisuallyHidden>
            <Textarea value={form.text} rows={3} required data-testid="generate-text" className={styles.textarea}
              placeholder={placeholder} onChange={event => set({ text: event.target.value })}
              onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void generate(); }} />
          </label>}
        </div>

        {shownSide && <div className={styles.column}>
          {form.kind === 'image' && canPick ? <div className={styles.sideTabs} role="group" aria-label={t('generate.sideLabel')}>
            <button type="button" className={styles.sideTab} aria-pressed={shownSide === 'style'} onClick={() => setSide('style')}>{t('studio.style.title')}</button>
            <button type="button" className={styles.sideTab} aria-pressed={shownSide === 'presets'} onClick={() => setSide('presets')}>{t('generate.presetsTitle')}</button>
          </div> : <span className={styles.columnLabel} aria-hidden="true">{shownSide === 'style' ? t('studio.style.title') : t('generate.presetsTitle')}</span>}
          {shownSide === 'style' ? <Button type="button" variant="ghost" className={styles.sideTile} aria-expanded={shownPanel === 'styles'}
            aria-label={t('generate.styleChip', { name: styleLabel })} onClick={() => toggle('styles')} data-testid="generate-style">
            <span className={styles.sideArt} data-styles={!shownStyle && styleCover.length > 1 || undefined}>
              {shownStyle ? <StyleThumbnail style={shownStyle} /> : styleCover.map(style => <StyleThumbnail key={style.id} style={style} />)}</span>
            <span className={styles.sideName}>{shownStyle ? styleLabel : t('generate.pickStyle')}</span>
          </Button> : <Button type="button" variant="ghost" className={styles.sideTile} aria-expanded={shownPanel === 'presets'}
            onClick={() => toggle('presets')} data-testid="generate-presets-tile">
            <span className={styles.sideArt} data-collage={presetCover.length > 1 || undefined}>
              {presetCover.length ? presetCover.map(({ recipe, lead }) => <img key={recipe.id} alt="" loading="lazy"
                src={recipeExampleUrl(recipe.id, lead!.index, lead!.example.after ? 'after' : 'cover')} />) : null}
            </span>
            <span className={styles.sideName}>{t('generate.pickPreset', { count: kindPresets.length })}</span>
          </Button>}
        </div>}
      </div>

      <div className={styles.bar}>
        <div className={styles.pills}>
          {presetId ? settings.map(field => <PresetSetting key={field.name} field={field} value={form.preset?.inputs[field.name] ?? field.default}
            onChange={value => setPresetInput(field.name, value)} />) : <>
            {form.kind === 'image' && <>
              <ShapePicker aspect={form.aspect} resolution={offer.resolution} aspects={offer.aspects} resolutions={offer.resolutions}
                service={imageService} paid={!ownTool} onChange={patch => set(patch)} />
              <label className={styles.switch}>
                <Input type="checkbox" role="switch" className={styles.switchInput} checked={form.transparent} onChange={event => set({ transparent: event.target.checked })} />
                <span className={styles.switchTrack} aria-hidden="true" />{t('generate.transparent')}</label>
            </>}
            {form.kind === 'sfx' && <label className={styles.pill}><span className={styles.pillLabel} aria-hidden="true">{t('studio.cloud.length')}</span><VisuallyHidden>{t('studio.cloud.length')}</VisuallyHidden>
              <Select className={styles.pillSelect} value={String(form.seconds)} onChange={event => set({ seconds: Number(event.target.value) })}>
                {SECONDS.map(value => <option key={value} value={value}>{t('studio.cloud.seconds', { count: value })}</option>)}
              </Select></label>}
            {form.kind === 'voice' && <label className={styles.pill}><span className={styles.pillLabel} aria-hidden="true">{t('studio.cloud.voice')}</span><VisuallyHidden>{t('studio.cloud.voice')}</VisuallyHidden>
              {!ownTool && voices.length ? <Select className={styles.pillSelect} value={form.voice} required onChange={event => set({ voice: event.target.value })} data-testid="generate-voice">
                <option value="" disabled>{t('generate.pickVoice')}</option>
                {voices.map(value => <option key={value} value={value}>{value.replace(/^.*\//u, '').replace(/_/gu, ' ')}</option>)}
              </Select> : <Input className={styles.pillInput} value={form.voice} required placeholder={t('generate.voicePlaceholder')} onChange={event => set({ voice: event.target.value })} data-testid="generate-voice" />}
            </label>}
            {form.kind === 'model3d' && !ownTool && signedIn && <SegmentedTabs className={styles.qualityTabs} label={t('studio.cloud.quality')} value={form.quality}
              items={OPENPIXO_MODEL3D_QUALITIES.map(quality => {
                const credits = services.find(entry => entry.id === OPENPIXO_MODEL3D_SERVICES[quality])?.credits;
                return { value: quality, label: t(QUALITY_LABEL[quality]), ...(credits !== undefined ? { count: formatCredits(credits, locale) } : {}) };
              })}
              onValueChange={value => set({ quality: value as OpenPixoModel3dQuality })} />}
          </>}
          {takesCount && <CountPicker count={form.count} max={maxCount} onChange={count => set({ count })} />}
        </div>

        {phase.kind === 'confirm' ? <div className={styles.go}>
          <span className={styles.realPrice} role="status">{t('studio.cloud.realPrice', { count: formatCredits(phase.quote.credits, locale) })}</span>
          <Button type="button" variant="ghost" onClick={() => setPhase({ kind: 'edit' })}>{t('studio.cloud.cancel')}</Button>
          <Button type="button" className={styles.submit} data-testid="generate-confirm" onClick={() => { void start(phase.request); }}>
            {t('studio.cloud.confirm', { count: formatCredits(phase.quote.credits, locale) })}</Button>
        </div> : <div className={styles.go}>
          <span id={estimateId} className={styles.estimate} data-testid="generate-estimate">{priceLine}</span>
          <Button type="submit" className={styles.submit} aria-describedby={estimateId} disabled={busy || readOnly || !ready} aria-busy={busy} data-testid="generate-submit">
            {busy && <Icon name="spinner" size={16} />}
            {t('studio.generate')}
            {(estimate !== null || ownTool) && <span className={styles.cost} aria-hidden="true">
              {ownTool ? t('generate.priceFree') : t('generate.creditsShort', { count: formatCredits(estimate!, locale) })}</span>}
          </Button>
        </div>}
      </div>
    </fieldset>

    {!ownTool && (signedIn || form.kind === 'music') ? <div className={styles.notes}>
      {!ownTool && signedIn && paused && <p className={styles.muted} role="status">{t('studio.cloud.paused')}</p>}
      {form.kind === 'music' && !ownTool && !presetId && <p className={styles.note}>{t('studio.cloud.musicNote')}</p>}
      {!ownTool && signedIn && <p className={styles.note}>{t(privacyKey)}</p>}
    </div> : null}
    {!ownTool && cloudAvailable && !signedIn && <div className={styles.signIn}>
      <p className={styles.muted}>{t('studio.cloud.signedOut')}</p>
      <SignInPanel autoFocus={false} onSignedIn={() => { void refreshOpenPixoCredits(); }} />
    </div>}
    {phase.kind === 'noTool' && <div className={styles.problem} role="alert">
      <span>{cloudAvailable && !signedIn ? t('generate.noToolSignIn') : t('generate.noTool')}</span>
      <Button size="sm" variant="secondary" onClick={openMediaSettings}>{t('generate.setUpTools')}</Button>
    </div>}
    {phase.kind === 'short' && <div className={styles.problem} role="alert">
      <span>{t('studio.cloud.notEnough')}</span>
      {onOpenAccount && <Button size="sm" variant="secondary" onClick={onOpenAccount}>{t('studio.cloud.getCredits')}</Button>}
    </div>}
    {error && <p className={styles.problem} role="alert">{t('studio.cloud.failed', { message: error })}</p>}
  </form>;
}

/** One of a preset's settings as a pill: a choice, a number, a switch, or a short text. */
function PresetSetting({ field, value, onChange }: { field: InputField; value: unknown; onChange: (value: unknown) => void }) {
  const label = field.label ?? field.name;
  const short = pillLabel(label);
  if (field.type === 'boolean') return <label className={styles.switch} title={label}>
    <Input type="checkbox" role="switch" className={styles.switchInput} checked={value === true} onChange={event => onChange(event.target.checked)} />
    <span className={styles.switchTrack} aria-hidden="true" />{short}</label>;
  return <label className={styles.pill} title={label} data-testid="generate-setting" data-field={field.name}>
    <span className={styles.pillLabel} aria-hidden="true">{short}</span><VisuallyHidden>{label}</VisuallyHidden>
    {field.type === 'select' || field.type === 'aspect'
      ? <Select className={styles.pillSelect} value={String(value ?? '')} onChange={event => onChange(event.target.value)}>
        {(field.options ?? []).map(option => <option key={option} value={option}>{(field.optionLabels as Record<string, string> | undefined)?.[option] ?? option}</option>)}
      </Select>
      : field.type === 'number'
        ? <Input type="number" className={`${styles.pillInput} ${styles.pillNumber}`} value={value === undefined ? '' : String(value)}
          onChange={event => onChange(event.target.value === '' ? undefined : Number(event.target.value))} />
        : <Input className={styles.pillInput} value={typeof value === 'string' ? value : ''} required={field.required} placeholder={field.placeholder ?? ''}
          onChange={event => onChange(event.target.value)} />}
  </label>;
}

/** A picked reference's thumbnail; a picture that cannot be shown falls back to an icon. */
function ReferencePicture({ src }: { src: string | undefined }) {
  const [failed, setFailed] = useState(false);
  return src && !failed ? <img src={src} alt="" onError={() => setFailed(true)} /> : <Icon name="image" size={18} />;
}
