import { Button } from '@openpixo/components';
import { useT } from '../../i18n';
import { Icon } from '../Icon';
import styles from './AddToChatButton.module.css';

/**
 * Hover affordance that hands one project file to the chat composer. `icon`
 * sits in list rows next to the ⋯ menu; `pill` floats over image thumbnails,
 * where a labelled chip is easier to find than a bare glyph.
 */
export function AddToChatButton({ name, look = 'icon', className, onAdd }: {
  name: string;
  look?: 'icon' | 'pill';
  className?: string;
  onAdd: () => void;
}) {
  const t = useT();
  const label = t('filesPanel.addToChatFile', { name: name.split('/').pop() || name });
  return (
    <Button
      variant="ghost"
      size={look === 'icon' ? 'icon' : 'sm'}
      className={[styles.button, look === 'pill' ? styles.pill : styles.icon, className].filter(Boolean).join(' ')}
      data-testid={`add-to-chat-${name}`}
      data-add-to-chat=""
      aria-label={label}
      title={label}
      draggable={false}
      onClick={(event) => {
        event.stopPropagation();
        onAdd();
      }}
    >
      <Icon name="attach" size={look === 'icon' ? 14 : 12} />
      {look === 'pill' ? <span>{t('filesPanel.addToChat')}</span> : null}
    </Button>
  );
}
