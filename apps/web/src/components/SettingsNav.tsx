import { useT } from '../i18n';
import {
  SETTINGS_NAV_GROUPS,
  type SettingsNavItem,
  type SettingsPage,
} from '../settings-navigation';
import { Icon } from './Icon';
import styles from './SettingsNav.module.css';

/**
 * The Settings sidebar list: short group headings and one row per page, in
 * the order `SETTINGS_NAV_GROUPS` declares. Each row is just an icon and a
 * name; the page's one-line description lives in the page header instead.
 * Rows keep the shared `settings-nav-item` look from the workspace styles.
 */
export function SettingsNav({ activePage, onSelect, isVisible }: {
  activePage: SettingsPage;
  onSelect: (page: SettingsPage) => void;
  /** Lets the dialog hide pages the build cannot serve (account without a cloud service). */
  isVisible?: (item: SettingsNavItem) => boolean;
}) {
  const t = useT();
  return (
    <nav className={styles.nav}>
      {SETTINGS_NAV_GROUPS.map((group) => {
        const items = group.items.filter((item) => isVisible?.(item) ?? true);
        if (items.length === 0) return null;
        return (
          <div key={group.id} className={styles.group}>
            {group.headingKey ? <p className={styles.heading}>{t(group.headingKey)}</p> : null}
            {items.map((item) => {
              const active = item.page === activePage;
              return (
                <button
                  key={item.page}
                  type="button"
                  className={`settings-nav-item${active ? ' active' : ''}`}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => onSelect(item.page)}
                  data-testid={`settings-nav-${item.page}`}
                >
                  <Icon name={item.icon} size={16} />
                  <span><strong>{t(item.labelKey)}</strong></span>
                </button>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}

/** Title and one-line description at the top of a Settings page. */
export function SettingsPageHeader({ id, title, description }: { id?: string; title: string; description: string }) {
  return (
    <header className={styles.pageHeader}>
      <h2 id={id} className={styles.pageTitle}>{title}</h2>
      <p className={styles.pageDescription}>{description}</p>
    </header>
  );
}
