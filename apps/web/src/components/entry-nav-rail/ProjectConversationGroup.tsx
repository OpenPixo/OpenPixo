import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button } from '@openpixo/components';

import type { Conversation, Project } from '../../types';
import { useT } from '../../i18n';
import { navigate } from '../../router';

import { CONVERSATIONS_CHANGED_EVENT, createConversation, listConversations } from '../../state/projects';
import { acknowledgeProjectCompletion } from '../../hooks/useProjectRunStatuses';
import { RUNS_CHANGED_EVENT } from '../../providers/daemon';
import { CONVERSATION_SEEN_EVENT, conversationHasNewReply, conversationSeenTimes } from '../../state/conversation-seen';
import { Icon } from '../Icon';
import styles from './ProjectConversationGroup.module.css';

interface Props {
  project: Project;

  activeProjectId?: string | null;
  activeConversationId?: string | null;
  activeFileName?: string | null;
  children: ReactNode;
}

function storedExpanded(key: string): boolean {
  try { return window.localStorage.getItem(key) === 'true'; } catch { return false; }
}

type ConversationDot = 'needs-input' | 'running' | 'new-reply' | null;

/**
 * One mark per conversation row, most urgent first: waiting on the user
 * (orange), still working (green), a reply finished while the user was
 * elsewhere (blue). The conversation on screen needs neither of the two that
 * ask for attention.
 */
function conversationDotStatus(conversation: Conversation, seen: Readonly<Record<string, number>>, onScreen: boolean): ConversationDot {
  if (conversation.needsInput && !onScreen) return 'needs-input';
  if (conversation.latestRun?.status === 'running' || conversation.latestRun?.status === 'queued') return 'running';
  if (!onScreen && conversationHasNewReply(conversation, seen)) return 'new-reply';
  return null;
}

function ConversationStatusDot({ status, t }: { status: ConversationDot; t: ReturnType<typeof useT> }) {
  if (status === 'needs-input') return <span className={styles.needsInput} role="img" aria-label={t('designs.status.awaitingInput')} title={t('designs.status.awaitingInput')} data-testid="conversation-needs-input" />;
  if (status === 'running') return <span className={styles.running} role="img" aria-label={t('chat.record.running')} title={t('chat.record.running')} />;
  if (status === 'new-reply') return <span className={styles.newReply} role="img" aria-label={t('chat.newReply')} title={t('chat.newReply')} data-testid="conversation-new-reply" />;
  return null;
}

