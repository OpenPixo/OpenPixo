import { useEffect, useRef, useState } from 'react';
import { Button, VisuallyHidden } from '@openpixo/components';
import type { CharacterCard, ProjectFile, RecipeRun } from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import { Icon } from '../Icon';
import { CharacterEditor } from '../studio/CharacterEditor';
import { RecipeRunner } from '../studio/RecipeRunner';
import { localizedRecipeCopy } from '../studio/localization';
import { missingRecipeCapabilities } from '../studio/media-capabilities';
import { studioCharacters, studioMedia, studioRecipeDetail, useCacheEntry } from '../studio/studio-cache';
import { recipeExampleUrl } from './PresetCards';
import { ReferenceUpload, type UploadedReference } from './ReferenceUpload';
import { FadeImage, loadingFrame } from './FadeImage';
import styles from './Presets.module.css';

const NO_CHARACTERS: CharacterCard[] = [];

/**
 * One preset, opened from its card: its examples as pictures, and its form. Picking an
 * example fills the form with what made it. With no game, pictures for its reference
 * fields are uploaded here, and a result is saved into a game from its detail.
 */
export function PresetDrawer({ recipeId, projectId, files, uploads, onUploaded, viewerOnly, onClose, onStarted, onAdopted, onOpenFile, onOpenExtensions }: {
  recipeId: string;
  projectId: string | null;
  files: ProjectFile[];
  uploads: readonly UploadedReference[];
  onUploaded: (upload: UploadedReference) => void;
  viewerOnly?: boolean | undefined;
  onClose: () => void;
  onStarted: (run: RecipeRun) => void;
  onAdopted: () => Promise<void>;
  onOpenFile: (path: string) => void;
  onOpenExtensions: () => void;
}) {
  const { t, locale } = useI18n();
  const detailEntry = studioRecipeDetail(recipeId);
  const { value: detail, failed } = useCacheEntry(detailEntry);
  const { value: media } = useCacheEntry(studioMedia());
  const charactersEntry = projectId ? studioCharacters(projectId) : null;
  const { value: characterList } = useCacheEntry(charactersEntry);
  const characters = characterList ?? NO_CHARACTERS;
  const [example, setExample] = useState<number | null>(null);
  const [unavailable, setUnavailable] = useState<string | undefined>();
  const [editing, setEditing] = useState(false);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => { if (!detailEntry.get().value) void detailEntry.refresh(); }, [detailEntry]);
  useEffect(() => { if (charactersEntry) void charactersEntry.refresh(); }, [charactersEntry]);
  useEffect(() => { headingRef.current?.focus({ preventScroll: true }); }, [recipeId]);

  const copy = detail ? localizedRecipeCopy({ ...detail, title_i18n: detail.manifest.title_i18n, description_i18n: detail.manifest.description_i18n }, locale) : null;
  // The detail route carries the examples in its manifest; a summary carries them at the top.
  const examples = detail?.examples ?? detail?.manifest.examples ?? [];
  const picked = example === null ? undefined : examples[example];
  // With no game, a reference field lists the pictures uploaded on this page.
  const choices: ProjectFile[] = projectId ? files
    : uploads.map(upload => ({ name: upload.ref, path: upload.ref, type: 'file', size: 0, mtime: 0, kind: 'image', mime: 'image/png' }));
  const labels = Object.fromEntries(uploads.map(upload => [upload.ref, upload.name]));
  const takesPictures = detail?.manifest.pixo?.recipe?.inputs.some(field => field.type === 'image-ref' || field.type === 'asset-ref') ?? false;

  const pictured = examples.flatMap((entry, index) => entry.after || entry.cover ? [index] : []);
  // The large picture: the example picked, else the first one there is.
  const shown = example !== null && pictured.includes(example) ? example : pictured[0] ?? null;
  const shownEntry = shown === null ? undefined : examples[shown];
  const exampleTitle = (entry: (typeof examples)[number]) => locale.startsWith('zh') ? entry.title_i18n?.['zh-CN'] ?? entry.title : entry.title;

  return <section className={styles.drawer} aria-labelledby="generate-preset-title" data-testid="generate-preset-drawer" data-examples={shownEntry ? true : undefined}>
    {shownEntry && shown !== null && <div className={styles.showcase}>
      <div className={`${styles.showcaseArt} ${loadingFrame}`} data-cover={shownEntry.cover && !shownEntry.after ? true : undefined}>
        <FadeImage key={`${shown}-after`} src={recipeExampleUrl(recipeId, shown, shownEntry.after ? 'after' : 'cover')} className={styles.showcaseAfter} />
        {shownEntry.before && <span className={styles.showcaseBefore}>
          <img src={recipeExampleUrl(recipeId, shown, 'before')} alt="" /><span aria-hidden="true">→</span></span>}
        <span className={styles.showcaseCaption}>{exampleTitle(shownEntry)}</span>
      </div>
      {pictured.length > 1 && <ul className={styles.examples} aria-label={t('generate.examples')}>
        {pictured.map(index => <li key={index}>
          <button type="button" className={styles.example} aria-pressed={example === index} onClick={() => setExample(index)}
            title={exampleTitle(examples[index]!)} data-testid="generate-example">
            <img src={recipeExampleUrl(recipeId, index, examples[index]!.after ? 'after' : 'cover')} alt="" loading="lazy" />
            <VisuallyHidden>{exampleTitle(examples[index]!)}</VisuallyHidden>
          </button>
        </li>)}
      </ul>}
      {pictured.length === 1 && <button type="button" className={styles.useExample} aria-pressed={example === shown} onClick={() => setExample(shown)} data-testid="generate-example">
        {t('generate.useExample')}</button>}
    </div>}
    <div className={styles.panel}>
      <header className={styles.drawerHeader}>
        <h3 id="generate-preset-title" ref={headingRef} tabIndex={-1} className={styles.drawerTitle}>{copy?.title ?? recipeId}</h3>
        <Button size="sm" variant="ghost" className={styles.drawerClose} onClick={onClose} aria-label={t('generate.closePreset')}><Icon name="close" size={16} /></Button>
      </header>
      {copy?.description && <p className={styles.drawerLine}>{copy.description}</p>}
    <div className={`${styles.drawerForm} ${styles.studioForm}`}>
    {!projectId && takesPictures && <ReferenceUpload disabled={viewerOnly} onUploaded={onUploaded} />}
    {failed && !detail ? <p className={styles.problem} role="alert">{t('generate.presetFailed')}</p>
      : detail ? <RecipeRunner key={`${projectId ?? 'none'}:${recipeId}:${example ?? 'default'}`} projectId={projectId} detail={detail}
        files={choices} fileLabels={labels} characters={characters} referencePaths={[]} viewerOnly={viewerOnly}
        initialInputs={picked ? { ...picked.inputs, ...(picked.prompt ? promptInput(detail.manifest.pixo?.recipe?.inputs ?? [], locale.startsWith('zh') ? picked.prompt_i18n?.['zh-CN'] ?? picked.prompt : picked.prompt) : {}) } : undefined}
        unavailable={unavailable} mediaReady={media !== null} missingCapabilities={missingRecipeCapabilities(detail, media)}
        onUnavailable={setUnavailable} onAdopted={onAdopted} onOpenFile={onOpenFile} onOpenExtensions={onOpenExtensions} onStarted={onStarted}
        onNewCharacter={projectId && !viewerOnly ? () => setEditing(true) : undefined} />
      : <p className={styles.muted} role="status">{t('studio.style.loading')}</p>}
    </div>
    </div>
    {editing && projectId && <CharacterEditor projectId={projectId} onClose={() => setEditing(false)}
      onSaved={card => { charactersEntry?.set([...characters.filter(value => value.slug !== card.slug), card]); setEditing(false); }} />}
  </section>;
}

/** An example's prompt goes into the recipe's free-text field, the same one a run's `prompt` fills. */
function promptInput(fields: ReadonlyArray<{ name: string; type?: string | undefined }>, prompt: string): Record<string, unknown> {
  const slot = fields.find(field => field.name === 'prompt') ?? fields.find(field => field.type === 'text');
  return slot ? { [slot.name]: prompt } : {};
}
