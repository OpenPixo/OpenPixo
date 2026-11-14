import { useCallback, useEffect, useMemo, useState } from 'react';
import { Dialog, DialogBody, DialogHeader, DialogTitle, SegmentedTabs } from '@openpixo/components';
import type { ProjectFile, RecipeRun, RecipeSummary } from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import { ProjectStyleGallery } from '../studio/ProjectStyleGallery';
import { formatCredits } from '../account/account-format';
import { studioMedia, studioRecipes, studioServices, useCacheEntry } from '../studio/studio-cache';
import { useArtStyles } from '../studio/useArtStyles';
import { useStudioPrefetch } from '../studio/useStudioPrefetch';
import { useStudioProject } from '../studio/useStudioProject';
import { GenerateBox } from './GenerateBox';
import { GenerateHistory, RecentRuns, runTitle } from './GenerateHistory';
import { initialGenerateForm, presetServiceId, withKind, withPreset, withStyle, type GenerateForm } from './generate-request';
import { generatePresets, PresetCards, type PresetSample } from './PresetCards';
import { PresetDrawer } from './PresetDrawer';
import type { UploadedReference } from './ReferenceUpload';
import { ResultDetail, type GenerateGame } from './ResultDetail';
import { StyleCards, StyleWall } from './Showcase';
import { useRunHistory } from './useRunHistory';
import styles from './GenerateView.module.css';
import theme from './studio-theme.module.css';

const NO_STYLE_KEY = 'pixo:generate:style';
function readNoGameStyle(): string | undefined {
  try { return window.localStorage.getItem(NO_STYLE_KEY) ?? undefined; } catch { return undefined; }
}
function writeNoGameStyle(styleId: string | null | undefined) {
  try { if (styleId) window.localStorage.setItem(NO_STYLE_KEY, styleId); else window.localStorage.removeItem(NO_STYLE_KEY); } catch { /* a convenience only */ }
}

/** The studio's dialogs render outside the page, so each carries the studio's dark theme itself. */
const STUDIO_DIALOG = { className: `${theme.studio} ${styles.dialog}`, 'data-theme': 'dark' } as const;

/** The page's two parts: 创作, the box with everything it can make, and 我的作品, what was made. */
export type GenerateSection = 'create' | 'library';

/**
 * 生成 (specs/current/asset-generator.md §6): the one generator, for a game or for none.
 *
 * 创作 is a home: a headline over a wall of games in every style, the prompt box, the
 * newest results, then the presets and styles as pictures. A card goes into the box (a
 * preset becomes a tag its example's words fill, a style becomes the box's style), so the
 * box stays the one place a request is made. 我的作品 holds every
 * result. A result, a preset's full form and the game's style open in dialogs. The
 * box stays mounted on 我的作品 so a request in flight still lands.
 */
