import { useEffect, useRef, useState } from 'react';
import { Button, Card, VisuallyHidden } from '@openpixo/components';
import type { CharacterCard, ProjectFile } from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import { Icon } from '../Icon';
import { useProjectPreviewContext } from "../project-preview-context";
import { openMediaSettings } from '../../settings-navigation';
import { CharacterEditor } from './CharacterEditor';
import { HostedImageCard } from './HostedImageCard';
import { RecipeRunner } from './RecipeRunner';
import { ProjectStyleGallery } from './ProjectStyleGallery';
import { StudioDisclosure } from './StudioDisclosure';
import { revealInPanel } from './reveal-in-panel';
import { studioCopy } from './copy';
import { localizedRecipeCopy } from './localization';
import { hasAvailableMediaProvider, missingRecipeCapabilities } from './media-capabilities';
import { ProjectRecipeCatalog } from './ProjectRecipeCatalog';
import { recipeMatchesEngine } from './project-catalog';
import { studioCharacters, studioMedia, studioRecipeDetail, studioRecipes, useCacheEntry, useDelayedFlag } from './studio-cache';
import { useStudioProject } from './useStudioProject';
import styles from './StudioPanel.module.css';

const NO_REFERENCES: string[] = [];
const NO_CHARACTERS: CharacterCard[] = [];

interface Props {
  projectId: string; files: ProjectFile[]; viewerOnly?: boolean; initialRecipeId?: string | null; referencePaths?: string[];
  /** The sheet is showing. It stays mounted once opened, so this is what "opening it" looks like from here. */
  open?: boolean;
  onOpenFile: (path: string) => void; onRefreshFiles: () => Promise<void>; onOpenExtensions: () => void;
  onOpenAccount?: () => void;
}

