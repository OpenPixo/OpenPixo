import { useEffect, useState } from 'react';
import { useT } from '../../i18n';
import type { ProjectFile } from '../../types';
import { addProjectFilesToChat } from './add-to-chat';

/**
 * "Add to chat" in a file viewer's toolbar, styled like its Download / Open
 * links. The label itself reports the outcome for a moment, since the viewer
 * has no toast of its own.
 */
export function ViewerAddToChat({ file }: { file: ProjectFile }) {
  const t = useT();
  const [outcome, setOutcome] = useState<'added' | 'no-chat' | null>(null);
  useEffect(() => {
    if (!outcome) return;
    const timer = window.setTimeout(() => setOutcome(null), 2000);
    return () => window.clearTimeout(timer);
  }, [outcome]);
  return (
    <button
      type="button"
      className="ghost-link"
      data-testid="viewer-add-to-chat"
      aria-live="polite"
      onClick={() => {
        const result = addProjectFilesToChat([file.name], [file]);
        if (result.kind !== 'empty') setOutcome(result.kind === 'added' ? 'added' : 'no-chat');
      }}
    >
      {outcome === 'added'
        ? t('filesPanel.addedShort')
        : outcome === 'no-chat' ? t('filesPanel.noChatShort') : t('filesPanel.addToChat')}
    </button>
  );
}