export function GenerateView({
  projectId, files, games, viewerOnly, initialRecipeId, referencePaths, referenceRequest, section, onSection,
  onOpenFile, onFilesChanged, onOpenExtensions, onOpenAccount,
}: {
  /** The game picked at the top of the page, or null for art made for no game. */
  projectId: string | null;
  /** The picked game's files, for references; empty with no game. */
  files: ProjectFile[];
  /** Every game, to name a run's game and to save a no-game result into one. */
  games: readonly GenerateGame[];
  viewerOnly?: boolean;
  /** A preset handed over by an entry point, opened once. */
  initialRecipeId?: string | null;
  /** Pictures handed over by "generate from" on a game's asset. */
  referencePaths: string[];
  /** Changes each time "generate from" hands pictures over, so the same ones twice still apply. */
  referenceRequest: number;
  onOpenFile: (projectId: string, path: string) => void;
  /** A result was saved into this game. */
  onFilesChanged: (projectId: string) => Promise<void> | void;
  onOpenExtensions: () => void;
  onOpenAccount?: (() => void) | undefined;
  section: GenerateSection;
  onSection: (section: GenerateSection) => void;
}) {
  const { t, locale } = useI18n();
  useStudioPrefetch(projectId);
  const recipesEntry = studioRecipes();
  const { value: recipes } = useCacheEntry(recipesEntry);
  useEffect(() => { void recipesEntry.refresh(); }, [recipesEntry]);
  const game = useStudioProject(projectId ?? '', files, Boolean(projectId));
  const history = useRunHistory(projectId, true);
  const [form, setForm] = useState<GenerateForm>(() => ({ ...initialGenerateForm('image', referencePaths), ...(projectId ? {} : { styleId: readNoGameStyle() }) }));
  const [uploads, setUploads] = useState<UploadedReference[]>([]);
  const [detail, setDetail] = useState<{ runId: string; candidateId: string } | null>(null);
  const [preset, setPreset] = useState<string | null>(initialRecipeId ?? null);
  const [gameStyleOpen, setGameStyleOpen] = useState(false);
  const [again, setAgain] = useState(0);
  const [focus, setFocus] = useState(0);

  // A game's references are its files; switching game drops the last game's picks.
  useEffect(() => {
    setForm(previous => ({ ...previous, references: [], styleId: projectId ? undefined : readNoGameStyle() }));
    setDetail(null);
    setGameStyleOpen(false);
  }, [projectId]);
  useEffect(() => { if (!projectId) writeNoGameStyle(form.styleId); }, [projectId, form.styleId]);
  // "Generate from" on an asset puts its pictures in the box, as references (or the 3D picture).
  useEffect(() => {
    if (!referenceRequest || !referencePaths.length) return;
    setDetail(null);
    setForm(previous => ({ ...withKind(previous, previous.kind === 'model3d' ? 'model3d' : 'image'),
      references: referencePaths.slice(0, previous.kind === 'model3d' ? 1 : 3) }));
    onSection('create');
  }, [referenceRequest, referencePaths]);
  useEffect(() => { if (initialRecipeId) { setPreset(initialRecipeId); onSection('create'); } }, [initialRecipeId]);

  // A run started here, or saved from its detail, shows at once; the next read confirms it.
  const { add } = history;
  const remember = useCallback((next: RecipeRun) => add(next), [add]);
  const addUpload = useCallback((upload: UploadedReference) => setUploads(previous => previous.some(entry => entry.ref === upload.ref) ? previous : [...previous, upload]), []);
  const runs = history.runs;
  // A dialog keeps showing what it showed while it fades out, and lets go once it has closed.
  const [shownDetail, setShownDetail] = useState(detail);
  const [shownPreset, setShownPreset] = useState(preset);
  useEffect(() => { if (detail) setShownDetail(detail); }, [detail]);
  useEffect(() => { if (preset) setShownPreset(preset); }, [preset]);
  const visibleDetail = detail ?? shownDetail;
  const visiblePreset = preset ?? shownPreset;
  const run = visibleDetail ? runs?.find(entry => entry.id === visibleDetail.runId) : undefined;
  const candidate = run?.candidates.find(entry => entry.id === visibleDetail?.candidateId);
  const closeDetail = useCallback(() => setDetail(null), []);
  const closePreset = useCallback(() => setPreset(null), []);
  const presets = useMemo(() => generatePresets(recipes ?? [], projectId ? { engine: game.profile?.engine } : null), [recipes, projectId, game.profile?.engine]);
  const gameNames = useMemo(() => Object.fromEntries(games.map(entry => [entry.id, entry.name])), [games]);
  const savedInto = useCallback(async (saved: RecipeRun, target: string) => { remember(saved); await onFilesChanged(target); }, [remember, onFilesChanged]);
  const openResult = useCallback((runId: string, candidateId: string) => setDetail({ runId, candidateId }), []);
  const toCreate = useCallback(() => { onSection('create'); setFocus(value => value + 1); }, [onSection]);
  // A preset goes into the box as a tag; one that needs a character opens its own form.
  const pickPreset = useCallback((recipe: RecipeSummary, sample?: PresetSample) => {
    if (recipe.needsGame) { setPreset(recipe.id); return; }
    setForm(previous => withPreset(previous, recipe, sample));
    toCreate();
  }, [toCreate]);
  const artStyles = useArtStyles(projectId);
  const pickStyle = useCallback((styleId: string) => { setForm(previous => withStyle(previous, styleId)); toCreate(); }, [toCreate]);
  // What one costs, on every card: free when the user's own tools make it, else the cloud's price.
  const { value: media } = useCacheEntry(studioMedia());
  const { value: catalog } = useCacheEntry(studioServices());
  const priceFor = useCallback((capabilities: readonly string[], serviceId: string | null): string | null => {
    if (media && capabilities.length && capabilities.every(capability => media.capabilities?.[capability]?.configured)) return t('generate.priceFree');
    const credits = serviceId ? catalog?.services.find(service => service.id === serviceId)?.credits : undefined;
    return credits === undefined ? null : t('generate.priceFrom', { count: formatCredits(credits, locale) });
  }, [media, catalog, t, locale]);
  const presetPrice = useCallback((recipe: RecipeSummary) => priceFor(recipe.requires, presetServiceId(recipe.requires)), [priceFor]);
  const [presetKind, setPresetKind] = useState<'all' | 'image' | 'audio'>('all');
  const imagePresets = presets.filter(recipe => recipe.surface === 'image');
  const audioPresets = presets.filter(recipe => recipe.surface === 'audio');

  return <div className={styles.view} data-testid="generate-view" data-section={section}>
    <div className={styles.scroll} hidden={section !== 'create'} data-testid="generate-create">
      <div className={styles.hero}>
        <StyleWall items={artStyles.styles} />
        <p className={styles.kicker}>{t('generate.heroKicker')}</p>
        <h2 className={styles.heroTitle}>{t('generate.heroTitleLead')}<span className={styles.heroAccent}>{t('generate.heroTitleAccent')}</span></h2>
        <p className={styles.heroLead}>{t('generate.pageLead')}</p>
      </div>
      <div className={styles.heroBox}>
        <GenerateBox projectId={projectId} files={files} uploads={uploads} onUploaded={addUpload} form={form} onFormChange={setForm} readOnly={viewerOnly}
          againRequest={again} focusRequest={focus} onStarted={remember} onOpenAccount={onOpenAccount}
          presets={presets} onPickPreset={pickPreset} onOpenPreset={setPreset} onOpenGameStyle={projectId ? () => setGameStyleOpen(true) : undefined}
          artStyles={artStyles} />
      </div>
      <div className={styles.home}>
        <RecentRuns runs={runs} recipes={recipes} onOpen={openResult} onAll={() => onSection('library')} />
        {presets.length > 0 && <section className={styles.homeSection} aria-labelledby="generate-presets-title">
          <header className={styles.sectionHeader}>
            <h3 id="generate-presets-title" className={styles.sectionTitle}>{t('generate.presetsTitle')}</h3>
            {imagePresets.length > 0 && audioPresets.length > 0 && <SegmentedTabs className={styles.presetFilter} label={t('generate.presetsTitle')} value={presetKind}
              onValueChange={value => setPresetKind(value as 'all' | 'image' | 'audio')}
              items={[{ value: 'all', label: t('generate.all') }, { value: 'image', label: t('studio.cloud.makeImage') }, { value: 'audio', label: t('generate.audio') }]} />}
          </header>
          <PresetCards recipes={presetKind === 'image' ? imagePresets : presetKind === 'audio' ? audioPresets : presets} activeId={form.preset?.id ?? null}
            onPick={pickPreset} priceOf={presetPrice} />
        </section>}
        {artStyles.styles.length > 0 && <section className={styles.homeSection} aria-labelledby="generate-styles-title">
          <header className={styles.sectionHeader}>
            <h3 id="generate-styles-title" className={styles.sectionTitle}>{t('generate.stylesTitle')}</h3>
          </header>
          <StyleCards items={artStyles.styles} activeId={form.kind === 'image' ? form.styleId : null} onPick={style => pickStyle(style.id)} />
        </section>}
      </div>
    </div>
    <div className={styles.scroll} hidden={section !== 'library'} data-testid="generate-library">
      <div className={styles.body}>
        <GenerateHistory runs={runs} failed={history.failed} recipes={recipes} gameNames={projectId ? undefined : gameNames}
          onRetry={() => void history.refresh()} onOpen={openResult} onCreate={toCreate} />
      </div>
    </div>

    <Dialog open={Boolean(detail && run && candidate)} onClose={closeDetail} onAfterClose={() => setShownDetail(null)} size="lg" ariaLabelledBy="generate-detail-title" {...STUDIO_DIALOG}>
      {run && candidate && <ResultDetail run={run} candidate={candidate} title={runTitle(run, recipes, locale)} readOnly={viewerOnly}
        games={games} defaultGameId={projectId}
        onBack={closeDetail} onSaved={savedInto} onOpenFile={onOpenFile}
        onAgain={next => { setForm(next); setDetail(null); onSection('create'); setAgain(value => value + 1); }}
        onEdit={next => { setForm(next); setDetail(null); toCreate(); }}
        onPickCandidate={candidateId => setDetail({ runId: run.id, candidateId })} />}
    </Dialog>
    <Dialog open={preset !== null} onClose={closePreset} onAfterClose={() => setShownPreset(null)} size="lg" ariaLabelledBy="generate-preset-title" {...STUDIO_DIALOG}>
      {visiblePreset && <PresetDrawer recipeId={visiblePreset} projectId={projectId} files={files} uploads={uploads} onUploaded={addUpload} viewerOnly={viewerOnly}
        onClose={closePreset} onStarted={next => { remember(next); setPreset(null); onSection('library'); }}
        onAdopted={async () => { if (projectId) await onFilesChanged(projectId); }}
        onOpenFile={path => { if (projectId) onOpenFile(projectId, path); }} onOpenExtensions={onOpenExtensions} />}
    </Dialog>
    {projectId && <Dialog open={gameStyleOpen} onClose={() => setGameStyleOpen(false)} size="lg" ariaLabelledBy="generate-game-style-title" {...STUDIO_DIALOG}>
      <DialogHeader><DialogTitle id="generate-game-style-title">{t('studio.panel.styleSummary')}</DialogTitle></DialogHeader>
      <DialogBody>
        <ProjectStyleGallery key={projectId} projectId={projectId} viewerOnly={viewerOnly} embedded
          dimension={game.dimension} assets={game.assets} projectLoading={game.loading} />
      </DialogBody>
    </Dialog>}
  </div>;
}
