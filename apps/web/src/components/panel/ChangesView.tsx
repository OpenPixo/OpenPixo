import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, SegmentedTabs, VisuallyHidden } from '@openpixo/components';
import type { CheckpointUnavailableReason } from '@openpixo/contracts';
import { RotateCcw } from 'lucide-react';
import { useT } from '../../i18n';
import type { Dict } from '../../i18n/types';
import { projectFileUrl } from '../../providers/registry';
import { isGalleryImagePath } from '../../runtime/chat/turn-assets';
import type { ChatMessage, ProjectFile } from '../../types';
import { CheckpointRestoreConfirm } from '../checkpoints/CheckpointRestoreConfirm';
import { changeImages, changeStatusLetter, unseenCount, type ChangeRow, type ChangeScope } from '../changes/changes-model';
import { useProjectChanges, type LineCounts } from '../changes/useProjectChanges';
import changes from '../changes/Changes.module.css';
import { Icon } from '../Icon';
import { changeDiffItem } from './panel-nav';
import toolbar from './ViewToolbar.module.css';

const UNAVAILABLE_REASONS: Record<CheckpointUnavailableReason, keyof Dict> = {
  not_git: 'checkpoint.notGit', git_unavailable: 'checkpoint.gitUnavailable', not_project_root: 'checkpoint.notProjectRoot',
  unsupported_repository: 'checkpoint.unsupported', repository_unavailable: 'checkpoint.unavailable', project_too_large: 'checkpoint.tooLarge',
};

export interface ChangesViewProps {
  projectId: string;
  /** The root is hidden (another view is shown, or a viewer is pushed on 改动). */
  hidden: boolean;
  /** 改动 is the panel's current view (root or a pushed viewer): what it lists counts as seen. */
  active?: boolean;
  conversationId?: string | null;
  messages?: readonly ChatMessage[];
  runInFlight?: boolean;
  /** The daemon's file-event refresh key. */
  refreshKey?: number;
  files?: readonly ProjectFile[];
  resolvedDir?: string | null;
  viewerOnly?: boolean;
  /** Sits at the end of the toolbar: the snapshot history. */
  toolbarActions?: ReactNode;
  /** Push an item (a `diff:` viewer or a file) onto 改动's stack. */
  onOpenItem?: (item: string) => void;
  /** The 改动 badge: latest-run paths not yet seen here. */
  onBadgeChange?: (count: number) => void;
}

/**
 * 改动 view root (specs/current/openpixo-game-panel.md §5): what the agent
 * changed in the latest turn (本轮) or across the conversation (本会话), from
 * the project's checkpoints, with the turn's images on top and 撤销这一轮
 * through the existing restore confirmation. Rows push a diff (text) or a
 * before/after (image) viewer onto this view's stack.
 */
