import { useCallback, useEffect, useState } from 'react';
import type { ProjectFile, RecipeRun } from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import { StudioDisclosure } from '../studio/StudioDisclosure';
import { StudioPanel } from '../studio/StudioPanel';
import { studioRecipes, useCacheEntry } from '../studio/studio-cache';
import { useStudioPrefetch } from '../studio/useStudioPrefetch';
import { GenerateBox } from './GenerateBox';
import { GenerateHistory, runTitle } from './GenerateHistory';
import { initialGenerateForm, type GenerateForm } from './generate-request';
import { ResultDetail } from './ResultDetail';
import { useRunHistory } from './useRunHistory';
import styles from './GenerateView.module.css';

/**
 * 生成, the panel's fourth view (specs/current/asset-generator.md §6): a prompt-first
 * generator for images, audio and 3D on top, this machine's history of what the user
 * and the agent made below, and the presets, art styles and characters folded under
 * it. A result's detail replaces the view's body; ← or Esc returns to the list.
 */
export function GenerateView({
  projectId, files, viewerOnly, hidden, active, initialRecipeId, referencePaths, referenceRequest,
  onOpenFile, onRefreshFiles, onOpenExtensions, onOpenAccount,
}: {
  projectId: string;
  files: ProjectFile[];
  viewerOnly?: boolean;
  /** True while another view, or an item on this view's stack, is showing. */
  hidden: boolean;
  /** 生成 is the current view: its history is read and kept fresh only then. */
  active: boolean;
  /** A preset queued by a composer or home entry point, read once per project. */
  initialRecipeId: string | null;
  /** Pictures handed over by "generate from" on an asset. */
  referencePaths: string[];
  /** Changes each time "generate from" hands pictures over, so the same ones twice still apply. */
  referenceRequest: number;
  onOpenFile: (path: string) => void;
  onRefreshFiles: () => Promise<void>;
  onOpenExtensions: () => void;
  onOpenAccount?: (() => void) | undefined;
}) {
  const { t, locale } = useI18n();
  useStudioPrefetch(projectId);
  const { value: recipes } = useCacheEntry(studioRecipes());
  const history = useRunHistory(projectId, active && !hidden);
  const [form, setForm] = useState<GenerateForm>(() => initialGenerateForm('image', referencePaths));
  const [detail, setDetail] = useState<{ runId: string; candidateId: string } | null>(null);
  const [again, setAgain] = useState(0);
  const [presetsOpen, setPresetsOpen] = useState(Boolean(initialRecipeId));
  // The presets list reads its own data; it mounts the first time its section opens, then stays.
  const [presetsMounted, setPresetsMounted] = useState(Boolean(initialRecipeId));
  useEffect(() => { if (presetsOpen) setPresetsMounted(true); }, [presetsOpen]);

  // "Generate from" on an asset puts its pictures in the box, as references (or the 3D picture).
  useEffect(() => {
    if (!referenceRequest || !referencePaths.length) return;
    setDetail(null);
    setForm(previous => ({ ...previous, kind: previous.kind === 'model3d' ? 'model3d' : 'image',
      references: referencePaths.slice(0, previous.kind === 'model3d' ? 1 : 3) }));
  }, [referenceRequest, referencePaths]);
  useEffect(() => { if (initialRecipeId) setPresetsOpen(true); }, [initialRecipeId]);

  // A run started here, or saved from its detail, shows at once; the next read confirms it.
  const { add } = history;
  const remember = useCallback((next: RecipeRun) => add(next), [add]);
  const shownRuns = history.runs;
  const run = detail ? shownRuns?.find(entry => entry.id === detail.runId) : undefined;
  const candidate = run?.candidates.find(entry => entry.id === detail?.candidateId);
  const back = useCallback(() => setDetail(null), []);

  return <div className={styles.view} hidden={hidden} data-testid="panel-generate-view">
    {run && candidate ? <ResultDetail run={run} candidate={candidate} title={runTitle(run, recipes, locale)} readOnly={viewerOnly}
      onBack={back} onRunChange={remember} onSaved={onRefreshFiles} onOpenFile={onOpenFile}
      onAgain={next => { setForm(next); setDetail(null); setAgain(value => value + 1); }}
      onEdit={next => { setForm(next); setDetail(null); }} /> : <div className={styles.body}>
      <GenerateBox projectId={projectId} files={files} form={form} onFormChange={setForm} readOnly={viewerOnly}
        againRequest={again} onStarted={remember} onOpenAccount={onOpenAccount} />
      <GenerateHistory runs={shownRuns} failed={history.failed} recipes={recipes} onRetry={() => void history.refresh()}
        onOpen={(runId, candidateId) => setDetail({ runId, candidateId })} />
      <StudioDisclosure title={t('generate.presets')} open={presetsOpen} onOpenChange={setPresetsOpen}>
        {presetsMounted && <StudioPanel projectId={projectId} files={files} viewerOnly={viewerOnly} open={active && !hidden && presetsOpen}
          initialRecipeId={initialRecipeId} referencePaths={referencePaths} onRefreshFiles={onRefreshFiles}
          onOpenExtensions={onOpenExtensions} onOpenFile={onOpenFile} />}
      </StudioDisclosure>
    </div>}
  </div>;
}
