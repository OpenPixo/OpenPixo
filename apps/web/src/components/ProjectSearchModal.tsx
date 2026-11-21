// Project search palette — opened from the nav rail's 搜索 row or Ctrl K / ⌘K.
// A blurred full-screen backdrop over a command-palette card: type to filter
// games by name and the app's main actions by label, ↑/↓ and Enter to open,
// and when nothing matches, hand the typed text to the agent as a new game.
// Portaled to <body> so the blur covers the whole app and the card isn't
// clipped by the rail.
//
// Ported from #5517; the project list and the open handler come from
// EntryShell's REAL merged catalog (own projects + team-shared cards), so a
// not-yet-pulled shared project opens through the same pull-first path as the
// All Projects grid.
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@openpixo/components';
import type { Project } from '../types';
import { Icon, type IconName } from './Icon';
import { useT } from '../i18n';
import { navigate } from '../router';
import { relativeTimeLong } from '../utils/chatTime';
import { requestEntryNewGame } from './entryRailBridge';
import { projectCover, projectCategory } from './RecentProjectsStrip';
import styles from './ProjectSearchModal.module.css';

interface Props {
  projects: Project[];

  onOpenProject: (id: string) => Promise<boolean> | Promise<void> | boolean | void;
  onClose: () => void;
  /**
   * Start a new game from the typed text, through the same path Home uses for
   * a typed idea. Absent, the no-results state offers no agent button.
   */
  onAskAgent?: (text: string) => void;
}

interface SearchAction {
  id: string;
  icon: IconName;
  title: string;
  secondary: string;
  run: () => void;
}

type SearchEntry =
  | { kind: 'project'; key: string; project: Project }
  | { kind: 'action'; key: string; action: SearchAction };

/**
 * Search spans both personal drafts and the shared workspace catalog. Shared
 * cards win if a project temporarily appears in both lists because they carry
 * the authoritative workspace-facing title and metadata.
 */
export function buildProjectSearchCatalog(
  draftProjects: readonly Project[],
  sharedProjects: readonly Project[],
): Project[] {
  const projectsById = new Map<string, Project>();
  for (const project of draftProjects) projectsById.set(project.id, project);
  for (const project of sharedProjects) projectsById.set(project.id, project);
  return [...projectsById.values()];
}

function Kbd({ children }: { children: string }) {
  return <kbd className={styles.kbd}>{children}</kbd>;
}

