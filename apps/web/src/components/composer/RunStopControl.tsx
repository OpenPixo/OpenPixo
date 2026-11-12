import { Button, VisuallyHidden } from '@openpixo/components';

import { chatSeam } from '../chat/ChatRoot';
import styles from './RunStopControl.module.css';

interface Props {
  onStop?: () => void;
  stopLabel: string;
  runningLabel: string;
}

export function ComposerRunningDots() {
  return (
    <span className={styles.dots} data-testid="composer-running-dots" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

export function RunStopControl({ onStop, stopLabel, runningLabel }: Props) {
  return (
    <div {...chatSeam(styles.controls)}>
      <span className={styles.status} role="status" data-testid="composer-running-status">
        <VisuallyHidden>{runningLabel}</VisuallyHidden>
        <ComposerRunningDots />
      </span>
      <Button
        className={`${styles.stop} pixo-tooltip`}
        onClick={onStop}
        aria-label={stopLabel}
        title={stopLabel}
        data-tooltip={stopLabel}
        data-testid="chat-stop"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 18 18"
          fill="currentColor"
          aria-hidden="true"
          focusable="false"
          data-testid="chat-stop-icon"
        >
          <rect x="3" y="3" width="12" height="12" rx="2.5" />
        </svg>
      </Button>
    </div>
  );
}