export function StudioPanel({ projectId, files, viewerOnly, open = true, initialRecipeId, referencePaths = NO_REFERENCES,
  onOpenFile, onRefreshFiles, onOpenExtensions, onOpenAccount }: Props) {
  const { locale, t } = useI18n();
  const copy = studioCopy(locale);
  const { projectResourceAuthority } = useProjectPreviewContext();
  const readable = projectResourceAuthority !== 'pending' && projectResourceAuthority !== 'denied';
  const recipesEntry = studioRecipes();
  const mediaEntry = studioMedia();
  const charactersEntry = studioCharacters(projectId);
  const recipesState = useCacheEntry(recipesEntry);
  const mediaState = useCacheEntry(mediaEntry);
  const charactersState = useCacheEntry(charactersEntry);
  // The last recipe opened stays mounted behind the list, so going back to look
  // at another one doesn't lose a run in progress, its results or a filled form.
  const [recipeId, setRecipeId] = useState<string | null>(initialRecipeId ?? null);
  const [showDetail, setShowDetail] = useState(Boolean(initialRecipeId));
  const detailEntry = recipeId ? studioRecipeDetail(recipeId) : null;
  const detailState = useCacheEntry(detailEntry);
  const [editing, setEditing] = useState<CharacterCard | 'new' | null>(null);
  const [unavailable, setUnavailable] = useState<Record<string, string>>({});
  const [stylesOpen, setStylesOpen] = useState(false);
  const [styleTitle, setStyleTitle] = useState<string | null | undefined>(undefined);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const returnToRow = useRef<string | null>(null);
  const project = useStudioProject(projectId, files, readable);

  useEffect(() => {
    if (!readable || !open) return;
    const refreshMedia = () => { void mediaEntry.refresh(); };
    void recipesEntry.refresh();
    void charactersEntry.refresh();
    refreshMedia();
    window.addEventListener('focus', refreshMedia);
    return () => window.removeEventListener('focus', refreshMedia);
  }, [readable, open, recipesEntry, mediaEntry, charactersEntry]);
  useEffect(() => {
    if (readable && detailEntry && !detailEntry.get().value) void detailEntry.refresh();
  }, [readable, detailEntry]);
  // "No model can run this" was true of the providers at the time; a fresh answer earns a fresh try.
  useEffect(() => { setUnavailable(previous => Object.keys(previous).length ? {} : previous); }, [mediaState.value]);
  useEffect(() => {
    if (showDetail) {
      headingRef.current?.focus({ preventScroll: true });
      revealInPanel(headingRef.current);
      return;
    }
    const id = returnToRow.current;
    if (!id) return;
    returnToRow.current = null;
    const row = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-recipe-id]') ?? [])].find(node => node.dataset.recipeId === id);
    row?.focus({ preventScroll: true });
    revealInPanel(row ?? null);
  }, [showDetail, recipeId]);

  function retry() {
    void recipesEntry.refresh({ force: true });
    void mediaEntry.refresh({ force: true });
    void charactersEntry.refresh({ force: true });
    if (detailEntry) void detailEntry.refresh({ force: true });
    project.retry();
  }
  function selectRecipe(id: string) {
    setRecipeId(id);
    setShowDetail(true);
  }
  function backToRecipes() {
    returnToRow.current = recipeId;
    setShowDetail(false);
  }
  function browseStyles() {
    setStylesOpen(true);
    requestAnimationFrame(() => revealInPanel(document.getElementById('studio-art-styles-group')));
  }

  const readOnly = viewerOnly || !readable;
  // Null until the daemon has actually answered: a recipe's hint and the banners wait for that.
  const media = readable ? mediaState.value : null;
  const recipes = recipesState.value;
  const characters = charactersState.value ?? NO_CHARACTERS;
  const detail = detailState.value;
  const readFailed = (recipesState.failed && !recipes) || (charactersState.failed && !charactersState.value);
  const catalogReady = readable && recipes !== null && project.known;
  const catalogSlow = useDelayedFlag(readable && !catalogReady && !recipesState.failed);
  const detailSlow = useDelayedFlag(readable && Boolean(recipeId) && !detail && !detailState.failed);
  const summary = recipes?.find(recipe => recipe.id === recipeId);
  const heading = detail ? localizedRecipeCopy({ ...detail, title_i18n: detail.manifest.title_i18n, description_i18n: detail.manifest.description_i18n }, locale)
    : summary ? localizedRecipeCopy(summary, locale) : null;

  return <div className={styles.root} data-testid="studio-panel">
    {readOnly && <p className={styles.muted}>{copy.readOnly}</p>}
    {readable && <HostedImageCard projectId={projectId} files={files} readOnly={readOnly} onSaved={onRefreshFiles} onOpenFile={onOpenFile} onOpenAccount={onOpenAccount} />}
    <section className={styles.section} aria-labelledby="studio-recipes-title">
      {readable && !media && mediaState.failed && <Card className={styles.providerBanner} role="alert">
        <span>{copy.providerCheckError}</span>
        <Button size="sm" variant="secondary" onClick={retry}>{copy.retry}</Button>
      </Card>}
      <div hidden={showDetail} ref={listRef}>
        <h3 id="studio-recipes-title" className={styles.sectionTitle}>{t('studio.sections.recipes')}</h3>
        {media && !hasAvailableMediaProvider(media) && <Card className={styles.providerBanner} role="status">
          <span>{copy.providerBanner}</span>
          <Button size="sm" variant="secondary" onClick={openMediaSettings}>{copy.setupProviders}</Button>
        </Card>}
        {referencePaths.length > 0 && !showDetail && <p className={styles.notice} role="status">
          {t('studio.panel.referencesReady', { names: referencePaths.map(path => path.split('/').pop() || path).join(', ') })}</p>}
        {readFailed && <div className={styles.readFailed} role="alert"><p className={styles.error}>{copy.error}</p>
          <Button size="sm" variant="secondary" onClick={retry}>{copy.retry}</Button></div>}
        {catalogReady ? <ProjectRecipeCatalog key={projectId} recipes={recipes} engine={project.profile?.engine}
          engineFailed={project.engineFailed} media={media} unavailable={unavailable} onSelect={selectRecipe} onRetryEngine={project.retry} />
          : catalogSlow && <p role="status" className={styles.muted}>{copy.loading}</p>}
      </div>
      {recipeId && <section hidden={!showDetail} className={styles.detail} aria-label={heading?.title ?? t('studio.sections.recipes')}>
        <Button size="sm" variant="ghost" className={styles.backButton} aria-label={t('studio.backToRecipes')} onClick={backToRecipes}>
          <Icon name="arrow-left" size={14} />{t('studio.sections.recipes')}
        </Button>
        <h3 ref={headingRef} tabIndex={-1} className={styles.detailTitle}>{heading?.title}</h3>
        {heading && <p className={styles.detailDescription}>{heading.description}</p>}
        {detailState.failed && !detail ? <div className={styles.readFailed} role="alert"><p className={styles.error}>{copy.error}</p>
          <Button size="sm" variant="secondary" onClick={retry}>{copy.retry}</Button></div>
          : detail ? <RecipeRunner key={`${projectId}:${recipeId}`} projectId={projectId} detail={detail} files={files} characters={characters}
            referencePaths={referencePaths} viewerOnly={readOnly} unavailable={unavailable[detail.id]}
            mediaReady={media !== null} missingCapabilities={missingRecipeCapabilities(detail, media)}
            projectDimension={project.dimension} engineMismatch={!recipeMatchesEngine(detail, project.profile?.engine)}
            onUnavailable={reason => setUnavailable(previous => ({ ...previous, [detail.id]: reason }))}
            onAdopted={onRefreshFiles} onOpenFile={onOpenFile} onOpenExtensions={onOpenExtensions} onBrowseStyles={browseStyles}
            onNewCharacter={readOnly ? undefined : () => setEditing('new')} />
          : detailSlow && <p role="status" className={styles.muted}>{copy.loading}</p>}
      </section>}
    </section>
    <div className={styles.advanced}>
    {readable && <StudioDisclosure id="studio-art-styles-group" title={t('studio.panel.styleSummary')} open={stylesOpen} onOpenChange={setStylesOpen}
      meta={styleTitle === undefined ? undefined : styleTitle ? t('studio.panel.styleCurrent', { name: styleTitle }) : t('studio.panel.styleUnset')}>
      <ProjectStyleGallery key={projectId} projectId={projectId} viewerOnly={readOnly} embedded onCurrentStyle={setStyleTitle}
        dimension={project.dimension} assets={project.assets} projectLoading={project.loading} />
    </StudioDisclosure>}
    <StudioDisclosure title={t('studio.panel.charactersSummary')} meta={t('studio.panel.charactersCount', { n: characters.length })}>
    <section aria-labelledby="studio-characters-title">
      <header className={styles.sectionHeader}>
        <div><h3 id="studio-characters-title" className={styles.embeddedTitle}><VisuallyHidden>{t('studio.sections.characters')}</VisuallyHidden></h3><p>{t('studio.sections.charactersDescription')}</p></div>
        <Button variant="secondary" size="sm" disabled={readOnly} onClick={() => setEditing('new')}>{copy.addCharacter}</Button>
      </header>
      <div className={styles.characters}>
        {characters.map(card => <Card interactive key={card.slug} className={styles.characterCard}>
          <Button variant="ghost" className={styles.characterButton} disabled={readOnly}
            aria-label={`${copy.editCharacter}: ${card.name}`} onClick={() => setEditing(card)}>
            <span className={styles.characterGlyph} aria-hidden="true">{card.name.slice(0, 2)}</span>
            <span><strong>{card.name}</strong><span className={styles.characterDescription}>{card.description}</span></span>
          </Button>
        </Card>)}
        {!characters.length && <p className={styles.muted}>{copy.noCharacters}</p>}
      </div>
    </section>
    </StudioDisclosure>
    </div>
    {editing && <CharacterEditor projectId={projectId} card={editing === 'new' ? undefined : editing}
      onClose={() => setEditing(null)} onSaved={card => { charactersEntry.set([...characters.filter(value => value.slug !== card.slug), card]); setEditing(null); }} />}
  </div>;
}
