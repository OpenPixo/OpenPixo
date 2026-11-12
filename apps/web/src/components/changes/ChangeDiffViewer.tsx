import { useEffect, useMemo, useState } from 'react';
import { Button } from '@openpixo/components';
import type { CheckpointDiffHunk, GetProjectCheckpointFileDiffResponse } from '@openpixo/contracts';
import { useT } from '../../i18n';
import { languageOfPath } from '../../runtime/chat/tool-preview';
import { isGalleryImagePath } from '../../runtime/chat/turn-assets';
import { Tokens } from '../chat/primitives/CodeView';
import { useCodeTokens } from '../chat/primitives/useCodeTokens';
import { checkpointFileUrl, fetchCheckpointFileDiff } from './client';
import { changeStatusLetter } from './changes-model';
import styles from './Changes.module.css';

/**
 * One file as one run changed it (spec §5), pushed onto 改动's stack: a line
 * diff for text, before/after for images. Both image versions come from the
 * checkpoint itself (`…/file?side=before|after`), so the pair stays the run's
 * own change even after later edits. While the run is still going the "after"
 * side is the current file, and the diff re-reads on file events.
 */
export function ChangeDiffViewer({ projectId, checkpointId, path, refreshKey = 0, onOpenFile }: {
  projectId: string;
  checkpointId: string;
  path: string;
  refreshKey?: number;
  onOpenFile?: (path: string) => void;
}) {
  const t = useT();
  const [state, setState] = useState<{ key: string; diff?: GetProjectCheckpointFileDiffResponse; failed?: boolean } | null>(null);
  const key = `${projectId}:${checkpointId}:${path}`;
  const live = state?.key === key && state.diff?.target === 'working_tree';
  const liveKey = live ? refreshKey : 0;
  useEffect(() => {
    const controller = new AbortController();
    void fetchCheckpointFileDiff(projectId, checkpointId, path, controller.signal).then(
      (diff) => { if (!controller.signal.aborted) setState({ key, diff }); },
      () => { if (!controller.signal.aborted) setState((current) => (current?.key === key && current.diff ? current : { key, failed: true })); },
    );
    return () => controller.abort();
  }, [projectId, checkpointId, path, key, liveKey]);

  const current = state?.key === key ? state : null;
  const diff = current?.diff;
  const image = isGalleryImagePath(path);
  const status = diff?.status;
  return (
    <div className={styles.viewer} data-testid="change-diff-viewer" data-path={path}>
      <div className={styles.viewerHeader}>
        {status ? (
          <span className={styles.status} data-status={status} aria-label={statusLabel(t, status)} title={statusLabel(t, status)}>
            {changeStatusLetter(status)}
          </span>
        ) : null}
        <span className={styles.viewerPath} title={path}>{path}</span>
        {diff && diff.additions !== null && diff.deletions !== null ? (
          <span className={styles.counts} aria-label={t('panel.changes.lineCounts', { added: diff.additions, deleted: diff.deletions })}>
            <span className={styles.added}>+{diff.additions}</span> <span className={styles.deleted}>−{diff.deletions}</span>
          </span>
        ) : null}
        {onOpenFile && status !== 'deleted' ? (
          <Button size="sm" variant="ghost" onClick={() => onOpenFile(path)}>{t('panel.changes.openFile')}</Button>
        ) : null}
      </div>
      <div className={styles.viewerBody}>
        {!current ? <p className={styles.viewerNotice} role="status">{t('panel.changes.diffLoading')}</p> : null}
        {current?.failed ? <p className={styles.viewerNotice} role="alert">{t('panel.changes.diffFailed')}</p> : null}
        {diff?.target === 'working_tree' ? <p className={styles.viewerNotice}>{t('panel.changes.diffWorkingTree')}</p> : null}
        {diff && image ? (
          <ImageCompare projectId={projectId} checkpointId={checkpointId} path={path} status={diff.status} version={liveKey} />
        ) : null}
        {diff && !image && diff.binary ? <p className={styles.viewerNotice}>{t('panel.changes.diffBinary')}</p> : null}
        {diff && !image && !diff.binary && diff.hunks.length === 0 && !diff.truncated
          ? <p className={styles.viewerNotice}>{t('panel.changes.diffNoLines')}</p> : null}
        {diff && !image && diff.truncated ? <p className={styles.viewerNotice}>{t('panel.changes.diffTruncated')}</p> : null}
        {diff && !image && diff.hunks.length ? <DiffTable hunks={diff.hunks} language={languageOfPath(path)} /> : null}
      </div>
    </div>
  );
}

function statusLabel(t: ReturnType<typeof useT>, status: GetProjectCheckpointFileDiffResponse['status']): string {
  return t(status === 'added' ? 'panel.changes.statusAdded' : status === 'deleted' ? 'panel.changes.statusDeleted' : 'panel.changes.statusModified');
}

function ImageCompare({ projectId, checkpointId, path, status, version }: {
  projectId: string; checkpointId: string; path: string; status: GetProjectCheckpointFileDiffResponse['status']; version: number;
}) {
  const t = useT();
  const side = (which: 'before' | 'after') => {
    const url = `${checkpointFileUrl(projectId, checkpointId, path, which)}${which === 'after' && version ? `&v=${version}` : ''}`;
    const caption = status === 'added' ? t('panel.changes.imageAdded') : status === 'deleted' ? t('panel.changes.imageDeleted')
      : t(which === 'before' ? 'panel.changes.before' : 'panel.changes.after');
    return (
      <figure className={styles.compareSide} data-side={which}>
        <figcaption>{caption}</figcaption>
        <div className={styles.compareFrame}>
          <img src={url} alt={`${path} · ${caption}`} />
        </div>
      </figure>
    );
  };
  return (
    <div className={styles.compare}>
      {status === 'added' ? null : side('before')}
      {status === 'deleted' ? null : side('after')}
    </div>
  );
}

/** Hunk header `@@ -a,b +c,d @@` → the first old / new line numbers. */
function hunkStart(header: string): { old: number; next: number } {
  const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u.exec(header);
  return { old: match ? Number(match[1]) : 1, next: match ? Number(match[2]) : 1 };
}

function DiffTable({ hunks, language }: { hunks: CheckpointDiffHunk[]; language: string | null }) {
  return (
    <table className={styles.diff} data-testid="change-diff-table">
      {hunks.map((hunk, hunkIndex) => <DiffHunk key={`${hunkIndex}:${hunk.header}`} hunk={hunk} language={language} />)}
    </table>
  );
}

function DiffHunk({ hunk, language }: { hunk: CheckpointDiffHunk; language: string | null }) {
  // One hunk is highlighted as one block: old and new lines interleave, which is good enough to colour.
  const code = useMemo(() => hunk.lines.map((line) => line.text).join('\n'), [hunk]);
  const tokens = useCodeTokens(code, language);
  let { old, next } = hunkStart(hunk.header);
  return (
    <tbody>
      <tr className={styles.hunk}><td colSpan={4}>{hunk.header}</td></tr>
      {hunk.lines.map((line, index) => {
        const oldNumber = line.kind === 'add' ? '' : String(old++);
        const newNumber = line.kind === 'del' ? '' : String(next++);
        return (
          <tr key={index} className={styles.line} data-kind={line.kind}>
            <td className={styles.number}>{oldNumber}</td>
            <td className={styles.number}>{newNumber}</td>
            <td className={styles.sign}>{line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '}</td>
            <td className={styles.text}>{tokens?.[index] ? <Tokens tokens={tokens[index]!} /> : line.text}</td>
          </tr>
        );
      })}
    </tbody>
  );
}
