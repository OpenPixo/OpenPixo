import { PRODUCT_NAME } from '@openpixo/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';

import { isOpenPixoHostAvailable, pickHostWorkingDir } from '@openpixo/host';
import type { OpenPixoHostProjectImportSuccess } from '@openpixo/host';
import { useAnalytics } from '../analytics/provider';
import {
  trackNewProjectModalElementClick,
  trackNewProjectModalSurfaceView,
} from '../analytics/events';


import { useT } from '../i18n';
import type { Dict } from '../i18n/types';
import { fetchPromptTemplate, openFolderDialog } from '../providers/registry';
import { isStoredMediaProviderEntryPresent } from '../state/config';
import { isMediaProviderPickerReady } from '../media/provider-readiness';
import type {
  AudioKind,
  MediaAspect,
  ProjectMetadata,
  MediaProviderCredentials,
  PromptTemplateSummary,
  SkillSummary,
} from '../types';
import {
  AUDIO_DURATIONS_SEC,
  AUDIO_MODELS_BY_KIND,
  DEFAULT_AUDIO_MODEL,
  DEFAULT_IMAGE_MODEL,
  DEFAULT_VIDEO_MODEL,
  findProvider,
  imageModelIdForPromptTemplate,
  IMAGE_MODELS,
  MEDIA_ASPECTS,
  type MediaModel,
  VIDEO_LENGTHS_SEC,
  VIDEO_MODELS,
} from '../media/models';
import {
  mergeAihubmixModels,
  useAIHubMixImageModels,
  useAIHubMixVideoModels,
  useAIHubMixAudioModels,
} from '../media/aihubmix-image-models';

import { Icon } from './Icon';
import { Toast } from './Toast';
import { useOpenFolderImport } from './useOpenFolderImport';


// Snapshot of a curated prompt template, captured at New Project time and
// folded into ProjectMetadata.promptTemplate. The user may have edited the
// prompt body before clicking Create — that edited copy lives here.
type PromptTemplatePick = {
  summary: PromptTemplateSummary;
  prompt: string;
};

const SFX_AUDIO_DURATIONS_SEC = AUDIO_DURATIONS_SEC.filter((sec) => sec <= 30);

type TranslateFn = (key: keyof Dict, vars?: Record<string, string | number>) => string;

function folderPickerErrorDetails(err: unknown): string | undefined {
  if (!(err instanceof Error)) return undefined;
  const message = err.message.trim();
  if (!message) return undefined;
  const detail = message.replace(/^Could not open folder picker:\s*/i, '').trim();
  return detail || message;
}

export type MediaSurface = 'image' | 'video' | 'audio';

export interface CreateInput {
  name: string;
  skillId: string | null;
  /** UI-only intent marker; the public project contract still receives only the resolved skill id. */
  skillSelectionProvenance?: 'automatic-default' | 'explicit-user';
  metadata: ProjectMetadata;
  userWorkingDirToken?: string;
}

interface Props {
  skills: SkillSummary[];
  promptTemplates: PromptTemplateSummary[];
  onCreate: (input: CreateInput & { requestId?: string }) => void;
  // Local-server flow: the daemon-owned native folder picker returns the
  // selected baseDir, then the renderer POSTs `/api/import/folder`.
  onImportFolder?: (baseDir: string) => Promise<void> | void;
  // Host flow: the desktop main process owns the picker dialog and
  // the import call atomically (`pickAndImport` IPC). The renderer
  // never sees the path or the HMAC token; it only receives the
  // host-owned project identifiers and forwards them here so App-level
  // state can refresh through the daemon API.
  onImportFolderResponse?: (response: OpenPixoHostProjectImportSuccess) => Promise<void> | void;
  mediaProviders?: Record<string, MediaProviderCredentials>;
  loading?: boolean;
}

const MEDIA_SURFACE_LABEL_KEYS: Record<MediaSurface, keyof Dict> = {
  image: 'newproj.surfaceImage',
  video: 'newproj.surfaceVideo',
  audio: 'newproj.surfaceAudio',
};

