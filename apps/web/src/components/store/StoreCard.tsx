import { Button, Tag } from '@openpixo/components';
import type { StoreCatalogItem } from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import { navigate } from '../../router';
import type { WorkshopKind } from '../../state/store';
import { StoreCover } from './StoreCover';
import { StorePrice } from './StorePrice';
import { itemDescription, itemTitle, needsPurchase } from './workshop-catalog';
import styles from './StoreCard.module.css';

export function StoreCard({ item, installing = false, disabled = false, onInstall, onBuy, size = 'default', as: Wrapper = 'li' }: {
  item: StoreCatalogItem;
  installing?: boolean;
  disabled?: boolean;
  onInstall?: (item: StoreCatalogItem) => void;
  onBuy?: (item: StoreCatalogItem) => void;
  /** `feature` is the large asset-pack card. */
  size?: 'default' | 'feature';
  as?: 'li' | 'div';
}) {
  const { t, locale } = useI18n();
  const title = itemTitle(item, locale);
  const description = itemDescription(item, locale);
  const engines = item.engines.filter(engine => engine !== 'any');
  const paid = needsPurchase(item);
  return <Wrapper className={styles.slot}>
    <article className={styles.card} data-size={size} data-kind={item.kind}>
      <StoreCover item={item} zoom className={styles.cover} />
      <div className={styles.body}>
        <span className={styles.kind}>{t(`workshop.kind.${item.kind as WorkshopKind}`)}</span>
        <h3 className={styles.titleRow}>
          <button type="button" className={styles.title} onClick={() => navigate({ kind: 'home', view: 'store', storeItemName: item.name })}>{title}</button>
        </h3>
        <p className={styles.description}>{description}</p>
        <div className={styles.footer}>
          <StorePrice item={item} />
          {engines.length ? <div className={styles.engines}>{engines.map(engine => <Tag key={engine}>{engine}</Tag>)}</div> : null}
          {item.installedVersion || item.builtIn ? null : paid ? <Button variant="primary" size="sm" className={styles.action} disabled={disabled || !onBuy}
            aria-label={t('workshop.buyItem', { name: title })} onClick={() => onBuy?.(item)}>{t('workshop.buy')}</Button>
            : <Button variant="secondary" size="sm" className={styles.action} disabled={disabled || installing || !onInstall}
              aria-label={t('workshop.installItem', { name: title })} onClick={() => onInstall?.(item)}>{t(installing ? 'store.installing' : 'store.install')}</Button>}
        </div>
      </div>
    </article>
  </Wrapper>;
}
