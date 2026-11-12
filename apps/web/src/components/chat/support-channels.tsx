import { PRODUCT_ISSUES_URL, PRODUCT_SUPPORT_EMAIL } from '@openpixo/contracts';
import type { SupportChannel } from './SupportDialog';
import { Icon } from '../Icon';
import type { Dict } from '../../i18n/types';

/** Only destinations that exist: an unset URL would be a row with a dead button. */
export function supportChannels(t: (key: keyof Dict) => string): SupportChannel[] {
  const channels: SupportChannel[] = [];
  if (PRODUCT_SUPPORT_EMAIL) {
    channels.push({
      id: 'email',
      name: PRODUCT_SUPPORT_EMAIL,
      href: `mailto:${PRODUCT_SUPPORT_EMAIL}`,
      actionLabel: t('chat.support.emailAction'),
      icon: <Icon name="mail" size={16} />,
    });
  }
  if (PRODUCT_ISSUES_URL) {
    channels.push({ id: 'issues', name: t('openpixo.feedback'), href: PRODUCT_ISSUES_URL, icon: <Icon name="comment" size={16} /> });
  }
  return channels;
}
