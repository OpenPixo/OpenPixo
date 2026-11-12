import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import type { Project } from '../types';
import { useT } from '../i18n';
import { navigate } from '../router';
import { EntryNavRail } from './EntryNavRail';
import type { EntrySettingsSection } from './EntrySettingsMenu';
import { railWidthProperties, useRailWidth } from './entry-nav-rail/rail-width';
import { ProjectSearchModal } from './ProjectSearchModal';
import {
  ENTRY_RAIL_STATE_EVENT,
  ENTRY_RAIL_TOGGLE_EVENT,
  ENTRY_SEARCH_OPEN_EVENT,
  readStoredRailOpen,
  requestEntryNewGame,
  writeStoredRailOpen,
} from './entryRailBridge';
import styles from './ProjectSidebar.module.css';

interface Props {
  conversationsReady?: boolean;
  projects: Project[];
  activeProjectId: string;
  activeConversationId: string | null;
  activeFileName: string | null;

  onOpenProject: (id: string) => unknown;
  onOpenSettings: (section?: EntrySettingsSection) => void;
  onRenameProject: (id: string, name: string) => void;
  onDeleteProject: (id: string) => Promise<boolean | void> | boolean | void;
  onDuplicateProject: (id: string) => Promise<void> | void;
  /** The update-ready host, placed in the same chrome cluster Home uses. */
  updaterSlot?: ReactNode;
  children: ReactNode;
}

/** Below this width the rail starts compact and opens over the workbench. */
const COMPACT_QUERY = '(max-width: 1080px)';

function readCompact(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia(COMPACT_QUERY).matches;
}

/**
 * The workbench's left column: the same rail Home shows (specs/current/
 * openpixo-ui-cleanup.md), with the open project and session marked in its
 * Recent tree instead of a destination. Collapsing keeps the workbench mounted.
 */
export function ProjectSidebar({ conversationsReady = true, projects, activeProjectId, activeConversationId, activeFileName,
  onOpenProject, onOpenSettings, onRenameProject, onDeleteProject,
  onDuplicateProject, updaterSlot, children }: Props) {
  const t = useT();
  const [open, setOpenState] = useState(readStoredRailOpen);
  const railWidth = useRailWidth();
  const [compact, setCompact] = useState(readCompact);
  // In a compact window the rail opens as an overlay for one visit; that is
  // not the user's saved preference for wide windows.
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // Only a user action is persisted (see `writeStoredRailOpen`): the mount
  // must not write the default back as if it were a choice.
  const userSetRef = useRef(false);
  const toggle = useCallback(() => {
    if (readCompact()) {
      setOverlayOpen((value) => !value);
      return;
    }
    userSetRef.current = true;
    setOpenState((value) => !value);
  }, []);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(COMPACT_QUERY);
    const sync = () => { setCompact(query.matches); setOverlayOpen(false); };
    query.addEventListener?.('change', sync);
    return () => query.removeEventListener?.('change', sync);
  }, []);
  useEffect(() => {
    const openSearch = () => setSearchOpen(true);
    const keyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      const key = event.key.toLowerCase();
      if (key === 'b') { event.preventDefault(); toggle(); }
      else if (key === 'k') { event.preventDefault(); openSearch(); }
    };
    window.addEventListener(ENTRY_RAIL_TOGGLE_EVENT, toggle);
    window.addEventListener(ENTRY_SEARCH_OPEN_EVENT, openSearch);
    document.addEventListener('keydown', keyDown);
    return () => {
      window.removeEventListener(ENTRY_RAIL_TOGGLE_EVENT, toggle);
      window.removeEventListener(ENTRY_SEARCH_OPEN_EVENT, openSearch);
      document.removeEventListener('keydown', keyDown);
    };
  }, [toggle]);
  const railOpen = conversationsReady && (compact ? overlayOpen : open);
  useEffect(() => {
    if (userSetRef.current) {
      userSetRef.current = false;
      writeStoredRailOpen(open);
    }
    window.dispatchEvent(new CustomEvent(ENTRY_RAIL_STATE_EVENT, { detail: { open: railOpen } }));
  }, [open, railOpen]);

  const openProject = async (id: string) => {
    setOverlayOpen(false);
    await onOpenProject(id);
  };

  return (
    <div className={styles.layout} data-rail-host style={railWidthProperties(railWidth)}
      data-sidebar-open={railOpen} data-sidebar-compact={compact || undefined}
      data-sidebar-ready={conversationsReady}>
      <div className={styles.sidebar} aria-label={t('entry.navProjects')} role="complementary">
        <EntryNavRail
          view={null}
          open={railOpen}
          onToggleRail={toggle}
          onViewChange={(view) => navigate({ kind: 'home', view })}
          onNewProject={() => {
            requestEntryNewGame();
            navigate({ kind: 'home', view: 'home' });
          }}
          onOpenSearch={() => setSearchOpen(true)}
          onOpenSettings={onOpenSettings}
          updaterSlot={updaterSlot}
          recentProjects={conversationsReady ? projects : []}
          onOpenRecentProject={openProject}
          onRenameRecentProject={onRenameProject}
          onDeleteRecentProject={onDeleteProject}
          onDuplicateRecentProject={onDuplicateProject}
          activeProjectId={activeProjectId}
          activeConversationId={activeConversationId}
          activeFileName={activeFileName}
        />
      </div>
      {compact && railOpen ? (
        <div className={styles.scrim} aria-hidden onClick={() => setOverlayOpen(false)} />
      ) : null}
      <div className={styles.main}>{children}</div>
      {searchOpen ? (
        <ProjectSearchModal
          projects={projects}
          onOpenProject={async (id) => { setSearchOpen(false); await openProject(id); }}
          onClose={() => setSearchOpen(false)}
        />
      ) : null}
    </div>
  );
}
