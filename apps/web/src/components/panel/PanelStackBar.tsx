import { useEffect, useRef } from 'react';
import { Button } from '@openpixo/components';
import { useT } from '../../i18n';
import { APP_CHROME_FILE_ACTIONS_ID } from '../AppChromeHeader';
import { Icon } from '../Icon';
import styles from './PanelStackBar.module.css';

/**
 * The view toolbar while a view shows an opened item (spec §3): `← <name>`
 * plus the file-actions portal host the active FileViewer renders into.
 *
 * Always mounted, so the portal host keeps one stable element across opens,
 * pops and view switches; hidden while the view shows its own root.
 */
export function PanelStackBar({
  label,
  title,
  onBack,
  fileActionsVisible,
  focusRequest,
}: {
  /** Display name of the shown item; null hides the bar. */
  label: string | null;
  title?: string;
  onBack: () => void;
  fileActionsVisible: boolean;
  /** Bumped when an open from inside the panel should move focus to ←. */
  focusRequest: number;
}) {
  const t = useT();
  const backRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (focusRequest > 0 && label !== null) backRef.current?.focus({ preventScroll: true });
    // Focus follows the request, not every label change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest]);
  return (
    <div className={styles.bar} hidden={label === null} data-testid="panel-stack-bar">
      <Button
        ref={backRef}
        size="icon"
        variant="ghost"
        className={`${styles.back} pixo-tooltip`}
        aria-label={t('panel.back')}
        data-tooltip={t('panel.back')}
        data-tooltip-placement="bottom"
        data-testid="panel-stack-back"
        onClick={onBack}
      >
        <Icon name="arrow-left" size={15} />
      </Button>
      <span className={styles.label} title={title ?? label ?? undefined} data-testid="panel-stack-label">{label}</span>
      <div className={`ws-tabs-actions ${styles.actions}`}>
        <div
          id={APP_CHROME_FILE_ACTIONS_ID}
          className="ws-tabs-file-actions"
          data-app-chrome-file-actions="true"
          hidden={!fileActionsVisible}
        />
      </div>
    </div>
  );
}
