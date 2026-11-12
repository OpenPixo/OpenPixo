import type { StoreCatalogItem } from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import { formatCredits } from '../account/account-format';
import styles from './StorePrice.module.css';

/** A small pixel coin: the Workshop's mark for credits. */
export function CoinGlyph({ className }: { className?: string }) {
  return <svg className={[styles.coin, className ?? ''].filter(Boolean).join(' ')} viewBox="0 0 8 8" aria-hidden="true" shapeRendering="crispEdges">
    <path d="M2 0h4v1h1v1h1v4h-1v1h-1v1h-4v-1h-1v-1h-1v-4h1v-1h1z" fill="currentColor" />
    <path d="M3 2h2v1h-2zM2 3h1v2h-1zM3 5h2v1h-2z" fill="var(--coin-shine, #fff)" opacity=".7" />
  </svg>;
}

/** Credits with the coin glyph, read aloud as "600 credits". */
export function CreditAmount({ credits, className }: { credits: number; className?: string }) {
  const { t, locale } = useI18n();
  const value = formatCredits(credits, locale);
  return <span className={[styles.amount, className ?? ''].filter(Boolean).join(' ')} aria-label={t('store.credits', { count: value })} role="img">
    <CoinGlyph /><span aria-hidden="true">{value}</span>
  </span>;
}

/** Price, Free, Owned or Installed for one item, as a compact pill. */
export function StorePrice({ item, size = 'md' }: { item: Pick<StoreCatalogItem, 'pricing' | 'owned' | 'installedVersion'>; size?: 'md' | 'lg' }) {
  const { t } = useI18n();
  const className = [styles.pill, size === 'lg' ? styles.lg : ''].filter(Boolean).join(' ');
  if (item.installedVersion) return <span className={className} data-state="installed"><i aria-hidden="true" />{t('store.installed')}</span>;
  if (item.pricing.type === 'paid' && item.owned) return <span className={className} data-state="owned"><i aria-hidden="true" />{t('workshop.owned')}</span>;
  if (item.pricing.type === 'free') return <span className={className} data-state="free">{t('store.free')}</span>;
  return <span className={className} data-state="paid">
    {item.pricing.credits === undefined ? t('store.paid') : <CreditAmount credits={item.pricing.credits} />}
  </span>;
}
