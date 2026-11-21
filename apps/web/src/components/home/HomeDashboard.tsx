import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { OpenPixoHostProjectImportSuccess } from '@openpixo/host';
import { useI18n } from '../../i18n';
import type { Project } from '../../types';
import { NewGameDialog } from '../NewGameDialog';
import { ENTRY_NEW_GAME_EVENT, takeEntryNewGameRequest } from '../entryRailBridge';
import { SAMPLE_TEMPLATE_ID, useQuickSample } from '../new-game/quick-sample';
import { useOpenFolderImport } from '../useOpenFolderImport';
import { HomeHeader } from './HomeHeader';
import { useHomeTemplates } from './HomeTemplates';
import { HomeContinue } from './HomeContinue';
import { HomeGettingStarted } from './HomeGettingStarted';
import { HomeStartPaths } from './HomeStartPaths';
import { publishHomeStartActions } from './home-start-actions';
import styles from './HomeDashboard.module.css';

interface Props {
  projects: readonly Project[];
  projectsLoading?: boolean;
  onOpenProject: (id: string, fileName?: string) => void;
  onImportFolder?: (baseDir: string) => Promise<void> | void;
  onImportFolderResponse?: (response: OpenPixoHostProjectImportSuccess) => Promise<void> | void;
  onViewAllProjects?: () => void;
  onOpenDoctor?: () => void;
  onOpenEngineSettings?: () => void;
  children: ReactNode;
}

export function HomeDashboard({ projects, projectsLoading, onOpenProject,
  onImportFolder, onImportFolderResponse, onViewAllProjects, onOpenDoctor, onOpenEngineSettings, children }: Props) {
  const { t } = useI18n();
  const folderImport = useOpenFolderImport({ onImportFolder, onImportFolderResponse });
  // The finished sample is one click: made, then opened, with the new-game
  // dialog only as the fallback when making it fails.
  const sample = useQuickSample(onImportFolderResponse);
  const [creating, setCreating] = useState(false);
  const composerRef = useRef<HTMLDivElement>(null);
  // Only the continue list needs the catalogue: its fallback covers come from it.
  const templateState = useHomeTemplates();
  const createGame = useCallback(() => setCreating(true), []);
  // The sidebar's New game, from any view or from inside a project
  // (`requestEntryNewGame`), opens this same dialog.
  useEffect(() => {
    if (takeEntryNewGameRequest()) createGame();
    const onRequest = () => { if (takeEntryNewGameRequest()) createGame(); };
    window.addEventListener(ENTRY_NEW_GAME_EVENT, onRequest);
    return () => window.removeEventListener(ENTRY_NEW_GAME_EVENT, onRequest);
  }, [createGame]);

  /** "Say your idea": the composer is where an idea is typed; without one, the dialog. */
  const focusComposer = useCallback(() => {
    const field = composerRef.current?.querySelector<HTMLElement>('textarea, [contenteditable="true"]');
    if (!field) { createGame(); return; }
    field.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    field.focus({ preventScroll: true });
  }, [createGame]);

  const canSample = Boolean(onImportFolderResponse);
  const openFolderRef = useRef(folderImport.openFolder);
  openFolderRef.current = folderImport.openFolder;
  const startSampleRef = useRef(sample.start);
  startSampleRef.current = sample.start;
  const startSample = useCallback(() => void startSampleRef.current(), []);
  const openFolder = useCallback(() => void openFolderRef.current(), []);
  // The empty My Games list offers these same flows (`home-start-actions`).
  const folderError = folderImport.error?.message ?? null;
  useEffect(() => {
    publishHomeStartActions({
      ...(canSample ? { startSample } : {}),
      sampleBusy: sample.busy,
      ...(folderImport.available ? { openFolder } : {}),
      folderBusy: folderImport.importing,
      folderError,
    });
  }, [canSample, startSample, sample.busy, folderImport.available, openFolder, folderImport.importing, folderError]);
  useEffect(() => () => publishHomeStartActions(null), []);

  const state = projects.length > 0 ? 'returning' : projectsLoading ? 'loading' : 'first';

  return <div className={styles.dashboard}>
    <HomeHeader state={state} importing={folderImport.importing}
      canImport={folderImport.available} canCreate={Boolean(onImportFolderResponse)}
      onOpenFolder={openFolder} onCreateGame={createGame} onOpenDoctor={onOpenDoctor} />
    {folderImport.error && <p className={styles.importError} role="alert">{folderImport.error.message}</p>}
    {/* Templates live behind New game; Home shows a returning user's games and the composer. */}
    {state !== 'first' && <HomeContinue projects={projects} templates={templateState.templates} loading={projectsLoading}
      onOpenProject={onOpenProject} onViewAll={onViewAllProjects} />}
    <div className={styles.composer} ref={composerRef}>{children}</div>
    {state === 'first' && <HomeStartPaths className={styles.paths} label={t('home.paths.label')}
      onIdea={focusComposer}
      {...(folderImport.available ? { onOpenFolder: openFolder, folderBusy: folderImport.importing } : {})}
      {...(canSample ? { onSample: startSample, sampleBusy: sample.busy } : {})} />}
    {state === 'returning' && <HomeGettingStarted projects={projects}
      {...(canSample ? { onStartSample: startSample, sampleBusy: sample.busy } : {})}
      onStartGame={focusComposer} onOpenProject={onOpenProject} />}
    {creating && onImportFolderResponse && <NewGameDialog
      {...(folderImport.available ? { onOpenFolder: openFolder } : {})}
      {...(onOpenEngineSettings ? { onOpenEngineSettings } : {})}
      onClose={() => setCreating(false)} onCreated={onImportFolderResponse} />}
    {sample.fallback && onImportFolderResponse && <NewGameDialog
      initialTemplateId={SAMPLE_TEMPLATE_ID}
      initialError={sample.fallback.error}
      onClose={sample.closeFallback}
      onCreated={onImportFolderResponse} />}
  </div>;
}
