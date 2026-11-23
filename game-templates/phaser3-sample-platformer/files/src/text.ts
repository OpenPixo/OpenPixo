/** Every word the game shows, in the player's language. Add a language by adding a row to `WORDS`. */
interface Words {
  /** A font with this language's characters on every desktop. */
  font: string;
  title: string;
  controls: string;
  status: (score: number, total: number) => string;
  won: (score: number, total: number) => string;
}

const WORDS: Record<'en' | 'zh', Words> = {
  en: {
    font: 'monospace',
    title: 'Pixel platformer sample',
    controls: 'Arrows / A D: move   Up / W / Space: jump   R: restart',
    status: (score, total) => `Coins: ${score} / ${total}   Reach the flag!`,
    won: (score, total) => `You win!\nCoins: ${score} / ${total}\nSpace / Enter / click to restart`,
  },
  zh: {
    font: '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif',
    title: '像素平台跳跃示例',
    controls: '← → 或 A D：移动   ↑、W 或空格：跳   R：重来',
    status: (score, total) => `金币：${score} / ${total}   跑到旗子那里！`,
    won: (score, total) => `你赢了！\n金币：${score} / ${total}\n空格 / 回车 / 点击再玩一次`,
  },
};

/** The first language the browser asks for that the game has; English otherwise. */
export function wordsFor(languages: readonly string[]): Words {
  for (const language of languages) {
    const code = language.toLowerCase().split('-')[0];
    if (code === 'zh' || code === 'en') return WORDS[code];
  }
  return WORDS.en;
}

export const words = wordsFor(navigator.languages?.length ? navigator.languages : [navigator.language]);
