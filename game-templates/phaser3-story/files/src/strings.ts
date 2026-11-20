/**
 * Every menu and button string, per language. A language here is a folder name
 * under story/ (`en`, `zh_CN`); add a column to every string when you add one.
 * The story's own text lives in story/, not here.
 */
const STRINGS = {
  LANGUAGE_NAME: { en: 'English', zh_CN: '简体中文' },
  MENU_CONTINUE: { en: 'Continue', zh_CN: '继续游戏' },
  MENU_NEW_GAME: { en: 'New game', zh_CN: '新游戏' },
  MENU_SETTINGS: { en: 'Settings', zh_CN: '设置' },
  MENU_PAUSED: { en: 'Paused', zh_CN: '已暂停' },
  MENU_RESUME: { en: 'Resume', zh_CN: '返回游戏' },
  MENU_QUIT_TITLE: { en: 'Quit to title screen', zh_CN: '返回标题画面' },
  SETTINGS_LANGUAGE: { en: 'Language', zh_CN: '语言' },
  SETTINGS_LANGUAGE_SYSTEM: { en: 'System language', zh_CN: '跟随系统' },
  SETTINGS_VOLUME_MUSIC: { en: 'Music volume', zh_CN: '音乐音量' },
  SETTINGS_VOLUME_SFX: { en: 'Sound effects volume', zh_CN: '音效音量' },
  SETTINGS_FULLSCREEN: { en: 'Fullscreen', zh_CN: '全屏' },
  SETTINGS_ON: { en: 'On', zh_CN: '开' },
  SETTINGS_OFF: { en: 'Off', zh_CN: '关' },
  SETTINGS_BACK: { en: 'Back', zh_CN: '返回' },
  SETTINGS_ROW: { en: '{name}: {value}', zh_CN: '{name}：{value}' },
  SETTINGS_HINT: { en: '← → to change', zh_CN: '← → 调整' },
  STORY_LOG: { en: 'Log', zh_CN: '回顾' },
  STORY_AUTO: { en: 'Auto', zh_CN: '自动' },
  STORY_SKIP: { en: 'Skip', zh_CN: '快进' },
  STORY_LOG_TITLE: { en: 'Story so far', zh_CN: '剧情回顾' },
  STORY_LOG_EMPTY: { en: 'Nothing yet.', zh_CN: '还没有内容。' },
  STORY_LOG_CLOSE: { en: 'Close', zh_CN: '关闭' },
  STORY_THE_END: { en: 'The End', zh_CN: '完' },
  STORY_ENDINGS_FOUND: { en: 'Endings found: {found} of {total}', zh_CN: '已发现结局：{found} / {total}' },
  STORY_BACK_TO_TITLE: { en: 'Back to title screen', zh_CN: '返回标题画面' },
} satisfies Record<string, Record<string, string>>;

export type StringKey = keyof typeof STRINGS;

let current = 'en';

/** The language menus use: a story folder name such as "en" or "zh_CN". */
export function useLanguage(language: string): void {
  current = language;
}

export function currentLanguage(): string {
  return current;
}

/** A string in the current language, falling back to English, with {name} filled in. */
export function t(key: StringKey, values: Record<string, string | number> = {}): string {
  const row: Record<string, string> = STRINGS[key];
  const text = row[current] ?? row.en ?? key;
  return text.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ''));
}

/** A language's own name, such as "简体中文", or its folder name when the table has none. */
export function languageName(language: string): string {
  const row: Record<string, string> = STRINGS.LANGUAGE_NAME;
  return row[language] ?? language;
}
