import type { Ref } from 'react';
import { Button } from '@openpixo/components';
import { useT } from '../../i18n';
import { Icon } from '../Icon';
import styles from './ConversationHead.module.css';

interface Props {
  projectName: string;
  /** The open session's title; omitted while it has none. */
  sessionTitle?: string | null;
  /** Host for the chat history control, which ChatPane portals in. */
  historyRef: Ref<HTMLDivElement>;
  historyDockClassName?: string;
  panelVisible: boolean;
  onTogglePanel: () => void;
}

/**
 * The conversation column's header (specs/current/openpixo-ui-cleanup.md §3):
 * where you are — project, then session — and the two controls that belong to
 * the conversation: its history menu and the side-panel toggle.
 */
export function ConversationHead({ projectName, sessionTitle, historyRef, historyDockClassName, panelVisible, onTogglePanel }: Props) {
  const t = useT();
  const panelLabel = panelVisible ? t('projectShell.hidePanel') : t('projectShell.showPanel');
  // A first session is often titled after its project; naming it twice reads
  // as noise, so a repeat shows the project alone.
  const trimmed = sessionTitle?.trim();
  const session = trimmed && trimmed !== projectName.trim() ? trimmed : null;
  return (
    <div className={styles.head} data-testid="project-conversation-head">
      <h1 className={styles.title}>
        <span className={styles.project} title={projectName}>{projectName}</span>
        {session ? <>
          <Icon name="chevron-right" size={13} className={styles.separator} aria-hidden />
          <span className={styles.session} title={session}>{session}</span>
        </> : null}
      </h1>
      <div className={styles.actions}>
        <div className={historyDockClassName} ref={historyRef} data-testid="chat-history-dock" />
        <Button variant="ghost" size="icon" className={`${styles.control} pixo-tooltip`}
          aria-label={panelLabel} aria-pressed={panelVisible} data-tooltip={panelLabel} data-tooltip-placement="bottom"
          data-testid="project-panel-toggle" onClick={onTogglePanel}>
          <Icon name="layout-right" size={16} />
        </Button>
      </div>
    </div>
  );
}
