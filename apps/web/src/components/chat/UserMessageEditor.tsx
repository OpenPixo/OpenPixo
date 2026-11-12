import { useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@openpixo/components';
import type { Dict } from '../../i18n/types';
import type { EditUserMessageOutcome } from '../../state/conversation-rewind';
import { useProjectCheckpoints } from '../checkpoints/useProjectCheckpoints';
import styles from './UserMessageEditor.module.css';

type TranslateFn = (key: keyof Dict, vars?: Record<string, string | number>) => string;

interface Props {
  initialText: string;
  projectId: string | null;
  /** The first run that answered this message, whose checkpoint holds the files from before it. */
  nextRunId: string | null;
  onCancel: () => void;
  onSubmit: (text: string, restoreFiles: boolean) => Promise<EditUserMessageOutcome>;
  t: TranslateFn;
}

function failureKey(code: string): keyof Dict {
  if (code === 'RUN_ACTIVE' || code === 'CHECKPOINT_BUSY') return 'chat.editFailedBusy';
  if (code === 'CHECKPOINT_WORKTREE_CONFLICT') return 'chat.editFailedConflict';
  return 'chat.editFailed';
}

/**
 * A sent message opened for editing, in place of its bubble. Sending takes the
 * conversation back to just before it and sends the new text. When the files
 * can be put back too, a checkbox (on by default) offers it; otherwise one line
 * says they stay as they are.
 */
export function UserMessageEditor({ initialText, projectId, nextRunId, onCancel, onSubmit, t }: Props) {
  const [text, setText] = useState(initialText);
  const [restoreFiles, setRestoreFiles] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<keyof Dict | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const { data } = useProjectCheckpoints(projectId ?? '', Boolean(projectId && nextRunId), { poll: false });
  const restorable = Boolean(
    nextRunId && data?.status === 'available'
      && data.checkpoints.some((checkpoint) => checkpoint.kind === 'run' && checkpoint.runId === nextRunId),
  );

  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    area.focus();
    area.setSelectionRange(area.value.length, area.value.length);
  }, []);

  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    area.style.height = 'auto';
    area.style.height = `${Math.min(area.scrollHeight, 320)}px`;
  }, [text]);

  async function submit() {
    if (pending || !text.trim()) return;
    setPending(true);
    setError(null);
    const outcome = await onSubmit(text, restorable && restoreFiles);
    if (!outcome.ok) {
      setPending(false);
      setError(failureKey(outcome.code));
    }
  }

  return (
    <div className={styles.editor} data-testid="user-message-editor">
      <textarea
        ref={areaRef}
        className={styles.input}
        value={text}
        rows={1}
        aria-label={t('chat.editMessageAria')}
        disabled={pending}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          } else if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void submit();
          }
        }}
      />
      {restorable ? (
        <label className={styles.option}>
          <input
            type="checkbox"
            checked={restoreFiles}
            disabled={pending}
            data-testid="user-message-editor-restore"
            onChange={(event) => setRestoreFiles(event.target.checked)}
          />
          <span>{t('chat.editRestoreFiles')}</span>
        </label>
      ) : nextRunId ? (
        <p className={styles.note}>{t('chat.editFilesStay')}</p>
      ) : null}
      <p className={styles.note}>{t('chat.editReplaces')}</p>
      {error ? <p className={styles.error} role="alert">{t(error)}</p> : null}
      <div className={styles.actions}>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
          {t('chat.editCancel')}
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={() => void submit()}
          disabled={pending || !text.trim()}
          data-testid="user-message-editor-send"
        >
          {t('chat.editSend')}
        </Button>
      </div>
    </div>
  );
}
