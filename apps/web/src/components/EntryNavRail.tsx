import type { Ref } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@openpixo/components';
import { workspaceChromeAccountActionsHost } from './workspaceChromeActions';



// Local navigation, recent projects, settings, help links and updater actions.


import { ProjectConversationGroup } from './entry-nav-rail/ProjectConversationGroup';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';


import { Icon } from './Icon';


import { RailHelpMenu } from './entry-nav-rail/RailHelpMenu';
import { RailRecentRow } from './entry-nav-rail/RailRecentRow';
import { RailResizeHandle } from './entry-nav-rail/RailResizeHandle';

import { ProjectDeleteConfirmDialog } from './project-actions/ProjectDeleteConfirmDialog';

import { useProjectDeleteFlow } from './project-actions/useProjectDeleteFlow';
import { useProjectDuplicateFlow } from './project-actions/useProjectDuplicateFlow';


import { acknowledgeProjectCompletion, useProjectRunStatuses } from '../hooks/useProjectRunStatuses';

import type { EntrySettingsSection } from './EntrySettingsMenu';
import type { AppConfig, Project } from '../types';
import { AccountChip } from './onboarding/AccountChip';
import { useI18n } from '../i18n';


import type { EntryHomeView } from '../router';
import type { TrackingProjectCollectionPage, TrackingWorkspacePage } from '@openpixo/contracts/analytics';
import { useAnalytics } from '../analytics/provider';
import { trackAccountMenuClick, trackEntryNavigationClick } from '../analytics/events';
import { entryViewToTracking } from '../analytics/workspace';
import { PRODUCT_NAME } from '@openpixo/contracts';
import { isMacPlatform } from '../utils/platform';
import styles from './EntryNavRail.module.css';


// The rail's destination ids are the entry-shell home views (kept in sync with
// the router so `navigate({ kind: 'home', view })` type-checks for every item).
export type EntryView = EntryHomeView;

interface Props {
  /** The entry view on screen; null inside a project, where no destination is
   *  current and the Recent tree marks the open project and session instead. */
  view: EntryView | null;
  onViewChange: (view: EntryView) => void;
  onNewProject: () => void;
  /** Opens the project search palette (blurred modal over all projects). */
  onOpenSearch?: () => void;
  newProjectDisabled?: boolean;
  /** The collapsed rail keeps its header toggle available. */
  open: boolean;
  onToggleRail?: () => void;
  /** Extra content for the top-right chrome cluster, rendered LEFT of the
   *  account module (e.g. the DeepSeek campaign badge). */
  topRightSlot?: ReactNode;
  /** Open the app settings dialog (optionally on a specific section). */
  onOpenSettings?: (section?: EntrySettingsSection) => void;
  /** Retained for callers; identity now comes from the daemon account status. */
  config?: AppConfig;
  onResetOnboarding?: (next: AppConfig) => void;
  /**
   * The update-ready host (`UpdaterPopup`), which renders nothing until the
   * updater reports a downloaded, unopened installer.
   *
   * It is an independent control in the top-right chrome cluster
   * (`.entry-nav-rail__account-updater`), immediately after the account capsule
   * when one is present.
   */
  updaterSlot?: ReactNode;
  /** Optional notice shown above the footer controls. */
  footerNotice?: ReactNode;
  /** Projects for the rail's 最近浏览过 section (per product: 在插件下边新增一个
   *  类型). The SAME catalog and the SAME order 全部项目's 最近浏览过 tab shows —
   *  EntryShell hands over the one it already feeds that grid, so the two can
   *  never drift; this list only takes the head of it. Without a cloud
   *  identity it is the local project list (OPEND-3140), so the local shell
   *  lists its projects here too. Empty (or absent) hides the section
   *  entirely. */
  recentProjects?: Project[];
  /** Row actions for the 最近项目 list's ⋮ menu (重命名 / 复制 / 转入团队空间 /
   *  删除 — OPEND-2686, OPEND-2794). Omit one to drop its item. They are the
   *  SAME handlers the project cards drive their menu with, so an action from
   *  the rail lands in exactly one place. */
  onRenameRecentProject?: (id: string, name: string) => void;
  onDeleteRecentProject?: (id: string) => Promise<boolean | void> | boolean | void;
  onDuplicateRecentProject?: (id: string) => Promise<void> | void;
  /** The one shared-state answer for a row (see `createSharedProjectPredicate`)
   *  and the hub's projectId → sharing member map; together they decide which
   *  rows the member may mutate and which are already in the team space. */