export function ChangesView({
  projectId,
  hidden,
  active = !hidden,
  conversationId,
  messages = EMPTY_MESSAGES,
  runInFlight = false,
  refreshKey = 0,
  files = EMPTY_FILES,
  resolvedDir,
  viewerOnly = false,
  toolbarActions,
  onOpenItem,
  onBadgeChange,
}: ChangesViewProps) {
  const t = useT();
  const [scope, setScope] = useState<ChangeScope>('run');
  const data = useProjectChanges({ projectId, conversationId, messages, runInFlight, refreshKey });
  const { list, runCheckpoint, runMessage } = data;
  const runId = runMessage?.runId ?? null;

  // ── Badge (spec §5): latest-run paths that appeared since 改动 was last open.
  // A run that had already finished when this view first saw it counts as seen.
  const [seen, setSeen] = useState<{ runId: string | null; paths: ReadonlySet<string> }>({ runId: null, paths: EMPTY_SET });
  useEffect(() => {
    if (!list || seen.runId === runId) return;
    setSeen({ runId, paths: runInFlight ? EMPTY_SET : new Set(data.runPaths) });
  }, [list, runId, runInFlight, data.runPaths, seen.runId]);
  useEffect(() => {
    if (!active || seen.runId !== runId) return;
    if (data.runPaths.every((path) => seen.paths.has(path))) return;
    setSeen({ runId, paths: new Set([...seen.paths, ...data.runPaths]) });
  }, [active, runId, data.runPaths, seen]);
  const badge = active || seen.runId !== runId ? 0 : unseenCount(data.runPaths, seen.paths);
  const onBadgeChangeRef = useRef(onBadgeChange);
  onBadgeChangeRef.current = onBadgeChange;
  useEffect(() => { onBadgeChangeRef.current?.(badge); }, [badge]);

  // ── Images: the chat gallery's rule over this turn's / this conversation's messages.
  const fileNames = useMemo(() => new Set(files.map((file) => file.name)), [files]);
  const recordScope = useMemo(() => ({ projectId, projectFileNames: fileNames, projectResolvedDir: resolvedDir ?? null }), [projectId, fileNames, resolvedDir]);
  const imageMessages = useMemo(() => (scope === 'run' ? (runMessage ? [runMessage] : []) : messages), [scope, runMessage, messages]);
  const images = useMemo(() => changeImages(imageMessages, recordScope), [imageMessages, recordScope]);
  const mtimes = useMemo(() => new Map(files.map((file) => [file.name, file.mtime])), [files]);

  const rows = scope === 'run' ? data.runRows : data.sessionRows;
  const rowsByPath = useMemo(() => new Map(rows.map((row) => [row.path, row])), [rows]);
  const counts = scope === 'run' ? data.counts : EMPTY_COUNTS;
  const totals = useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const row of rows) {
      const count = counts.get(row.path);
      // Binary files have no line counts, and a total that skips them would still read true.
      if (!count) return null;
      added += count.additions ?? 0;
      removed += count.deletions ?? 0;
    }
    return rows.length ? { added, removed } : null;
  }, [counts, rows]);

  const openRow = (row: ChangeRow) => {
    const count = counts.get(row.path);
    const binaryNonImage = count && count.additions === null && !isGalleryImagePath(row.path);
    onOpenItem?.(binaryNonImage && row.status !== 'deleted' ? row.path : changeDiffItem(row.checkpointId, row.path));
  };
  const openImage = (path: string) => {
    const row = rowsByPath.get(path);
    onOpenItem?.(row ? changeDiffItem(row.checkpointId, row.path) : path);
  };

  // ── 撤销这一轮: the existing restore flow and its confirmation.
  const undoAnchor = useRef<HTMLButtonElement>(null);
  const [undoOpen, setUndoOpen] = useState(false);
  const [restored, setRestored] = useState(false);
  const busy = list?.status === 'available' && list.busy;
  const noRunChanges = runCheckpoint?.runChanges?.length === 0;

  const unavailable = list?.status === 'unavailable' ? list : null;
  const nothingYet = !runMessage && images.length === 0 && rows.length === 0 && !unavailable;
  let filesNotice: string | null = null;
  if (!unavailable && list && rows.length === 0) {
    if (scope === 'run' && runMessage && !runCheckpoint && !runInFlight) filesNotice = t('panel.changes.noCheckpoint');
    else if (scope === 'run' && runCheckpoint) filesNotice = t('panel.changes.noRunFiles');
    else if (scope === 'session') filesNotice = t('panel.changes.noSessionFiles');
  }

  return (
    <div className={toolbar.view} hidden={hidden} data-testid="panel-changes-view">
      <div className={toolbar.toolbar}>
        <SegmentedTabs
          className={changes.scopeSwitch}
          label={t('panel.changes.scope')}
          value={scope}
          onValueChange={(next) => setScope(next as ChangeScope)}
          items={[
            { value: 'run', label: t('panel.changes.scopeRun'), id: `panel-changes-run-${projectId}` },
            { value: 'session', label: t('panel.changes.scopeSession'), id: `panel-changes-session-${projectId}` },
          ]}
        />
        <span className={toolbar.spacer} />
        {data.live ? <span className={changes.live} role="status">{t('panel.changes.live')}</span> : null}
        {runCheckpoint && !viewerOnly ? (
          <Button
            ref={undoAnchor}
            size="sm"
            variant="ghost"
            className={changes.undo}
            data-testid="panel-changes-undo"
            disabled={busy || noRunChanges}
            title={busy ? t('checkpoint.busy') : noRunChanges ? t('panel.changes.undoDisabledNoChanges') : undefined}
            aria-haspopup="dialog"
            aria-expanded={undoOpen}
            onClick={() => { setRestored(false); setUndoOpen(true); }}
          >
            <RotateCcw size={13} aria-hidden="true" />
            {t('panel.changes.undo')}
          </Button>
        ) : null}
        {toolbarActions}
      </div>
      {restored ? <VisuallyHidden role="status">{t('panel.changes.restored')}</VisuallyHidden> : null}
      {hidden ? null : nothingYet ? (
        <div className={toolbar.empty}>
          <Icon name="history" size={20} />
          <p className={toolbar.emptyTitle}>{t('panel.changes.emptyTitle')}</p>
          <p className={toolbar.emptyBody}>{t('panel.changes.emptyBody')}</p>
        </div>
      ) : (
        <div className={changes.body}>
          {unavailable ? (
            <section className={changes.section} data-testid="panel-changes-unavailable">
              <p className={changes.noticeTitle}>{t('panel.changes.unavailableTitle')}</p>
              <p className={changes.notice}>{t(UNAVAILABLE_REASONS[unavailable.reason])}</p>
              {images.length ? <p className={changes.notice}>{t('panel.changes.unavailableImages')}</p> : null}
            </section>
          ) : null}
          {data.failed ? <p className={`${changes.section} ${changes.notice}`} role="alert">{t('checkpoint.failed')}</p> : null}
          {images.length ? (
            <section className={changes.section} aria-label={t('panel.changes.images')}>
              <h3 className={changes.sectionTitle}>{t('panel.changes.images')}</h3>
              <ul className={changes.strip} data-testid="panel-changes-images">
                {images.map((asset) => {
                  const mtime = mtimes.get(asset.path);
                  return (
                    <li key={asset.path}>
                      <button type="button" className={changes.thumb} title={asset.path} onClick={() => openImage(asset.path)}>
                        <img src={`${projectFileUrl(projectId, asset.path)}${mtime ? `?v=${mtime}` : ''}`} alt={asset.path} loading="lazy" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
          {!unavailable ? (
            <section className={changes.section} aria-label={t('panel.changes.files')}>
              {rows.length ? (
                <h3 className={changes.sectionTitle}>
                  {t('chat.changes.title', { count: rows.length })}
                  {totals ? <span className={changes.counts} aria-label={t('panel.changes.lineCounts', { added: totals.added, deleted: totals.removed })}>
                    <span className={changes.added}>+{totals.added}</span> <span className={changes.deleted}>−{totals.removed}</span>
                  </span> : null}
                </h3>
              ) : null}
              {!list && !data.failed ? <p className={changes.notice} role="status">{t('checkpoint.loading')}</p> : null}
              {filesNotice ? <p className={changes.notice}>{filesNotice}</p> : null}
              {rows.length ? (
                <ul className={changes.rows} data-testid="panel-changes-files">
                  {rows.map((row) => <ChangeRowButton key={row.path} row={row} counts={counts.get(row.path)} onOpen={openRow} />)}
                </ul>
              ) : null}
            </section>
          ) : null}
        </div>
      )}
      {runCheckpoint ? (
        <CheckpointRestoreConfirm projectId={projectId} checkpoint={runCheckpoint} open={undoOpen} anchor={undoAnchor}
          popoverId={`panel-changes-undo-${projectId}`} onClose={() => setUndoOpen(false)} onRestored={() => setRestored(true)} />
      ) : null}
    </div>
  );
}

function ChangeRowButton({ row, counts, onOpen }: { row: ChangeRow; counts: LineCounts | undefined; onOpen: (row: ChangeRow) => void }) {
  const t = useT();
  const slash = row.path.lastIndexOf('/');
  const dir = slash >= 0 ? row.path.slice(0, slash + 1) : '';
  const name = slash >= 0 ? row.path.slice(slash + 1) : row.path;
  const label = t(row.status === 'added' ? 'panel.changes.statusAdded' : row.status === 'deleted' ? 'panel.changes.statusDeleted' : 'panel.changes.statusModified');
  return (
    <li>
      <button type="button" className={changes.row} data-status={row.status} title={row.path} onClick={() => onOpen(row)}>
        <span className={changes.status} data-status={row.status} aria-label={label}>{changeStatusLetter(row.status)}</span>
        <span className={changes.path}>
          {dir ? <span className={changes.dir}>{dir}</span> : null}
          <span className={changes.name}>{name}</span>
        </span>
        {counts && counts.additions !== null && counts.deletions !== null ? (
          <span className={changes.counts} aria-label={t('panel.changes.lineCounts', { added: counts.additions, deleted: counts.deletions })}>
            <span className={changes.added}>+{counts.additions}</span> <span className={changes.deleted}>−{counts.deletions}</span>
          </span>
        ) : null}
      </button>
    </li>
  );
}

const EMPTY_MESSAGES: ChatMessage[] = [];
const EMPTY_FILES: ProjectFile[] = [];
const EMPTY_SET: ReadonlySet<string> = new Set();
const EMPTY_COUNTS: ReadonlyMap<string, LineCounts> = new Map();