export function ProjectConversationGroup({ project,  activeProjectId,
  activeConversationId, activeFileName = null, children }: Props) {
  const t = useT();
  const listId = useId();
  const scope = `${project.id}:${"local"}`;
  const storageKey = `openpixo:project-sessions:${scope}`;
  const active = activeProjectId === project.id;
  const [expansion, setExpansion] = useState(() => ({ key: storageKey, open: active || storedExpanded(storageKey) }));
  const expanded = expansion.key === storageKey ? expansion.open : active || storedExpanded(storageKey);
  const [snapshot, setSnapshot] = useState<{ scope: string; items: Conversation[]; loading: boolean; failed: boolean }>({
    scope, items: [], loading: true, failed: false,
  });
  const [creating, setCreating] = useState(false);
  const [createFailed, setCreateFailed] = useState(false);
  const pending = useRef(false);
  const generation = useRef(0);
  const readGeneration = useRef(0);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  useEffect(() => {
    generation.current += 1;
    pending.current = false;
    setCreating(false);
    setCreateFailed(false);
    return () => { generation.current += 1; };
  }, [scope]);

  const expand = useCallback((open: boolean) => {
    setExpansion({ key: storageKey, open });
    try { window.localStorage.setItem(storageKey, String(open)); } catch { /* Navigation still works without storage. */ }
  }, [storageKey]);

  useEffect(() => { if (active) expand(true); }, [active, activeConversationId, expand]);

  const refresh = useCallback(async () => {
    const read = ++readGeneration.current;
    setSnapshot((current) => current.scope === scope
      ? { ...current, loading: current.items.length === 0, failed: false } : { scope, items: [], loading: true, failed: false });
    try {
      const items = await listConversations(project.id, {  throwOnError: true });
      if (read !== readGeneration.current || scope !== scopeRef.current) return;
      setSnapshot({ scope, items: items.filter((item) => item.projectId === project.id)
        .sort((a, b) => b.updatedAt - a.updatedAt), loading: false, failed: false });
    } catch {
      if (read === readGeneration.current && scope === scopeRef.current) {
        setSnapshot({ scope, items: [], loading: false, failed: true });
      }
    }
  }, [project.id, scope]);

  useEffect(() => {
    if (!expanded) return;
    void refresh();
    const changed = (event: Event) => {
      if ((event as CustomEvent<{ projectId: string }>).detail?.projectId === project.id) void refresh();
    };
    const focused = () => { void refresh(); };
    window.addEventListener(CONVERSATIONS_CHANGED_EVENT, changed);
    window.addEventListener(RUNS_CHANGED_EVENT, focused);
    window.addEventListener('focus', focused);
    return () => {
      readGeneration.current += 1;
      window.removeEventListener(CONVERSATIONS_CHANGED_EVENT, changed);
      window.removeEventListener(RUNS_CHANGED_EVENT, focused);
      window.removeEventListener('focus', focused);
    };
  }, [expanded, refresh, project.id, project.updatedAt, activeConversationId]);

  /* While a conversation here is running, look again every few seconds so its
     dot turns into "new reply" when it ends, including a run started from the
     CLI or another window. */
  const anyRunning = snapshot.scope === scope && snapshot.items.some((item) => item.latestRun?.status === 'running' || item.latestRun?.status === 'queued');
  useEffect(() => {
    if (!expanded || !anyRunning) return;
    const timer = window.setInterval(() => { void refresh(); }, 4000);
    return () => window.clearInterval(timer);
  }, [expanded, anyRunning, refresh]);

  const [seen, setSeen] = useState(conversationSeenTimes);
  useEffect(() => {
    const update = () => setSeen(conversationSeenTimes());
    window.addEventListener(CONVERSATION_SEEN_EVENT, update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener(CONVERSATION_SEEN_EVENT, update);
      window.removeEventListener('storage', update);
    };
  }, []);

  function openConversation(id: string) {
    acknowledgeProjectCompletion(project.id);
    navigate({ kind: 'project', projectId: project.id, conversationId: id,
      fileName: active ? activeFileName : null });
  }

  async function newConversation() {
    if (pending.current) return;
    pending.current = true;
    setCreating(true);
    setCreateFailed(false);
    const started = generation.current;
    try {
      const conversation = await createConversation(project.id, undefined, {  throwOnError: true });
      if (started !== generation.current || scope !== scopeRef.current) return;
      if (!conversation) throw new Error('Conversation creation failed');
      expand(true);
      openConversation(conversation.id);
    } catch {
      if (started === generation.current && scope === scopeRef.current) setCreateFailed(true);
    } finally {
      if (started === generation.current) {
        pending.current = false;
        setCreating(false);
      }
    }
  }

  const current = snapshot.scope === scope ? snapshot : { items: [], loading: true, failed: false };
  return (
    <div className={styles.group} data-testid="project-conversation-group" data-project-id={project.id} data-active={active} data-expanded={expanded}>
      <div className={styles.header}>
        {/* A compact disclosure chevron and a "+" (always shown on the open or
            expanded project, on hover/focus elsewhere). */}
        <Button variant="ghost" size="icon" className={`${styles.action} ${styles.expand}`}
          aria-label={`${project.name} · ${t('chat.conversationsHeading')}`}
          aria-expanded={expanded} aria-controls={listId} onClick={() => expand(!expanded)}>
          <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={12} />
        </Button>
        <div className={styles.project}>{children}</div>
        <Button variant="ghost" size="icon" className={`${styles.action} ${styles.add}`}
          aria-label={`${t('chat.newSession')} · ${project.name}`} title={t('chat.newSession')}
          disabled={creating} aria-busy={creating || undefined} onClick={() => void newConversation()}>
          <Icon name={creating ? 'spinner' : 'plus'} size={14} />
        </Button>
      </div>
      {createFailed ? <p className={styles.notice} role="alert">{t('chat.forkConversationFailed')}</p> : null}
      {expanded ? (
        <div id={listId} className={styles.conversations}>
          {current.loading ? <p className={styles.notice} role="status">{t('common.loading')}</p>
            : current.failed ? <div className={styles.notice} role="alert">
              <span>{t('common.unavailable')}</span>
              <Button variant="ghost" size="sm" onClick={() => void refresh()}>{t('promptTemplates.retry')}</Button>
            </div>
            : current.items.length === 0 ? <p className={styles.notice}>{t('chat.emptyConversations')}</p>
            : <ul className={styles.list} aria-label={`${project.name} · ${t('chat.conversationsHeading')}`}>
              {current.items.map((conversation) => (
                <li key={conversation.id}>
                  <Button variant="ghost" className={styles.conversation}
                    aria-current={active && activeConversationId === conversation.id ? 'page' : undefined}
                    onClick={() => openConversation(conversation.id)}
                    title={conversation.title || t('chat.untitledConversation')}>
                    <Icon name="comment" size={13} />
                    <span>{conversation.title || t('chat.untitledConversation')}</span>
                    <ConversationStatusDot
                      status={conversationDotStatus(conversation, seen, active && activeConversationId === conversation.id)}
                      t={t} />
                  </Button>
                </li>
              ))}
            </ul>}
        </div>
      ) : null}
    </div>
  );
}
