import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Button, Input } from '@openpixo/components';
import type { CharacterCard, ProjectFile, RecipeCodeRunResponse, RecipeDetail, RecipeRun } from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import { codexImageReasonKey } from '../../media/codex-image-errors';
import { openMediaSettings } from '../../settings-navigation';
import { adoptStudioCandidates, getStudioRun, startStudioRun, StudioRequestError } from '../../providers/studio';
import { CandidateGrid } from './CandidateGrid';
import { RecipeInputs } from './RecipeInputs';
import { RecipeStylePicker } from './StylePicker';
import { studioCopy } from './copy';
import { localizedRecipeInputs, recipeNeedsSentence } from './localization';
import { isStarterRecipe, type ProjectArtDimension } from './project-catalog';
import styles from './StudioPanel.module.css';

export const studioRunIsActive = (run: RecipeRun | null) => !!run && ['queued', 'generating', 'postprocessing'].includes(run.status);

/** What a failed recipe start tells the user: the daemon's own reason when it gave one, not a catch-all. */
export function studioRunErrorMessage(cause: unknown, fallback: string, codexMessage: (code: string) => string): string {
  if (!(cause instanceof StudioRequestError) || !cause.code) return fallback;
  if (cause.code.startsWith('CODEX_')) return codexMessage(cause.code);
  return cause.message.trim() || fallback;
}