export function NewProjectPanel({
  skills,
  promptTemplates,
  onCreate,
  onImportFolder,
  onImportFolderResponse,
  mediaProviders,
  loading = false,
}: Props) {
  const t = useT();
  const analytics = useAnalytics();
  const [workingDir, setWorkingDir] = useState<string | null>(null);
  const [workingDirToken, setWorkingDirToken] = useState<string | null>(null);
  const [workingDirPicking, setWorkingDirPicking] = useState(false);
  const [workingDirError, setWorkingDirError] = useState<
    { message: string; details?: string } | null
  >(null);
  const [mediaSurface, setMediaSurface] = useState<MediaSurface>('image');
  const [name, setName] = useState('');

  const [imageModel, setImageModel] = useState(DEFAULT_IMAGE_MODEL);
  const [imageAspect, setImageAspect] = useState<MediaAspect>('1:1');
  const [videoModel, setVideoModel] = useState(DEFAULT_VIDEO_MODEL);
  const [videoModelTouched, setVideoModelTouched] = useState(false);
  const [videoAspect, setVideoAspect] = useState<MediaAspect>('16:9');
  const [videoLength, setVideoLength] = useState(5);
  const [audioKind, setAudioKind] = useState<AudioKind>('speech');
  const [audioModel, setAudioModel] = useState(DEFAULT_AUDIO_MODEL.speech);
  const [audioDuration, setAudioDuration] = useState(10);
  const [voice, setVoice] = useState('');
  // Per-surface curated prompt template the user picked. Tracked
  // independently for image vs video so flipping tabs doesn't clobber the
  // other one's pick. The body is editable in-line and the edited copy is
  // what gets carried to the agent — that's the "optimize the template"
  // prompt template editing affordance.
  const [imagePromptTemplate, setImagePromptTemplate] =
    useState<PromptTemplatePick | null>(null);
  const [videoPromptTemplate, setVideoPromptTemplate] =
    useState<PromptTemplatePick | null>(null);



  const skillIdForTab = useMemo(() => {
    const list = skills.filter((skill) => skill.mode === mediaSurface || skill.surface === mediaSurface);
    if (mediaSurface === 'video' && videoModel === 'hyperframes-html') {
      const hyperframes = list.find((skill) => skill.id === 'hyperframes');
      if (hyperframes) return hyperframes.id;
    }
    return list.find((skill) => skill.defaultFor.includes(mediaSurface))?.id ?? list[0]?.id ?? null;
  }, [mediaSurface, skills, videoModel]);

  useEffect(() => {
    trackNewProjectModalSurfaceView(analytics.track, {
      page_name: 'home', area: 'new_project_modal', tab_name: 'media',
    });
  }, [analytics.track]);

  // When the user picks a curated prompt template, propagate the template's
  // declared `model` and `aspect` onto the actual project state. Without
  // this the user picks (e.g.) a HyperFrames template but `videoModel`
  // stays on the default seedance — the agent then dispatches the wrong
  // model and the render path mismatches the prompt.
  function handleImagePromptTemplate(pick: PromptTemplatePick | null) {
    const rawModel = pick?.summary.model;
    const normalizedModel = rawModel
      ? imageModelIdForPromptTemplate(rawModel)
      : undefined;
    const normalizedPick =
      pick && normalizedModel && normalizedModel !== rawModel
        ? { ...pick, summary: { ...pick.summary, model: normalizedModel } }
        : pick;
    setImagePromptTemplate(normalizedPick);
    const m = normalizedModel;
    // Accept catalogued ids plus any live AIHubMix catalogue id (aihubmix-*),
    // which renders dynamically and won't appear in the static IMAGE_MODELS.
    if (m && (IMAGE_MODELS.some((x) => x.id === m) || m.startsWith('aihubmix-'))) setImageModel(m);
    const a = pick?.summary.aspect;
    if (a && (MEDIA_ASPECTS as readonly string[]).includes(a)) {
      setImageAspect(a as MediaAspect);
    }
  }
  function handleVideoPromptTemplate(pick: PromptTemplatePick | null) {
    setVideoPromptTemplate(pick);
    const m = pick?.summary.model;
    if (m && VIDEO_MODELS.some((x) => x.id === m)) {
      setVideoModel(m);
      setVideoModelTouched(true);
    }
    const a = pick?.summary.aspect;
    if (a && (MEDIA_ASPECTS as readonly string[]).includes(a)) {
      setVideoAspect(a as MediaAspect);
    }
  }
  function handleVideoModel(id: string) {
    setVideoModel(id);
    setVideoModelTouched(true);
  }

  // The HyperFrames skill renders HTML compositions through a local
  // `npx hyperframes render` path, which dispatches under the
  // `hyperframes-html` model — not seedance/veo/sora. When the resolved
  // skill for the video tab is hyperframes, default `videoModel` so the
  // model dropdown matches the actual render path. Once the user has
  // explicitly chosen a model (via the dropdown or by picking a template
  // that declares a model), `videoModelTouched` latches and this effect
  // becomes a no-op for the rest of the panel session — re-entering the
  // Media tab's Video surface no longer silently rewrites their override back to
  // hyperframes-html.
  useEffect(() => {
    if (mediaSurface !== 'video') return;
    if (skillIdForTab !== 'hyperframes') return;
    if (videoModelTouched) return;
    if (videoPromptTemplate) return;
    if (!VIDEO_MODELS.some((m) => m.id === 'hyperframes-html')) return;
    setVideoModel('hyperframes-html');
    // Intentionally leaving videoPromptTemplate / videoModel out of deps
    // so this only fires when the user toggles the tab or the skill
    // resolution shifts — not whenever the user changes the dropdown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaSurface, skillIdForTab, videoModelTouched]);

  const canCreate = !loading;

  function handleCreate() {
    if (!canCreate) return;
    const trimmedName = name.trim();
    const metadata = buildMetadata({
      mediaSurface,
      imageModel,
      imageAspect,
      videoModel,
      videoAspect,
      videoLength,
      audioKind,
      audioModel,
      audioDuration,
      voice,
      promptTemplate: mediaSurface === 'image' ? imagePromptTemplate : mediaSurface === 'video' ? videoPromptTemplate : null,
    });
    // Generate the click→result correlation id here so the home_click and
    // the eventual project_create_result share request_id.
    const requestId = analytics.newRequestId();
    // v2 emits ui_click element=create on the New project modal; the
    // project_create_result correlated through `requestId` carries the
    // project_kind payload, so we no longer duplicate it
    // on the click event.
    trackNewProjectModalElementClick(
      analytics.track,
      {
        page_name: 'home',
        area: 'new_project_modal',
        element: 'create',
        tab_name: 'media',
      },
      { requestId },
    );
    onCreate({
      name: trimmedName || autoName(mediaSurface, t),
      skillId: skillIdForTab,
      skillSelectionProvenance: 'automatic-default',
      metadata: {
        ...metadata,
        nameSource: trimmedName ? 'user' : 'generated',
        ...(workingDir ? { userWorkingDir: workingDir } : {}),
      },
      ...(workingDirToken ? { userWorkingDirToken: workingDirToken } : {}),
      requestId,
    });
  }

  async function handlePickWorkingDir() {
    if (workingDirPicking) return;
    setWorkingDirPicking(true);
    setWorkingDirError(null);
    try {
      if (isOpenPixoHostAvailable()) {
        const result = await pickHostWorkingDir();
        if (result.ok) {
          setWorkingDir(result.baseDir);
          setWorkingDirToken(result.token);
          return;
        }
        if ('canceled' in result && result.canceled) return;
        setWorkingDirError({
          message: t('newproj.folderPickerFailed', { reason: 'reason' in result ? result.reason : 'host unavailable', product: PRODUCT_NAME }),
        });
        return;
      }
      try {
        const picked = await openFolderDialog({ throwOnError: true });
        if (picked) {
          setWorkingDir(picked);
          setWorkingDirToken(null);
        }
      } catch (err) {
        setWorkingDirError({
          message: t('chat.linkedFolderPickError'),
          details: folderPickerErrorDetails(err),
        });
      }
    } finally {
      setWorkingDirPicking(false);
    }
  }

  const folderImport = useOpenFolderImport({
    skillId: skillIdForTab,
    onImportFolder,
    onImportFolderResponse,
  });

  return (
    <div className="newproj" data-testid="new-project-panel">
      <div className="newproj-body">
        <h3 className="newproj-title">
          <span className="newproj-title-text">{titleForSurface(mediaSurface, t)}</span>

        </h3>

        <div className="newproj-name-row">
          <input
            className="newproj-name"
            data-testid="new-project-name"
            placeholder={t('newproj.namePlaceholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="newproj-working-dir-row">
          <button
            type="button"
            className={`ghost newproj-working-dir pixo-tooltip${workingDir ? ' picked' : ''}`}
            onClick={() => void handlePickWorkingDir()}
            disabled={workingDirPicking}
            title={workingDir ?? t('workingDirPicker.homeTitle')}
            data-tooltip={workingDir ?? t('workingDirPicker.homeTitle')}
          >
            <Icon name="folder" size={14} />
            <span>
              {workingDirPicking
                ? t('workingDirPicker.processing')
                : workingDir
                  ? displayFolderName(workingDir)
                  : t('workingDirPicker.select')}
            </span>
          </button>
          {workingDir ? (
            <button
              type="button"
              className="newproj-working-dir-clear"
              onClick={() => {
                setWorkingDir(null);
                setWorkingDirToken(null);
              }}
              aria-label={t('workingDirPicker.clearAria')}
            >
              <Icon name="close" size={14} />
            </button>
          ) : null}
        </div>

        <div
          className="newproj-media-segmented"
          role="tablist"
          aria-label={t('newproj.tabMedia')}
        >
          {(Object.keys(MEDIA_SURFACE_LABEL_KEYS) as MediaSurface[]).map((surface) => (
            <button
              key={surface}
              type="button"
              role="tab"
              data-testid={`new-project-media-surface-${surface}`}
              aria-selected={mediaSurface === surface}
              className={`newproj-media-surface ${mediaSurface === surface ? 'active' : ''}`}
              onClick={() => setMediaSurface(surface)}
            >
              {t(MEDIA_SURFACE_LABEL_KEYS[surface])}
            </button>
          ))}
        </div>

        {mediaSurface === 'image' ? (
          <PromptTemplatePicker
            surface="image"
            templates={promptTemplates}
            value={imagePromptTemplate}
            onChange={handleImagePromptTemplate}
          />
        ) : null}

        {mediaSurface === 'video' ? (
          <PromptTemplatePicker
            surface="video"
            templates={promptTemplates}
            value={videoPromptTemplate}
            onChange={handleVideoPromptTemplate}
          />
        ) : null}

        {mediaSurface === 'image' ? (
          <MediaProjectOptions
            surface="image"
            imageModel={imageModel}
            imageAspect={imageAspect}
            mediaProviders={mediaProviders}
            onImageModel={setImageModel}
            onImageAspect={setImageAspect}
          />
        ) : null}

        {mediaSurface === 'video' ? (
          <MediaProjectOptions
            surface="video"
            videoModel={videoModel}
            videoAspect={videoAspect}
            videoLength={videoLength}
            mediaProviders={mediaProviders}
            onVideoModel={handleVideoModel}
            onVideoAspect={setVideoAspect}
            onVideoLength={setVideoLength}
          />
        ) : null}

        {mediaSurface === 'audio' ? (
          <MediaProjectOptions
            surface="audio"
            audioKind={audioKind}
            audioModel={audioModel}
            audioDuration={audioDuration}
            voice={voice}
            mediaProviders={mediaProviders}
            onAudioKind={(kind) => {
              setAudioKind(kind);
              setAudioModel(DEFAULT_AUDIO_MODEL[kind]);
              if (kind === 'sfx') {
                setAudioDuration((duration) => Math.min(duration, SFX_AUDIO_DURATIONS_SEC.at(-1) ?? 30));
              }
            }}
            onAudioModel={setAudioModel}
            onAudioDuration={setAudioDuration}
            onVoice={setVoice}
          />
        ) : null}

        <button
          className="primary newproj-create"
          data-testid="create-project"
          onClick={handleCreate}
          disabled={!canCreate}
        >
          <Icon name="plus" size={14} />
          <span>
            {t('newproj.create')}
          </span>
        </button>
        {folderImport.available ? (
          <div className="newproj-open-folder">
            <button
              type="button"
              className="ghost newproj-import"
              disabled={folderImport.importing}
              onClick={() => void folderImport.openFolder()}
            >
              <Icon name="folder" size={14} />
              <span>
                {folderImport.importing
                  ? t('newproj.openingFolder')
                  : t('newproj.openFolder')}
              </span>
            </button>
          </div>
        ) : null}
      </div>
      <div className="newproj-footer">{t('newproj.privacyFooter')}</div>
      {folderImport.error ? (
        <Toast
          message={folderImport.error.message}
          details={folderImport.error.details ?? null}
          ttlMs={6000}
          onDismiss={folderImport.clearError}
        />
      ) : null}
      {workingDirError ? (
        <Toast
          message={workingDirError.message}
          details={workingDirError.details ?? null}
          ttlMs={6000}
          onDismiss={() => setWorkingDirError(null)}
        />
      ) : null}
    </div>
  );
}

function displayFolderName(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() ?? path;
}

function PromptTemplatePicker({
  surface,
  templates,
  value,
  onChange,
}: {
  surface: 'image' | 'video';
  templates: PromptTemplateSummary[];
  value: PromptTemplatePick | null;
  onChange: (next: PromptTemplatePick | null) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Last template we tried to pick that failed — kept so the inline
  // banner can offer a one-click retry without making the user re-find
  // the card in the popover (which auto-closed on success). Cleared as
  // soon as a pick succeeds or the user picks a different template.
  const [lastFailedPick, setLastFailedPick] =
    useState<PromptTemplateSummary | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const surfaceScoped = useMemo(
    () => templates.filter((tpl) => tpl.surface === surface),
    [templates, surface],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return surfaceScoped;
    return surfaceScoped.filter((tpl) => {
      return (
        tpl.title.toLowerCase().includes(q) ||
        tpl.summary.toLowerCase().includes(q) ||
        (tpl.category || '').toLowerCase().includes(q) ||
        (tpl.tags ?? []).some((tag) => tag.toLowerCase().includes(q))
      );
    });
  }, [surfaceScoped, query]);

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => searchRef.current?.focus(), 30);
    return () => window.clearTimeout(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent) {
      if (wrapRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    const id = window.setTimeout(() => {
      document.addEventListener('mousedown', onPointer);
      document.addEventListener('keydown', onKey);
    }, 0);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function pickTemplate(summary: PromptTemplateSummary) {
    setLoadingId(summary.id);
    setError(null);
    try {
      const detail = await fetchPromptTemplate(summary.surface, summary.id);
      if (!detail) {
        setError(t('promptTemplates.fetchError'));
        setLastFailedPick(summary);
        return;
      }
      onChange({ summary, prompt: detail.prompt });
      setLastFailedPick(null);
      setOpen(false);
      setQuery('');
    } catch {
      // fetchPromptTemplate already swallows errors and returns null in
      // the happy path; this catch is a defensive net for unexpected
      // throws so the inline banner still surfaces and the user can
      // retry instead of being stuck on a permanent loading spinner.
      setError(t('promptTemplates.fetchError'));
      setLastFailedPick(summary);
    } finally {
      setLoadingId(null);
    }
  }

  function clear() {
    onChange(null);
    setLastFailedPick(null);
    setError(null);
    setOpen(false);
    setQuery('');
  }

  const triggerTitle = value?.summary.title ?? t('newproj.promptTemplateNoneTitle');
  const triggerSub = value
    ? value.summary.category || value.summary.summary || t('newproj.promptTemplateRefSub')
    : t('newproj.promptTemplateNoneSub');

  return (
    <div className="newproj-section ds-picker prompt-template-picker" ref={wrapRef}>
      <label className="newproj-label">{t('newproj.promptTemplateLabel')}</label>
      <button
        type="button"
        data-testid="prompt-template-trigger"
        className={`ds-picker-trigger${open ? ' open' : ''}${value ? '' : ' empty'}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <PromptTemplateAvatar summary={value?.summary ?? null} />
        <span className="ds-picker-meta">
          <span className="ds-picker-title">{triggerTitle}</span>
          <span className="ds-picker-sub">{triggerSub}</span>
        </span>
        <Icon
          name="chevron-down"
          size={14}
          className="ds-picker-chevron"
          style={{ transform: open ? 'rotate(180deg)' : undefined }}
        />
      </button>
      {open ? (
        <div className="ds-picker-popover" role="listbox">
          <div className="ds-picker-head">
            <input
              ref={searchRef}
              data-testid="prompt-template-search"
              className="ds-picker-search"
              placeholder={t('newproj.promptTemplateSearch')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="ds-picker-list">
            <button
              type="button"
              role="option"
              aria-selected={value === null}
              className={`ds-picker-item${value === null ? ' active' : ''}`}
              onClick={clear}
            >
              <span className="ds-picker-item-avatar">
                <NoneAvatar />
              </span>
              <span className="ds-picker-item-text">
                <span className="ds-picker-item-title">
                  {t('newproj.promptTemplateNoneTitle')}
                </span>
                <span className="ds-picker-item-sub">
                  {t('newproj.promptTemplateNoneSub')}
                </span>
              </span>
            </button>
            {filtered.length === 0 ? (
              <div className="ds-picker-empty">
                {surfaceScoped.length === 0
                  ? t('newproj.promptTemplateEmpty')
                  : t('promptTemplates.emptyNoMatch')}
              </div>
            ) : (
              filtered.map((tpl) => {
                const active = value?.summary.id === tpl.id;
                return (
                  <button
                    key={tpl.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={`ds-picker-item${active ? ' active' : ''}`}
                    onClick={() => void pickTemplate(tpl)}
                    disabled={loadingId === tpl.id}
                  >
                    <span className="ds-picker-item-avatar">
                      <PromptTemplateAvatar summary={tpl} />
                    </span>
                    <span className="ds-picker-item-text">
                      <span className="ds-picker-item-title">
                        {tpl.title}
                        {loadingId === tpl.id ? (
                          <span className="ds-picker-item-badge">
                            {t('common.loading')}
                          </span>
                        ) : null}
                      </span>
                      <span className="ds-picker-item-sub">
                        {tpl.summary || tpl.category}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
      {error ? (
        <div
          className="prompt-template-error"
          role="alert"
          data-testid="prompt-template-error"
        >
          <span className="prompt-template-error-msg">{error}</span>
          {lastFailedPick ? (
            <button
              type="button"
              className="ghost prompt-template-error-retry"
              data-testid="prompt-template-retry"
              onClick={() => void pickTemplate(lastFailedPick)}
              disabled={loadingId === lastFailedPick.id}
            >
              {loadingId === lastFailedPick.id
                ? t('common.loading')
                : t('promptTemplates.retry')}
            </button>
          ) : null}
        </div>
      ) : null}
      {value ? (
        <div className="prompt-template-edit">
          <div className="prompt-template-edit-head">
            <span className="prompt-template-edit-label">
              {t('newproj.promptTemplateBodyLabel')}
            </span>
            <span className="prompt-template-edit-hint">
              {t('newproj.promptTemplateOptimizeHint')}
            </span>
          </div>
          <textarea
            data-testid="prompt-template-body"
            className="prompt-template-edit-textarea"
            value={value.prompt}
            rows={6}
            onChange={(e) =>
              onChange({ summary: value.summary, prompt: e.target.value })
            }
          />
          {value.prompt.trim().length === 0 ? (
            <div
              className="prompt-template-edit-empty"
              data-testid="prompt-template-empty-hint"
            >
              {t('newproj.promptTemplateBodyEmpty')}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PromptTemplateAvatar({
  summary,
}: {
  summary: PromptTemplateSummary | null;
}) {
  if (!summary) return <NoneAvatar />;
  if (summary.previewImageUrl) {
    return (
      <span className="ds-avatar prompt-template-avatar" aria-hidden>
        <img
          src={summary.previewImageUrl}
          alt=""
          loading="lazy"
          draggable={false}
        />
      </span>
    );
  }
  return (
    <span className="ds-avatar prompt-template-avatar fallback" aria-hidden>
      <Icon name={summary.surface === 'video' ? 'play' : 'image'} size={14} />
    </span>
  );
}

function NoneAvatar() {
  return (
    <span className="ds-avatar ds-avatar-none" aria-hidden>
      <svg viewBox="0 0 24 24" width="16" height="16">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <line x1="6" y1="18" x2="18" y2="6" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    </span>
  );
}

function MediaProjectOptions(props:
  | {
      surface: 'image';
      imageModel: string;
      imageAspect: MediaAspect;
      mediaProviders?: Record<string, MediaProviderCredentials>;
      onImageModel: (value: string) => void;
      onImageAspect: (value: MediaAspect) => void;
    }
  | {
      surface: 'video';
      videoModel: string;
      videoAspect: MediaAspect;
      videoLength: number;
      mediaProviders?: Record<string, MediaProviderCredentials>;
      onVideoModel: (value: string) => void;
      onVideoAspect: (value: MediaAspect) => void;
      onVideoLength: (value: number) => void;
    }
  | {
      surface: 'audio';
      audioKind: AudioKind;
      audioModel: string;
      audioDuration: number;
      voice: string;
      mediaProviders?: Record<string, MediaProviderCredentials>;
      onAudioKind: (value: AudioKind) => void;
      onAudioModel: (value: string) => void;
      onAudioDuration: (value: number) => void;
      onVoice: (value: string) => void;
    }
) {
  const t = useT();
  const aihubmixImageModels = useAIHubMixImageModels();
  const aihubmixVideoModels = useAIHubMixVideoModels();
  const aihubmixAudioModels = useAIHubMixAudioModels();

  if (props.surface === 'image') {
    return (
      <div className="newproj-media-options">
        <MediaModelCards
          label={t('newproj.modelLabel')}
          models={supportedModels('image', mergeAihubmixModels(IMAGE_MODELS, aihubmixImageModels))}
          mediaProviders={props.mediaProviders}
          value={props.imageModel}
          onChange={props.onImageModel}
        />
        <AspectCards
          label={t('newproj.aspectLabel')}
          value={props.imageAspect}
          onChange={props.onImageAspect}
        />
      </div>
    );
  }

  if (props.surface === 'video') {
    return (
      <div className="newproj-media-options">
        <MediaModelCards
          label={t('newproj.modelLabel')}
          models={supportedModels('video', mergeAihubmixModels(VIDEO_MODELS, aihubmixVideoModels))}
          mediaProviders={props.mediaProviders}
          value={props.videoModel}
          onChange={props.onVideoModel}
        />
        <AspectCards
          label={t('newproj.aspectLabel')}
          value={props.videoAspect}
          onChange={props.onVideoAspect}
        />
        <label className="newproj-label">
          <span>{t('newproj.videoLengthLabel')}</span>
          <select value={props.videoLength} onChange={(e) => props.onVideoLength(Number(e.target.value))}>
            {VIDEO_LENGTHS_SEC.map((sec) => (
              <option key={sec} value={sec}>{t('newproj.videoLengthSeconds', { n: sec })}</option>
            ))}
          </select>
        </label>
      </div>
    );
  }

  // AIHubMix's live catalogue is speech (TTS) only; music/sfx stay static.
  const audioBase =
    props.audioKind === 'speech'
      ? mergeAihubmixModels(AUDIO_MODELS_BY_KIND.speech, aihubmixAudioModels)
      : AUDIO_MODELS_BY_KIND[props.audioKind];
  const models = supportedModels('audio', audioBase);
  const audioDurations = props.audioKind === 'sfx'
    ? SFX_AUDIO_DURATIONS_SEC
    : AUDIO_DURATIONS_SEC;
  return (
    <div className="newproj-media-options">
      <OptionCards
        label={t('newproj.audioKindLabel')}
        options={[
          { value: 'speech' as const, title: t('newproj.audioKindSpeech') },
          { value: 'sfx' as const, title: t('newproj.audioKindSfx') },
        ]}
        value={props.audioKind}
        onChange={props.onAudioKind}
      />
      <MediaModelCards
        label={t('newproj.modelLabel')}
        models={models}
        mediaProviders={props.mediaProviders}
        value={props.audioModel}
        onChange={props.onAudioModel}
      />
      <label className="newproj-label">
        <span>{t('newproj.audioDurationLabel')}</span>
        <select value={props.audioDuration} onChange={(e) => props.onAudioDuration(Number(e.target.value))}>
          {audioDurations.map((sec) => (
            <option key={sec} value={sec}>{t('newproj.audioDurationSeconds', { n: sec })}</option>
          ))}
        </select>
      </label>
      {props.audioKind === 'speech' ? (
        <label className="newproj-label">
          <span>{t('newproj.voiceLabel')}</span>
          <input
            value={props.voice}
            placeholder={t('newproj.voicePlaceholder')}
            onChange={(e) => props.onVoice(e.target.value)}
          />
        </label>
      ) : null}
    </div>
  );
}

export function supportedModels(surface: 'image' | 'video' | 'audio', models: MediaModel[]): MediaModel[] {
  const supportedProviders: Record<'image' | 'video' | 'audio', Set<string>> = {
    image: new Set(['openai', 'volcengine', 'grok', 'nanobanana', 'openrouter', 'imagerouter', 'leonardo', 'custom-image', 'aihubmix', 'minimax']),
    video: new Set(['volcengine', 'hyperframes', 'grok', 'openrouter', 'imagerouter', 'aihubmix']),
    audio: new Set(['minimax', 'fishaudio', 'senseaudio', 'elevenlabs', 'openai', 'volcengine', 'aihubmix']),
  };
  return models.filter((model) => {
    const provider = findProvider(model.provider);
    return provider?.integrated === true && supportedProviders[surface].has(model.provider);
  });
}

function MediaModelCards({
  label,
  models,
  mediaProviders,
  value,
  onChange,
}: {
  label: string;
  models: MediaModel[];
  mediaProviders?: Record<string, MediaProviderCredentials>;
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  // Group models by provider once. The trigger row needs the same provider
  // metadata (label + status) to render the selected model's caption, so we
  // compute groups regardless of whether the popover is open.
  const groups = useMemo(() => {
    const out: Array<{
      providerId: string;
      providerLabel: string;
      status: 'configured' | 'integrated' | 'unsupported';
      sortIndex: number;
      sortPriority: number;
      models: MediaModel[];
    }> = [];
    for (const model of models) {
      const provider = findProvider(model.provider);
      const providerId = provider?.id ?? model.provider;
      if (!isMediaProviderPickerReady(providerId, mediaProviders)) continue;
      const entry = mediaProviders?.[providerId];
      const configured = provider?.credentialsRequired !== false && isStoredMediaProviderEntryPresent(entry);
      let group = out.find((g) => g.providerId === providerId);
      if (!group) {
        group = {
          providerId,
          providerLabel: provider?.label ?? model.provider,
          status: configured
            ? 'configured'
            : provider?.integrated
              ? 'integrated'
              : 'unsupported',
          sortIndex: out.length,
          sortPriority: configured ? 0 : provider?.credentialsRequired === false ? 1 : 2,
          models: [],
        };
        out.push(group);
      }
      group.models.push(model);
    }
    return out.sort((a, b) => a.sortPriority - b.sortPriority || a.sortIndex - b.sortIndex);
  }, [models, mediaProviders]);

  const selected = useMemo(() => {
    for (const group of groups) {
      const hit = group.models.find((m) => m.id === value);
      if (hit) return { model: hit, group };
    }
    return null;
  }, [groups, value]);
  const firstAvailableModelId = groups[0]?.models[0]?.id ?? null;

  useEffect(() => {
    if (selected) return;
    if (firstAvailableModelId) {
      onChange(firstAvailableModelId);
      return;
    }
    if (value) onChange('');
  }, [firstAvailableModelId, onChange, selected, value]);

  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((g) => ({
        ...g,
        models: g.models.filter((m) => {
          return (
            m.id.toLowerCase().includes(q) ||
            m.label.toLowerCase().includes(q) ||
            m.hint.toLowerCase().includes(q) ||
            g.providerLabel.toLowerCase().includes(q)
          );
        }),
      }))
      .filter((g) => g.models.length > 0);
  }, [groups, query]);

  const totalMatches = filteredGroups.reduce((n, g) => n + g.models.length, 0);

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => searchRef.current?.focus(), 30);
    return () => window.clearTimeout(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent) {
      if (wrapRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    const id = window.setTimeout(() => {
      document.addEventListener('mousedown', onPointer);
      document.addEventListener('keydown', onKey);
    }, 0);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function pick(modelId: string) {
    onChange(modelId);
    setOpen(false);
    setQuery('');
  }

  const triggerTitle = selected?.model.label ?? t('newproj.modelMissingTitle');
  // The model.hint frequently leads with the provider name (e.g.
  // "OpenAI · 4K, native multimodal"), so emitting providerLabel as a
  // separate prefix would duplicate it. If the hint already opens with the
  // provider label, just use the hint verbatim — otherwise prefix it.
  const triggerSub = selected
    ? selected.model.hint.toLowerCase().startsWith(selected.group.providerLabel.toLowerCase())
      ? selected.model.hint
      : `${selected.group.providerLabel} · ${selected.model.hint}`
    : t('newproj.modelMissingSub');

  return (
    <div className="newproj-section ds-picker model-picker" ref={wrapRef}>
      <label className="newproj-label">{label}</label>
      <button
        type="button"
        data-testid="model-picker-trigger"
        className={`ds-picker-trigger${open ? ' open' : ''}${selected ? '' : ' empty'}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="ds-picker-meta">
          <span className="ds-picker-title">{triggerTitle}</span>
          <span className="ds-picker-sub">{triggerSub}</span>
        </span>
        <Icon
          name="chevron-down"
          size={14}
          className="ds-picker-chevron"
          style={{ transform: open ? 'rotate(180deg)' : undefined }}
        />
      </button>
      {open ? (
        <div className="ds-picker-popover" role="listbox">
          <div className="ds-picker-head">
            <input
              ref={searchRef}
              data-testid="model-picker-search"
              className="ds-picker-search"
              placeholder={t('newproj.modelSearch')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="ds-picker-list">
            {totalMatches === 0 ? (
              <div className="ds-picker-empty">{t('newproj.modelEmpty')}</div>
            ) : (
              filteredGroups.map((group) => (
                <div className="ds-picker-group" key={group.providerId}>
                  <div className="ds-picker-group-head">
                    <span>{group.providerLabel}</span>
                    <span className={`newproj-provider-badge ${group.status}`}>
                      {t(group.status === 'configured'
                        ? 'newproj.providerStatus.configured'
                        : group.status === 'integrated'
                          ? 'newproj.providerStatus.integrated'
                          : 'newproj.providerStatus.unsupported')}
                    </span>
                  </div>
                  {group.models.map((model) => {
                    const active = value === model.id;
                    return (
                      <button
                        key={model.id}
                        type="button"
                        role="option"
                        aria-selected={active}
                        data-testid={`model-picker-option-${model.id}`}
                        className={`ds-picker-item${active ? ' active' : ''}`}
                        onClick={() => pick(model.id)}
                      >
                        <span className="ds-picker-item-text">
                          <span className="ds-picker-item-title">
                            {model.label}
                            {model.default ? (
                              <span className="ds-picker-item-badge">
                                {t('newproj.modelRecommended')}
                              </span>
                            ) : null}
                          </span>
                          <span className="ds-picker-item-sub">{model.hint}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AspectCards({
  label,
  value,
  onChange,
}: {
  label: string;
  value: MediaAspect;
  onChange: (value: MediaAspect) => void;
}) {
  const t = useT();
  const labels: Record<MediaAspect, string> = {
    '1:1': t('newproj.aspect.square'),
    '16:9': t('newproj.aspect.landscape'),
    '9:16': t('newproj.aspect.portrait'),
    '4:3': t('newproj.aspect.wide'),
    '3:4': t('newproj.aspect.tall'),
  };
  return (
    <div className="newproj-media-field">
      <div className="newproj-label">{label}</div>
      <div className="newproj-aspect-segmented" role="radiogroup" aria-label={label}>
        {MEDIA_ASPECTS.map((aspect) => {
          const active = value === aspect;
          return (
            <button
              key={aspect}
              type="button"
              role="radio"
              aria-checked={active}
              title={`${labels[aspect]} · ${aspect}`}
              className={`newproj-aspect-pill${active ? ' active' : ''}`}
              onClick={() => onChange(aspect)}
            >
              <span
                className={`newproj-aspect-icon newproj-aspect-icon-${aspect.replace(':', '-')}`}
                aria-hidden
              />
              <span className="newproj-aspect-ratio">{aspect}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function OptionCards<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ value: T; title: string; hint?: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="newproj-media-field">
      <div className="newproj-label">{label}</div>
      <div className="newproj-option-grid compact">
        {options.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            className={`newproj-card newproj-option-card${value === option.value ? ' active' : ''}`}
            onClick={() => onChange(option.value)}
            aria-pressed={value === option.value}
          >
            <span>{option.title}</span>
            {option.hint ? <small>{option.hint}</small> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

function buildMetadata(input: {
  mediaSurface: MediaSurface;
  imageModel: string; imageAspect: MediaAspect;
  videoModel: string; videoAspect: MediaAspect; videoLength: number;
  audioKind: AudioKind; audioModel: string; audioDuration: number; voice: string;
  promptTemplate: PromptTemplatePick | null;
}): ProjectMetadata {
  if (input.mediaSurface === 'image') {
    const imageModel = input.imageModel.trim();
    return { kind: 'image', ...(imageModel ? { imageModel } : {}), imageAspect: input.imageAspect,
      ...buildPromptTemplateMetadata(input.promptTemplate) };
  }
  if (input.mediaSurface === 'video') {
    const videoModel = input.videoModel.trim();
    return { kind: 'video', ...(videoModel ? { videoModel } : {}), videoAspect: input.videoAspect,
      videoLength: input.videoLength, ...buildPromptTemplateMetadata(input.promptTemplate) };
  }
  const audioModel = input.audioModel.trim();
  return { kind: 'audio', audioKind: input.audioKind, ...(audioModel ? { audioModel } : {}),
    audioDuration: input.audioDuration,
    ...(input.audioKind === 'speech' && input.voice.trim() ? { voice: input.voice.trim() } : {}) };
}

function buildPromptTemplateMetadata(
  pick: PromptTemplatePick | null,
): { promptTemplate?: ProjectMetadata['promptTemplate'] } {
  if (!pick) return {};
  const trimmed = pick.prompt.trim();
  if (trimmed.length === 0) return {};
  const { summary } = pick;
  return {
    promptTemplate: {
      id: summary.id,
      surface: summary.surface,
      title: summary.title,
      prompt: trimmed,
      summary: summary.summary || undefined,
      category: summary.category || undefined,
      tags: summary.tags && summary.tags.length > 0 ? summary.tags : undefined,
      model: summary.model,
      aspect: summary.aspect,
      source: summary.source
        ? {
            repo: summary.source.repo,
            license: summary.source.license,
            author: summary.source.author,
            url: summary.source.url,
          }
        : undefined,
    },
  };
}

function titleForSurface(surface: MediaSurface, t: TranslateFn): string {
  return t(surface === 'image' ? 'newproj.titleImage' : surface === 'video' ? 'newproj.titleVideo' : 'newproj.titleAudio');
}

function autoName(surface: MediaSurface, t: TranslateFn): string {
  return `${t(MEDIA_SURFACE_LABEL_KEYS[surface])} · ${new Date().toLocaleDateString()}`;
}