  /** Optimistic shared-state markers for a 转入团队空间 from the rail — the
   *  same callbacks EntryShell hands the project cards. */


  /** Opens one of those projects — the pull-first opener, so a shared project
   *  that is not local yet still lands. */
  onOpenRecentProject?: (id: string) => void | Promise<unknown>;
  /** The open project, session and file, highlighted in the Recent tree. */
  activeProjectId?: string | null;
  activeConversationId?: string | null;
  activeFileName?: string | null;
  /** One-off targeted announcement coordination owned by the Home shell. */


}


// No `data-tooltip` here: every nav item renders its label inline, so the
// rail's hover bubble (entry-layout.css) would only duplicate visible text.
// That bubble stays reserved for the rail's icon-only controls (updater,
// avatar, icon-only sign-out).
function NavButton({
  active,
  ariaLabel,
  label,
  onClick,
  disabled,
  testId,
  buttonRef,
  ariaHasPopup,
  ariaExpanded,
  children,
}: NavButtonProps) {
  return (
    <Button
      ref={buttonRef}
      variant="ghost"
      type="button"
      className={`${styles.navButton} entry-nav-rail__btn${active ? ` ${styles.active} is-active` : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-current={active ? 'page' : undefined}
      aria-haspopup={ariaHasPopup}
      aria-expanded={ariaHasPopup ? Boolean(ariaExpanded) : undefined}
      {...(testId ? { 'data-testid': testId } : {})}
    >
      <span className={styles.navIcon} aria-hidden>{children}</span>
      <span className={styles.navLabel}>{label}</span>
    </Button>
  );
}

/** Remembers the section's open/closed state across launches, next to the
 *  rail's own `od.entry.railOpen`. A disclosure the user closed should stay
 *  closed — re-opening it on every boot is the whole reason to have the
 *  control. */
const RECENT_SECTION_STORAGE_KEY = 'pixo.entry.railRecentOpen';

/**
 * About how many rows the 最近项目 list shows on a desktop window before it
 * scrolls (the list fills whatever height the rail has left — see `.recent`
 * in EntryNavRail.module.css). The head of the list whose status is asked for
 * before the scroll observer has reported; the observer corrects it a frame
 * later.
 */
const RECENT_STATUS_HEAD_ROWS = 11;

function readStoredRecentOpen(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    // Default OPEN: the section is new and a collapsed-by-default disclosure
    // reads as a missing feature.
    return window.localStorage.getItem(RECENT_SECTION_STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

/**
 * 最近浏览过 — a collapsible list of the projects the 全部项目 view's own
 * 最近浏览过 tab would show, sitting under 插件 in the rail (per product).
 *
 * It takes the catalog EntryShell already feeds that grid and shows the head of
 * it in the same order (most recently touched first), so the rail and the grid
 * can never disagree about what "recent" means. Rows open the project through
 * the same pull-first opener the grid uses.
 */
export function RailRecentSection({
  projects,
  onOpen,
  onRename,
  onDelete,
  onDuplicate,


  analyticsPage,
  label,
  activeProjectId,
  activeConversationId,
  activeFileName,
}: {
  projects: Project[];
  onOpen?: (id: string) => void | Promise<unknown>;
  onRename?: (id: string, name: string) => void;
  onDelete?: (id: string) => Promise<boolean | void> | boolean | void;
  onDuplicate?: (id: string) => Promise<void> | void;


  analyticsPage: TrackingWorkspacePage;
  label: string;
  activeProjectId?: string | null;
  activeConversationId?: string | null;
  activeFileName?: string | null;
}) {
  const [open, setOpen] = useState(readStoredRecentOpen);
  // The row actions report under the project-collection page the rail is
  // standing on; every other entry view files under Home, where the rail's
  // list is the recent-projects surface.
  const collectionPage: TrackingProjectCollectionPage =
    analyticsPage === 'drafts' || analyticsPage === 'all_projects' ? analyticsPage : 'home';
  // The same gates the project cards apply (RecentProjectsStrip): a move needs
  // a team plane to move into AND the right to share, and only the member's
  // own projects can be changed at all.


  // 删除 confirms through the shared project delete dialog (OPEND-2797) — one
  // component for the rail and the project cards.
  const deleteFlow = useProjectDeleteFlow({
    onDelete,
    analyticsPage: collectionPage,

  });
  const duplicateFlow = useProjectDuplicateFlow({
    onDuplicate,
    analyticsPage: collectionPage,

  });
  // 转入团队空间 runs the flow the project cards run, confirmation dialog
  // included. Its progress and failure show in the row's ⋮ menu — the card
  // menu is where the cards report theirs — so the section re-opens that menu
  // once the request is on its way and closes it again on success.


  // Every recent project, newest first (OPEND-2757: the old 8-row cap hid the
  // rest from the rail entirely). The LIST scrolls once it has used the height
  // the rail leaves it, not the rail — see `.recentList`.
  const items = useMemo(
    () => [...projects].sort((a, b) => b.updatedAt - a.updatedAt),
    [projects],
  );
  // Run status for the rows' leading glyph. `Project.status` cannot serve it —
  // it only arrives on the UNSCOPED project list, so it is absent for every
  // workspace-bound project (see the hook's own note) — and this is the same
  // feed, with the same display mapping (✓-spending included), that the
  // workspace tab dropdown reads, which is what keeps the two glyph columns
  // telling one story about a project (OPEND-2795).
  const recentListRef = useRef<HTMLUListElement>(null);
  // Keep the full catalog navigable, but poll only rows intersecting its
  // scrollport. The list's scrollport bounds the status request set.
  // Visibility belongs to a particular identity and catalog. An empty catalog
  // removes the list DOM without unmounting this component, so an observer
  // callback cannot be relied on to retire the previous catalog's IDs.
  const visibilityScope = JSON.stringify([
    'local',
    items.map((project) => project.id).sort(),
  ]);
  const [visibleProjects, setVisibleProjects] = useState<{
    scope: string;
    ids: string[];
  } | null>(null);
  useEffect(() => {
    const list = recentListRef.current;
    if (!open || !list || typeof IntersectionObserver === 'undefined') return;
    let active = true;
    const visible = new Set<string>();
    const observer = new IntersectionObserver((entries) => {
      if (!active) return;
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.projectId;
        if (!id) continue;
        if (entry.isIntersecting) visible.add(id);
        else visible.delete(id);
      }
      const next = [...visible].sort();
      setVisibleProjects((prev) =>
        prev?.scope === visibilityScope
          && prev.ids.length === next.length
          && prev.ids.every((id, index) => id === next[index])
          ? prev
          : { scope: visibilityScope, ids: next });
    }, { root: list });
    for (const row of list.children) observer.observe(row);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [items, open, visibilityScope]);
  // Until the observer has spoken, ask for the head of the list — the rows the
  // cap shows on a desktop window — in the same commit that paints them
  // (OPEND-2762). The observer's first report lands a frame later, and waiting
  // for it is what left the rows a round trip ahead of their glyphs.
  const runStatusProjectIds = useMemo(
    () => visibleProjects?.scope === visibilityScope
      ? visibleProjects.ids
      : items.slice(0, RECENT_STATUS_HEAD_ROWS).map((project) => project.id),
    [visibleProjects, visibilityScope, items],
  );
  const runStatusByProjectId = useProjectRunStatuses(runStatusProjectIds, {
    enabled: open,

  });

  // Opening a project is what spends its ✓ (per product): the finished run on
  // screen is recorded as seen — in the shared feed, so the tab switcher drops
  // the mark in the same moment.
  const openProject = useCallback(
    (id: string) => {
      acknowledgeProjectCompletion(id);
      return onOpen?.(id);
    },
    [onOpen],
  );

  function toggle() {
    setOpen((wasOpen) => {
      const next = !wasOpen;
      try {
        window.localStorage.setItem(RECENT_SECTION_STORAGE_KEY, String(next));
      } catch {
        // Private mode / storage disabled: the section still toggles, it just
        // forgets. Never let a storage failure swallow the interaction.
      }
      return next;
    });
  }

  // Nothing to list is not an empty state worth a row: a workspace with no
  // projects yet should see the rail it had before this section existed.
  if (items.length === 0) return null;

  return (
    <div className={styles.recent}>
      <Button
        variant="ghost"
        type="button"
        className={styles.recentHead}
        onClick={toggle}
        aria-expanded={open}
        data-testid="entry-nav-recent-toggle"
      >
        {/* Title first, chevron trailing (per product: 展开和收起的按钮在最右侧).
            DOM order follows the visual one rather than an `order` swap, so the
            reading order matches too. */}
        <span className={styles.recentTitle}>{label}</span>
        <span className={styles.recentChevron} aria-hidden>
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} />
        </span>
      </Button>
      {/* The canonical disclosure pair (index.css / composio.css): the outer
          grid animates 0fr → 1fr, the inner box carries the clip. `hidden` on
          the wrapper would skip the transition entirely. */}
      <div className={`${styles.recentDisclosure} accordion-collapsible${open ? ' open' : ''}`}>
        <div className="accordion-collapsible-inner">
          <ul ref={recentListRef} className={`${styles.recentList} entry-nav-rail__recent-list`}>
            {items.map((project) => {
              return (
                <li key={project.id} data-project-id={project.id}>
                  <ProjectConversationGroup project={project}
                    activeProjectId={activeProjectId} activeConversationId={activeConversationId}
                    activeFileName={activeFileName}>
                  <RailRecentRow
                    project={project}

                    runStatus={runStatusByProjectId.get(project.id)}


                    runId={project.status?.runId}
                    onOpen={openProject}
                    onRename={onRename}
                    onDuplicate={onDuplicate ? (target) => { void duplicateFlow.duplicate(target); } : undefined}

                    onDelete={onDelete ? deleteFlow.request : undefined}
                  />
                  </ProjectConversationGroup>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      <ProjectDeleteConfirmDialog
          projectName={deleteFlow.target?.name ?? null}
          keepsFolder={Boolean(deleteFlow.target?.metadata?.baseDir)}
          pending={deleteFlow.pending}
          failed={deleteFlow.failed}
          errorCode={deleteFlow.errorCode}
          onCancel={deleteFlow.cancel}
          onConfirm={() => void deleteFlow.commit()}
        />

    </div>
  );
}

/**
 * The spark mark the free plan's upgrade pill leads with (supplied artwork).
 *
 * Inlined rather than added to the shared icon set: it is the only place this
 * glyph appears, and it is a two-part mark (a large four-point star with a
 * small one trailing it) that the set's single-path convention would flatten.
 * `fill="currentColor"` is what lets the pill's `--upgrade-ink` reach it.
 */


/**
 * Whether the entry layout has auto-collapsed the rail for a narrow window
 * (`@media (max-width: 1080px)` in entry-layout.css zeroes the rail track while
 * keeping `entry--rail-open`). The account module lives in that rail, so
 * anything that must stay reachable in a compact window — the update-ready
 * rocket — has to know when the rail is off screen. jsdom has no matchMedia;
 * treat that as a wide window.
 */


export function EntryNavRail({
  view,
  onViewChange,
  onNewProject,
  onOpenSearch,
  newProjectDisabled,
  open,
  onToggleRail,
  topRightSlot,


  onOpenSettings,

  updaterSlot,
  footerNotice,
  recentProjects,
  onOpenRecentProject,
  onRenameRecentProject,
  onDeleteRecentProject,
  onDuplicateRecentProject,
  activeProjectId,
  activeConversationId,
  activeFileName,
}: Props) {

  const { t } = useI18n();
  const analytics = useAnalytics();
  const analyticsPage = entryViewToTracking(view ?? 'project');
  // Portal target for the account module, which `EntryTopRightCluster` owns
  // but renders down here. State, not a ref: the cluster has to re-render once
  // the node exists or the portal would have nowhere to land on first paint.

  // #5517 renamed the rail's first item from 最近 (Recents) to 首页 (Home) —
  // the key keeps its historical name, the VALUE now reads Home in every
  // locale (polish round 2, ref 1db2d00c2).
  const homeLabel = t('entry.navRecents');
  const isHome = view === 'home';


  const selectView = (next: EntryView) => {
    trackEntryNavigationClick(analytics.track, {
      page_name: analyticsPage,
      area: 'entry_nav',
      element: 'nav_item',
      target: entryViewToTracking(next),
      entry_from: 'sidebar',
    });
    onViewChange(next);
  };

  // Only the expanded content becomes inert: the header's expand control
  // remains reachable in the compact rail.
  const contentRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = contentRef.current;
    if (!node) return;
    if (open) {
      node.removeAttribute('inert');
    } else {
      node.setAttribute('inert', '');
    }
  }, [open]);


  // The account-directory event is delivered through the already-shared local
  // Workspace EventSource. It stays mounted while the switcher is closed, so a
  // remote create/join/rename/removal updates the cached list immediately. A
  // reconnect/foreground edge also re-reads once to close a missed-event gap;
  // this is event-driven catch-up, not a timer.


  // This rail can outlive the identity that filled its list: an account swap
  // (sign out, sign in as someone else) does not necessarily unmount it, and
  // then component state would keep the previous account's names even though the
  // module cache is re-attributed on every read.
  //
  // So on each identity change, re-derive the list from the cache UNDER THE
  // INCOMING IDENTITY. A list the new identity can claim survives (the common
  // case: the same account moving between its own workspaces); one it cannot is
  // dropped, and the next open refetches. Re-deriving on the identity edge — not
  // on every render where attribution happens to fail — is what keeps a freshly
  // read list stable afterwards instead of being cleared again on the next pass.


  return (
    <nav
      className={`${styles.rail} entry-nav-rail${open ? ' is-open' : ''}`}
      aria-label={t('entry.primaryNavAria')}
    >
      <div className={styles.panel}>
      <div className={styles.header}>
        <Button variant="ghost" className={styles.brand} onClick={() => selectView('home')} aria-label={PRODUCT_NAME}>
          <svg width="24" height="24" viewBox="0 0 40 40" fill="none" aria-hidden="true">
            <path fill="currentColor" fillRule="evenodd" d="M6 6h17v5h5v12h-5v5H13v8H6V6Zm7 7v8h8v-8h-8Z" />
            <path className={styles.brandPixel} d="M29 3h7v7h-7z" />
          </svg>
          <span>{PRODUCT_NAME}</span>
        </Button>
        <Button
          variant="ghost"
          className={`${styles.toggle} pixo-tooltip`}
          onClick={onToggleRail}
          aria-label={open ? t('entry.navCollapse') : t('entry.navExpand')}
          aria-expanded={open}
          aria-controls="entry-nav-rail-content"
          aria-keyshortcuts={isMacPlatform() ? 'Meta+B' : 'Control+B'}
          data-tooltip={`${open ? t('entry.navCollapse') : t('entry.navExpand')} ${isMacPlatform() ? '⌘B' : 'Ctrl+B'}`}
          data-tooltip-placement="right"
          data-testid="entry-nav-rail-toggle"
        >
          <Icon name="layout-left" size={16} className={`${styles.toggleGlyph}${open ? ` ${styles.currentGlyph}` : ''}`} />
          <Icon name="layout-right" size={16} className={`${styles.toggleGlyph}${open ? '' : ` ${styles.currentGlyph}`}`} />
        </Button>
      </div>
      <div
        ref={contentRef}
        id="entry-nav-rail-content"
        className={`${styles.body}${open ? ` ${styles.bodyOpen}` : ''}`}
        aria-hidden={open ? undefined : true}
      >
      <div className={styles.group}>
        {/* Primary actions first, the way a desktop-app sidebar leads: make
            something new, then find something. */}
        <div className={styles.actions}>
          <Button
            variant="ghost"
            className={styles.newGame}
            onClick={onNewProject}
            disabled={newProjectDisabled}
            data-testid="entry-nav-new-game"
          >
            <span className={styles.newGameIcon} aria-hidden><Icon name="plus" size={14} /></span>
            <span className={styles.navLabel}>{t('entry.navNewGame')}</span>
          </Button>
          <Button
            variant="ghost"
            className={`${styles.navButton} entry-nav-rail__btn`}
            aria-label={t('common.search')}
            aria-keyshortcuts={isMacPlatform() ? 'Meta+K' : 'Control+K'}
            data-testid="entry-nav-search-item"
            onClick={() => {
              trackEntryNavigationClick(analytics.track, {
                page_name: analyticsPage,
                area: 'entry_nav',
                element: 'search',
                target: 'search',
                entry_from: 'sidebar',
              });
              onOpenSearch?.();
            }}
          >
            <span className={styles.navIcon} aria-hidden><Icon name="search" size={16} /></span>
            <span className={styles.navLabel}>{t('common.search')}</span>
            <kbd className={styles.shortcut} aria-hidden>{isMacPlatform() ? '⌘ K' : 'Ctrl K'}</kbd>
          </Button>
        </div>
        {/* Destinations only — places the main column can show. Settings and
            keyboard shortcuts are actions and ride the account row below. */}
        <div className={styles.destinations} data-testid="entry-nav-destinations">
          <NavButton
            active={isHome}
            ariaLabel={homeLabel}
            label={homeLabel}
            onClick={() => selectView('home')}
            testId="entry-nav-home"
          >
            <Icon name="home" size={16} />
          </NavButton>
          {/* 我的游戏 is the local project list (OPEND-3140): 草稿 folds to the
              whole local catalog without a workspace. */}
          <NavButton
            active={view === 'drafts'}
            ariaLabel={t('entry.navDrafts')}
            label={t('workspaceSwitcher.draftsTooltip')}
            onClick={() => selectView('drafts')}
            testId="entry-nav-drafts"
          >
            <Icon name="file" size={16} />
          </NavButton>
          <NavButton active={view === 'store'} ariaLabel={t('store.title')} label={t('store.title')}
            onClick={() => selectView('store')} testId="entry-nav-store"><Icon name="blocks" size={16} /></NavButton>
        </div>
        {/* 最近 takes every pixel the rail has left and scrolls inside itself.
            The catalog EntryShell hands over IS the local project list, so the
            rows, the run-status feed (the daemon answers a headerless read for
            an unbound project) and the ✓-spending match the project grids. */}
        <RailRecentSection
          projects={recentProjects ?? []}
          onOpen={onOpenRecentProject}
          onRename={onRenameRecentProject}
          onDelete={onDeleteRecentProject}
          onDuplicate={onDuplicateRecentProject}
          analyticsPage={analyticsPage}
          label={t('entry.navRecent')}
          activeProjectId={activeProjectId}
          activeConversationId={activeConversationId}
          activeFileName={activeFileName}
        />
      </div>
      <div className={styles.footer}>
        {footerNotice}
        {/* Local account dock (OPEND-3140): the identity row is the rail's
            last line. Opening the identity lands in Settings, where the local
            CLI / BYOK configuration lives; the gear and the help menu ride the
            same row so the rail foot is one line of controls. */}
        <div
          className={styles.accountDock}
          data-testid="entry-nav-local-account-dock"
        >
          <AccountChip
            onOpenSettings={(section) => {
                trackAccountMenuClick(analytics.track, {
                  page_name: analyticsPage,
                  area: 'account_menu',
                  element: 'settings',
                });
                onOpenSettings?.(section);
            }}
            trailing={(
              <span className={styles.dockActions}>
                <Button
                  variant="ghost"
                  size="icon"
                  className={`${styles.dockButton} pixo-tooltip`}
                  aria-label={t('entry.accountSettings')}
                  data-tooltip={t('entry.accountSettings')}
                  data-testid="entry-settings-button"
                  onClick={() => {
                    trackAccountMenuClick(analytics.track, {
                      page_name: analyticsPage,
                      area: 'account_menu',
                      element: 'settings',
                    });
                    onOpenSettings?.();
                  }}
                >
                  <Icon name="settings" size={16} />
                </Button>
                <RailHelpMenu page={analyticsPage} />
              </span>
            )}
          />
        </div>
      </div>
      </div>
      </div>

      {open ? <RailResizeHandle /> : null}

      {/* Keep updater and local account actions in the native chrome host. */}
      <WorkspaceTopRightAccountCluster updaterSlot={updaterSlot} />
    </nav>
  );
}

export function WorkspaceTopRightAccountCluster({ updaterSlot }: { updaterSlot?: ReactNode; onOpenSettings?: (section?: EntrySettingsSection) => void }) {
  const [host, setHost] = useState(workspaceChromeAccountActionsHost);
  const slotRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const syncHost = () => setHost(workspaceChromeAccountActionsHost());
    syncHost();
    const observer = new MutationObserver(syncHost);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const slot = slotRef.current;
    if (!slot) return;
    const sync = () => setVisible(slot.hasChildNodes());
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(slot, { childList: true });
    return () => observer.disconnect();
  }, [host, updaterSlot]);
  return host ? createPortal(
    <div className={visible ? 'entry-top-right-cluster' : undefined}>
      <div ref={slotRef} className="entry-nav-rail__account-updater"
        data-testid={visible ? 'entry-nav-account-updater' : undefined}>{updaterSlot}</div>
    </div>, host,
  ) : null;
}

interface NavButtonProps {
  active?: boolean;
  ariaLabel: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
  /** Rail items that own a popup surface expose the button so the surface can
   *  return focus here on close, and advertise the popup's kind + open state. */
  buttonRef?: Ref<HTMLButtonElement>;
  ariaHasPopup?: 'dialog' | 'menu';
  ariaExpanded?: boolean;
  children: ReactNode;
}