/** A recipe's form, its run and its results. The title and description above it belong to the detail view. */
export function RecipeRunner({ projectId, detail, files, characters, referencePaths, viewerOnly, unavailable, missingCapabilities = [], mediaReady = true, projectDimension, engineMismatch,
  onOpenMediaSettings = openMediaSettings, onNewCharacter,
  onUnavailable, onAdopted, onOpenFile, onOpenExtensions, onBrowseStyles }: {
  projectId: string; detail: RecipeDetail; files: ProjectFile[]; characters: CharacterCard[];
  referencePaths: string[]; viewerOnly?: boolean; unavailable?: string; missingCapabilities?: string[]; mediaReady?: boolean;
  projectDimension?: ProjectArtDimension | null; engineMismatch?: boolean;
  onOpenMediaSettings?: () => void;
  onBrowseStyles?: () => void;
  onNewCharacter?: () => void;
  onUnavailable: (reason: string) => void; onAdopted: () => Promise<void>; onOpenFile: (path: string) => void; onOpenExtensions: () => void;
}) {
  const { locale, t } = useI18n();
  const copy = studioCopy(locale);
  const recipe = detail.manifest.pixo!.recipe!;
  const hasCountInput = recipe.inputs.some(field => field.type === 'count');
  const fields = useMemo(() => localizedRecipeInputs(recipe.inputs, locale), [recipe.inputs, locale]);
  const [inputs, setInputs] = useState<Record<string, unknown>>(() => Object.fromEntries(fields.filter(field => field.default !== undefined).map(field => [field.name, field.default])));
  const [valid, setValid] = useState(false);
  const [count, setCount] = useState(recipe.generation?.count.default ?? 1);
  const [styleId, setStyleId] = useState<string | null | undefined>();
  const [run, setRun] = useState<RecipeRun | null>(null);
  const [codeRun, setCodeRun] = useState<RecipeCodeRunResponse | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [pollError, setPollError] = useState('');
  const [pollRetry, setPollRetry] = useState(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const fields = recipe.inputs.filter(field => field.type === 'image-ref' || field.type === 'asset-ref');
    setInputs(previous => ({ ...previous, ...Object.fromEntries(fields.slice(0, referencePaths.length).map((field, index) => [field.name, referencePaths[index]])) }));
  }, [recipe, referencePaths]);

  const runId = run?.id;
  const active = studioRunIsActive(run);
  useEffect(() => {
    if (!runId || !active) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await getStudioRun(projectId, runId!, controller.signal);
        if (controller.signal.aborted) return;
        setRun(next); setPollError('');
        if (studioRunIsActive(next)) timer = setTimeout(() => void poll(), 1500);
      } catch (cause) {
        if (!controller.signal.aborted) { console.warn('[Studio] run poll failed:', cause); setPollError(copy.error); }
      }
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [projectId, runId, active, pollRetry, copy.error]);

  async function generate(event: FormEvent) {
    event.preventDefault();
    if (viewerOnly || pending || active || !valid || unavailable || missingCapabilities.length || (!mediaReady && detail.requires.length > 0)) return;
    setPending(true); setError(''); setCodeRun(null); setPollError('');
    try {
      const result = await startStudioRun(projectId, { recipeId: detail.id, inputs,
        ...(recipe.surface === 'image' && styleId !== undefined ? { styleId } : {}),
        ...(recipe.surface !== 'code' && !hasCountInput ? { count } : {}) });
      if (!mounted.current) return;
      setSelected([]);
      if ('candidates' in result) { setRun(result); setCodeRun(null); }
      else { setRun(null); setCodeRun(result); }
    } catch (cause) {
      if (!mounted.current) return;
      console.warn('[Studio] run failed:', cause);
      if (cause instanceof StudioRequestError && cause.code === 'RECIPE_NO_MODEL') { onUnavailable(t('studio.noModel')); return; }
      setError(studioRunErrorMessage(cause, copy.error, code => t(codexImageReasonKey(code))));
    } finally { if (mounted.current) setPending(false); }
  }
  async function adopt() {
    if (!run || viewerOnly || pending || !selected.length) return;
    setPending(true); setError('');
    try {
      const next = await adoptStudioCandidates(projectId, run.id, selected);
      if (!mounted.current) return;
      setRun(next); setSelected([]);
      await onAdopted();
    } catch (cause) { console.warn('[Studio] adopt failed:', cause); if (mounted.current) setError(copy.error); }
    finally { if (mounted.current) setPending(false); }
  }

  const blocked = missingCapabilities.length > 0 ? recipeNeedsSentence(missingCapabilities, locale) : unavailable;

  return <div className={styles.runner}>
    {isStarterRecipe(detail) && <p className={styles.starterWarning} role="note">{t('studio.catalog.starterWarning')}</p>}
    {engineMismatch && <p className={styles.starterWarning} role="note">{t('studio.catalog.engineMismatch')}</p>}
    {detail.verified !== true && !isStarterRecipe(detail) && <p className={styles.muted} role="note">{t('studio.panel.untestedNote')}</p>}
    <form onSubmit={event => void generate(event)} className={styles.form}>
      <fieldset className={styles.fieldset} disabled={pending || active || viewerOnly}>
        <RecipeInputs fields={fields} values={inputs} files={files} characters={characters} maxCount={recipe.generation?.count.max ?? 4}
          onChange={setInputs} onValidityChange={setValid} onNewCharacter={onNewCharacter} />
        {recipe.surface !== 'code' && !hasCountInput && <label className={styles.field}>{copy.count}<Input type="number" min={1}
          max={recipe.generation?.count.max ?? 4} step={1} value={count}
          onChange={event => setCount(Number(event.target.value))} required /></label>}
      </fieldset>
      {/* Essentials above, the optional style override folded below them. */}
      {recipe.surface === 'image' && <RecipeStylePicker projectId={projectId} value={styleId} onChange={setStyleId}
        dimension={projectDimension} disabled={pending || active || viewerOnly} onBrowseStyles={onBrowseStyles} />}
      {referencePaths.length > 0 && <p className={styles.muted}>{copy.referenceHint}</p>}
      {blocked && <p className={styles.providerMissing} role="status">{blocked}</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {blocked ? <Button type="button" variant="primary" className={styles.runAction} onClick={onOpenMediaSettings}>{copy.setupProvider}</Button> :
      <Button type="submit" variant="primary" className={styles.runAction} disabled={!valid || pending || active || viewerOnly || (!mediaReady && detail.requires.length > 0)} aria-busy={pending || active}>
        {run ? copy.again : copy.generate}
      </Button>}
    </form>
    {codeRun && <div role="status" className={styles.notice}>
      {codeRun.status === 'missing-skills' ? <><p>{copy.missingSkills}</p><ul>{codeRun.missingSkills.map(skill => <li key={skill}>{skill}</li>)}</ul>
        <Button size="sm" onClick={onOpenExtensions}>{copy.extensions}</Button></> : <p>{copy.started}{codeRun.runId ? ` · ${codeRun.runId}` : ''}</p>}
    </div>}
    {pollError && <div role="alert" className={styles.error}><p>{pollError}</p><Button size="sm" onClick={() => setPollRetry(value => value + 1)}>{copy.retry}</Button></div>}
    {run && <CandidateGrid run={run} selected={selected} pending={pending} readOnly={viewerOnly}
      onSelect={setSelected} onAdopt={() => void adopt()} onOpenFile={onOpenFile} />}
  </div>;
}
