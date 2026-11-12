import type { IconName } from './components/Icon';
import type { Dict } from './i18n/types';

export const OPEN_MEDIA_SETTINGS_EVENT = 'openpixo:open-media-settings';

export function openMediaSettings() {
  window.dispatchEvent(new Event(OPEN_MEDIA_SETTINGS_EVENT));
}

/**
 * A Settings page: something that owns a sidebar nav item, plus `mcpClient`,
 * which keeps a render block reachable only through `initialSection` (external
 * MCP lives in the top-level Integrations view; App redirects there).
 */
export type SettingsPage =
  | 'general'
  | 'account'
  | 'execution'
  | 'media'
  | 'gameEngines'
  | 'doctor'
  | 'integrations'
  | 'privacy'
  | 'advanced'
  | 'about'
  | 'mcpClient';

/**
 * Every token a caller may open Settings with. Page tokens open that page;
 * the rest are deep links into a block on some page (see
 * `resolveSettingsDeepLink`). Old tokens stay accepted so a stale link never
 * becomes a type error or a dead end.
 */
export type SettingsSection =
  | SettingsPage
  | 'language'
  // Legacy: the theme setting is gone (the app ships light-only).
  | 'appearance'
  | 'notifications'
  | 'projectLocations'
  | 'instructions'
  | 'labs';

/** A block inside a page that a deep link scrolls into view. */
export type SettingsAnchor = 'notifications' | 'projectLocations' | 'instructions' | 'labs';

export interface SettingsDeepLink {
  page: SettingsPage;
  anchor?: SettingsAnchor;
}

/**
 * Resolves a requested section onto the page that owns it, and the block on
 * that page when the token names one. The page decides which nav item is
 * highlighted, so a deep link always lands on a reachable page.
 */
export function resolveSettingsDeepLink(section: SettingsSection): SettingsDeepLink {
  switch (section) {
    case 'language':
    case 'appearance':
      return { page: 'general' };
    case 'notifications':
    case 'projectLocations':
      return { page: 'general', anchor: section };
    case 'instructions':
      return { page: 'execution', anchor: 'instructions' };
    case 'labs':
      return { page: 'advanced', anchor: 'labs' };
    default:
      return { page: section };
  }
}

/** The DOM id a deep-link anchor block carries inside `.settings-content`. */
export function settingsAnchorId(anchor: SettingsAnchor): string {
  return `settings-anchor-${anchor}`;
}

export interface SettingsNavItem {
  page: Exclude<SettingsPage, 'mcpClient'>;
  /** Short name shown in the sidebar. Also the page title. */
  labelKey: keyof Dict;
  /** One plain sentence shown under the page title. */
  descriptionKey: keyof Dict;
  icon: IconName;
}

export interface SettingsNavGroup {
  id: 'app' | 'build' | 'system';
  /** Small heading above the group; the first group has none. */
  headingKey: keyof Dict | null;
  items: readonly SettingsNavItem[];
}

/**
 * The Settings sidebar, top to bottom. This list is the source of truth for
 * which pages a user can navigate to: `e2e/tests/settings-nav-copy.test.ts`
 * reads the `labelKey`s here to check that every "Settings → …" destination
 * quoted by the daemon or the agent prompt names a real page.
 */
export const SETTINGS_NAV_GROUPS: readonly SettingsNavGroup[] = [
  {
    id: 'app',
    headingKey: null,
    items: [
      { page: 'general', labelKey: 'settings.general', descriptionKey: 'settings.generalHint', icon: 'settings' },
      { page: 'account', labelKey: 'settings.account', descriptionKey: 'settings.accountHint', icon: 'users' },
    ],
  },
  {
    id: 'build',
    headingKey: 'settings.navGroupBuild',
    items: [
      { page: 'execution', labelKey: 'settings.envConfigure', descriptionKey: 'settings.subtitle', icon: 'robot' },
      { page: 'media', labelKey: 'settings.mediaProviders', descriptionKey: 'settings.mediaProvidersHint', icon: 'image' },
      { page: 'gameEngines', labelKey: 'gameEngine.settingsTitle', descriptionKey: 'gameEngine.settingsNavHint', icon: 'hammer' },
      { page: 'doctor', labelKey: 'doctor.title', descriptionKey: 'doctor.subtitle', icon: 'check' },
    ],
  },
  {
    id: 'system',
    headingKey: 'settings.navGroupSystem',
    items: [
      { page: 'integrations', labelKey: 'settings.mcpServerTitle', descriptionKey: 'settings.mcpServerHint', icon: 'link' },
      { page: 'privacy', labelKey: 'settings.privacy', descriptionKey: 'settings.privacyHint', icon: 'lock' },
      { page: 'advanced', labelKey: 'settings.advanced', descriptionKey: 'settings.advancedHint', icon: 'terminal' },
      { page: 'about', labelKey: 'settings.about', descriptionKey: 'settings.aboutHint', icon: 'info' },
    ],
  },
];

export function settingsNavItem(page: SettingsPage): SettingsNavItem | undefined {
  for (const group of SETTINGS_NAV_GROUPS) {
    const item = group.items.find((candidate) => candidate.page === page);
    if (item) return item;
  }
  return undefined;
}
