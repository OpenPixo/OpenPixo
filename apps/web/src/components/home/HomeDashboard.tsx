import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { OpenPixoHostProjectImportSuccess } from '@openpixo/host';
import type { Project } from '../../types';
import { NewGameDialog } from '../NewGameDialog';
import { ENTRY_NEW_GAME_EVENT, takeEntryNewGameRequest } from '../entryRailBridge';
import { useOpenFolderImport } from '../useOpenFolderImport';
import { HomeHeader } from './HomeHeader';
import { useHomeTemplates } from './HomeTemplates';
import { HomeContinue } from './HomeContinue';
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
  const folderImport = useOpenFolderImport({ onImportFolder, onImportFolderResponse });
  const [creating, setCreating] = useState(false);
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

  const state = projects.length > 0 ? 'returning' : projectsLoading ? 'loading' : 'first';

  return <div className={styles.dashboard}>
    <HomeHeader state={state} importing={folderImport.importing}
      canImport={folderImport.available} canCreate={Boolean(onImportFolderResponse)}
      onOpenFolder={() => void folderImport.openFolder()} onCreateGame={createGame} onOpenDoctor={onOpenDoctor} />
    {folderImport.error && <p className={styles.importError} role="alert">{folderImport.error.message}</p>}
    {/* Templates live behind New game; Home shows a returning user's games and the composer. */}
    {state !== 'first' && <HomeContinue projects={projects} templates={templateState.templates} loading={projectsLoading}
      onOpenProject={onOpenProject} onViewAll={onViewAllProjects} />}
    <div className={styles.composer}>{children}</div>
    {creating && onImportFolderResponse && <NewGameDialog
      {...(folderImport.available ? { onOpenFolder: () => void folderImport.openFolder() } : {})}
      {...(onOpenEngineSettings ? { onOpenEngineSettings } : {})}
      onClose={() => setCreating(false)} onCreated={onImportFolderResponse} />}
  </div>;
}