export function ProjectSearchModal({
  projects,

  onOpenProject,
  onClose,
  onAskAgent,
}: Props) {
  const t = useT();
  const [query, setQuery] = useState('');
  // Keyboard-driven selection: the palette is opened by ⌘K and typed into, so
  // the hands are already on the keys — ↑/↓ move the highlight and Enter opens
  // it, without ever leaving the input (which keeps typing responsive).
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const resultsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // The rail's own destinations, reached the way the rail reaches them.
  const actions = useMemo<SearchAction[]>(() => [
    {
      id: 'new-game',
      icon: 'plus',
      title: t('entry.navNewGame'),
      secondary: t('projectSearch.actionNewGameHint'),
      run: () => {
        requestEntryNewGame();
        navigate({ kind: 'home', view: 'home' });
      },
    },
    {
      id: 'generate',
      icon: 'sparkles',
      title: t('projectSearch.actionGenerate'),
      secondary: t('projectSearch.actionGenerateHint'),
      run: () => navigate({ kind: 'home', view: 'generate' }),
    },
    {
      id: 'my-games',
      icon: 'file',
      title: t('workspaceSwitcher.draftsTooltip'),
      secondary: t('projectSearch.actionMyGamesHint'),
      run: () => navigate({ kind: 'home', view: 'drafts' }),
    },
    {
      id: 'store',
      icon: 'blocks',
      title: t('store.title'),
      secondary: t('store.subtitle'),
      run: () => navigate({ kind: 'home', view: 'store' }),
    },
  ], [t]);

  const trimmedQuery = query.trim();

  const { gameEntries, actionEntries } = useMemo(() => {
    const sorted = [...projects].sort((a, b) => b.updatedAt - a.updatedAt);
    const q = trimmedQuery.toLowerCase();
    const games = q.length === 0
      ? sorted
      : sorted.filter((p) => (p.name || '').toLowerCase().includes(q));
    // With no query the palette is a recent-games switcher; actions join it
    // when the user types, or when there are no games to switch to yet.
    const matchedActions = q.length === 0
      ? (projects.length === 0 ? actions : [])
      : actions.filter((action) =>
        action.title.toLowerCase().includes(q) || action.secondary.toLowerCase().includes(q));
    return {
      gameEntries: games.map<SearchEntry>((project) => ({ kind: 'project', key: project.id, project })),
      actionEntries: matchedActions.map<SearchEntry>((action) => ({ kind: 'action', key: `action:${action.id}`, action })),
    };
  }, [actions, projects, trimmedQuery]);

  const entries = useMemo(() => [...gameEntries, ...actionEntries], [gameEntries, actionEntries]);

  // A new query re-ranks the list, so the old index would point at an
  // unrelated row (or past the end) — always restart at the top match.
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Follow the highlight when it walks past the visible window.
  useEffect(() => {
    const container = resultsRef.current;
    const active = container?.querySelector<HTMLElement>('[data-active="true"]');
    active?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, entries.length]);

  const openProject = (id: string) => {
    void onOpenProject(id);
    onClose();
  };

  const runAction = (action: SearchAction) => {
    onClose();
    action.run();
  };

  const askAgent = () => {
    if (!onAskAgent || trimmedQuery.length === 0) return;
    onClose();
    onAskAgent(trimmedQuery);
  };

  const activate = (entry: SearchEntry) => {
    if (entry.kind === 'project') openProject(entry.project.id);
    else runAction(entry.action);
  };

  const onInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (entries.length === 0) {
      if (event.key === 'Enter' && onAskAgent && trimmedQuery.length > 0) {
        event.preventDefault();
        askAgent();
      }
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % entries.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + entries.length) % entries.length);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const target = entries[Math.min(activeIndex, entries.length - 1)];
      if (target) activate(target);
    }
  };

  const renderRow = (entry: SearchEntry, index: number) => {
    const active = index === activeIndex;
    const rowClass = [
      styles.item,
      'project-search-item',
      active ? `${styles.itemActive} is-active` : '',
    ].filter(Boolean).join(' ');
    const enterMark = <span className={styles.enterMark} aria-hidden><Kbd>↵</Kbd></span>;

    if (entry.kind === 'action') {
      const { action } = entry;
      return (
        <button
          key={entry.key}
          type="button"
          className={rowClass}
          role="option"
          aria-selected={active}
          data-active={active ? 'true' : undefined}
          onMouseEnter={() => setActiveIndex(index)}
          onClick={() => runAction(action)}
          data-testid={`project-search-action-${action.id}`}
        >
          <span className={styles.actionIcon} aria-hidden>
            <Icon name={action.icon} size={15} />
          </span>
          <span className={styles.text}>
            <span className={`${styles.name} project-search-item-name`}>{action.title}</span>
            <span className={styles.secondary}>{action.secondary}</span>
          </span>
          <span className={styles.hint}>{enterMark}</span>
        </button>
      );
    }

    const { project } = entry;
    const cover = projectCover(project, null);
    const showImage = (cover.kind === 'image' || cover.kind === 'logo') && Boolean(cover.src);
    const category = projectCategory(project) === 'media' ? t('designs.tagMedia') : t('designs.tagPrototype');
    return (
      <button
        key={entry.key}
        type="button"
        className={rowClass}
        role="option"
        aria-selected={active}
        data-active={active ? 'true' : undefined}
        onMouseEnter={() => setActiveIndex(index)}
        onClick={() => openProject(project.id)}
        data-testid={`project-search-item-${project.id}`}
      >
        <span className={styles.thumb} style={cover.style} aria-hidden>
          {showImage ? (
            <img src={cover.src} alt="" loading="lazy" />
          ) : (
            <span className={styles.glyph}>{cover.initial}</span>
          )}
        </span>
        <span className={styles.text}>
          <span className={`${styles.name} project-search-item-name`}>
            {project.name || t('chat.untitledConversation')}
          </span>
          <span className={styles.secondary}>{category}</span>
        </span>
        <span className={styles.hint}>
          {relativeTimeLong(project.updatedAt, t)}
          {enterMark}
        </span>
      </button>
    );
  };

  // Up to three actions to offer when nothing matched.
  const suggestions = actions.slice(0, 3);

  return createPortal(
    <div
      className={`${styles.backdrop} project-search-backdrop`}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={`${styles.modal} project-search-modal`}
        role="dialog"
        aria-modal="true"
        aria-label={t('common.search')}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={styles.inputRow}>
          <Icon name="search" size={16} />
          <input
            ref={inputRef}
            type="text"
            className={styles.input}
            value={query}
            placeholder={t('projectSearch.placeholder')}
            aria-label={t('common.search')}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onInputKeyDown}
            data-testid="project-search-input"
          />
          <span className={styles.escKey} aria-hidden><Kbd>esc</Kbd></span>
        </div>
        <div
          className={`${styles.results} project-search-results`}
          role="listbox"
          aria-label={t('common.search')}
          ref={resultsRef}
        >
          {entries.length === 0 ? (
            <div className={styles.empty} data-testid="project-search-empty">
              <span className={styles.emptyIcon} aria-hidden>
                <Icon name="search" size={18} />
              </span>
              <div className={styles.emptyTitle}>
                {t('projectSearch.noResultsTitle', { query: trimmedQuery })}
              </div>
              <div className={styles.emptyBody}>
                {onAskAgent ? t('projectSearch.noResultsBody') : t('projectSearch.noResultsBodyPlain')}
              </div>
              {onAskAgent ? (
                <Button
                  variant="primary"
                  className={styles.askAgent}
                  onClick={askAgent}
                  data-testid="project-search-ask-agent"
                >
                  <Icon name="sparkles" size={14} />
                  <span className={styles.askAgentLabel}>
                    {t('projectSearch.askAgent', { query: trimmedQuery })}
                  </span>
                </Button>
              ) : null}
              <div className={styles.suggestions}>
                <span className={styles.suggestionsLabel}>{t('projectSearch.suggestions')}</span>
                {suggestions.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    className={styles.chip}
                    onClick={() => runAction(action)}
                    data-testid={`project-search-suggestion-${action.id}`}
                  >
                    <Icon name={action.icon} size={12} />
                    {action.title}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {gameEntries.length > 0 ? (
                <div className={styles.group} role="group" aria-label={t('projectSearch.groupGames')}>
                  <div className={styles.groupHeading} aria-hidden>{t('projectSearch.groupGames')}</div>
                  {gameEntries.map((entry, index) => renderRow(entry, index))}
                </div>
              ) : null}
              {actionEntries.length > 0 ? (
                <div className={styles.group} role="group" aria-label={t('projectSearch.groupActions')}>
                  <div className={styles.groupHeading} aria-hidden>{t('projectSearch.groupActions')}</div>
                  {actionEntries.map((entry, index) => renderRow(entry, gameEntries.length + index))}
                </div>
              ) : null}
            </>
          )}
        </div>
        <div className={styles.footer} aria-hidden>
          <span className={styles.footerHint}><Kbd>↵</Kbd>{t('projectSearch.hintOpen')}</span>
          <span className={styles.footerHint}><Kbd>↑</Kbd><Kbd>↓</Kbd>{t('projectSearch.hintSelect')}</span>
          <span className={styles.footerHint}><Kbd>esc</Kbd>{t('projectSearch.hintClose')}</span>
          {entries.length > 0 ? (
            <span className={styles.count}>
              {t('projectSearch.resultCount', { count: entries.length })}
            </span>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
