import { Button } from '@openpixo/components';
import { useT } from '../../i18n';
import { Icon } from '../Icon';
import styles from './OlderTurnsFold.module.css';

/** The top of a long transcript: earlier turns are folded until the user asks for them. */
export function OlderTurnsFold({ hiddenTurns, onReveal }: { hiddenTurns: number; onReveal: () => void }) {
  const t = useT();
  return (
    <div className={styles.fold} data-testid="chat-older-turns">
      <span className={styles.line} aria-hidden="true" />
      <Button variant="ghost" size="sm" className={styles.button} onClick={onReveal}
        data-testid="chat-older-turns-reveal">
        <Icon name="chevron-up" size={13} />
        {t('chat.olderTurns.reveal', { n: hiddenTurns })}
      </Button>
      <span className={styles.line} aria-hidden="true" />
    </div>
  );
}
