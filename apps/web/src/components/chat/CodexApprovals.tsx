import { useEffect, useRef, useState } from 'react';
import { Button } from '@openpixo/components';
import type {
  RunApprovalDecision,
  RunApprovalListResponse,
  RunApprovalRequest,
} from '@openpixo/contracts';
import { useT } from '../../i18n';
import styles from './CodexApprovals.module.css';

export function RunApprovals({ runId, streaming, onPendingChange }: {
  runId: string | null | undefined;
  streaming?: boolean;
  /** How many approvals are waiting on the user (0 once none / unmounted); feeds the run status line. */
  onPendingChange?: (count: number) => void;
}) {
  return runId ? <PendingRunApprovals key={runId} runId={runId} streaming={streaming} onPendingChange={onPendingChange} /> : null;
}

export const CodexApprovals = RunApprovals;

function ApprovalSummary({ approval }: { approval: RunApprovalRequest }) {
  const t = useT();
  const path = approval.paths?.[0];
  const mcp = /^mcp__(.+?)__(.+)$/u.exec(approval.tool);
  const summary = approval.tool === 'Write' && path ? t('chat.approval.summary.write', { path })
    : ['Edit', 'MultiEdit', 'NotebookEdit'].includes(approval.tool) && path ? t('chat.approval.summary.edit', { path })
    : approval.tool === 'Bash' && approval.command ? t('chat.approval.summary.command', { command: approval.command })
    : mcp ? t('chat.approval.summary.mcpTool', { server: mcp[1]!, tool: mcp[2]! })
    : approval.runtime === 'claude' ? t('chat.approval.summary.tool', { tool: approval.tool }) : approval.summary;
  return summary ? <p className={styles.summary} title={summary}>{summary}</p> : null;
}

/**
 * Only the decisions the runtime offers are drawn: a button that can never be used is no choice.
 * When there is no separate decline, "cancel" is the only way to say no, and it also stops the
 * run, so it is named that way instead of "Cancel task".
 */
function ApprovalActions({ approval, submitting, onRespond }: {
  approval: RunApprovalRequest;
  submitting: boolean;
  onRespond: (decision: RunApprovalDecision) => void;
}) {
  const t = useT();
  const offered = (decision: RunApprovalDecision) => approval.availableDecisions?.includes(decision) ?? true;
  const denyStops = !offered('decline') && offered('cancel');
  return <>
    {denyStops ? <p className={styles.note}>{t('chat.approval.noDecline')}</p> : null}
    <div className={styles.actions}>
      {offered('accept') ? <Button size="sm" variant="primary" disabled={submitting} onClick={() => onRespond('accept')}>
        {t('chat.approval.accept')}
      </Button> : null}
      {offered('decline') ? <Button size="sm" variant="secondary" disabled={submitting} onClick={() => onRespond('decline')}>
        {t('chat.approval.decline')}
      </Button> : null}
      {offered('cancel') ? <Button size="sm" variant={denyStops ? 'secondary' : 'ghost'} disabled={submitting} onClick={() => onRespond('cancel')}>
        {t(denyStops ? 'chat.approval.denyAndStop' : 'chat.approval.cancel')}
      </Button> : null}
    </div>
  </>;
}

function PendingRunApprovals({ runId, streaming, onPendingChange }: {
  runId: string;
  streaming?: boolean;
  onPendingChange?: (count: number) => void;
}) {
  const t = useT();
  const [approvals, setApprovals] = useState<RunApprovalRequest[]>([]);
  const pendingChange = useRef(onPendingChange);
  pendingChange.current = onPendingChange;
  useEffect(() => { pendingChange.current?.(approvals.length); }, [approvals.length]);
  useEffect(() => () => pendingChange.current?.(0), []);
  const [error, setError] = useState<'load' | 'response' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [revision, setRevision] = useState(0);
  const responseController = useRef<AbortController | null>(null);
  const endpoint = `/api/runs/${encodeURIComponent(runId)}/approvals`;

  useEffect(() => () => responseController.current?.abort(), []);

  useEffect(() => {
    const controller = new AbortController();
    let nextPoll: ReturnType<typeof setTimeout> | undefined;
    async function refresh() {
      let closed = false;
      try {
        const response = await fetch(endpoint, { cache: 'no-store', signal: controller.signal });
        if (response.status === 404) {
          closed = true;
          if (!controller.signal.aborted) { setApprovals([]); setError(null); }
          return;
        }
        if (!response.ok) throw new Error(`approvals ${response.status}`);
        const result = await response.json() as RunApprovalListResponse;
        if (!Array.isArray(result.approvals)) throw new Error('Invalid approval list');
        if (controller.signal.aborted) return;
        closed = result.closed === true;
        setApprovals(result.approvals.map((approval) => ({
          ...approval, id: approval.id ?? approval.requestId ?? '', runtime: approval.runtime ?? 'codex',
        })));
        setError((current) => current === 'load' || result.approvals.length === 0 ? null : current);
      } catch {
        if (!controller.signal.aborted) setError('load');
      } finally {
        if (!controller.signal.aborted && !closed) nextPoll = setTimeout(() => void refresh(), 1_000);
      }
    }
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(nextPoll);
    };
  }, [endpoint, revision, streaming]);

  async function respond(requestId: string, decision: RunApprovalDecision) {
    if (responseController.current) return;
    const controller = new AbortController();
    responseController.current = controller;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`${endpoint}/${encodeURIComponent(requestId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`approval response ${response.status}`);
      if (controller.signal.aborted) return;
      setApprovals((current) => current.filter((approval) => approval.id !== requestId));
    } catch {
      if (!controller.signal.aborted) setError('response');
    } finally {
      if (!controller.signal.aborted) {
        responseController.current = null;
        setSubmitting(false);
        setRevision((current) => current + 1);
      }
    }
  }

  if (approvals.length === 0 && !error) return null;

  return (
    <section className={styles.root} role="region" aria-label={t('chat.approval.title')}>
      {approvals.map((approval) => (
        <article className={styles.request} key={approval.id} aria-busy={submitting}>
          <strong>{t('chat.approval.titleRuntime', { runtime: approval.runtime === 'claude' ? 'Claude Code' : approval.runtime === 'codex' ? 'Codex' : approval.runtime })}</strong>
          {approval.fromSubAgent ? <small>{t('chat.approval.fromSubAgent')}</small> : null}
          <ApprovalSummary approval={approval} />
          {approval.reason ? <p>{approval.reason}</p> : null}
          {approval.command ? <pre><code>{approval.command}</code></pre> : null}
          {approval.details ? <pre><code>{approval.details}</code></pre> : null}
          {approval.cwd ? <code className={styles.path}>{approval.cwd}</code> : null}
          {approval.paths?.map((path) => <code className={styles.path} key={path}>{path}</code>)}
          <small>{approval.method ?? approval.tool}</small>
          {approval.status === 'timed-out' || approval.status === 'stopped' ? (
            <p role="status">{t(approval.status === 'timed-out' ? 'chat.approval.timedOut' : 'chat.approval.stoppedDenied')}</p>
          ) : <ApprovalActions approval={approval} submitting={submitting} onRespond={(decision) => void respond(approval.id, decision)} />}
        </article>
      ))}
      {error ? <p className={styles.error} role="alert">{t(error === 'load' ? 'chat.approval.loadFailure' : 'chat.approval.responseFailure')}</p> : null}
    </section>
  );
}
