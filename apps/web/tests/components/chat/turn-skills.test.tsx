// @vitest-environment jsdom
/**
 * 消息里「这一轮用了 ××」这一行。断言屏幕上的字:用户看到的是中文名,不是内部 id。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { I18nProvider } from '../../../src/i18n';
import { SkillNamesProvider } from '../../../src/components/chat/SkillNames';
import { TurnSkills } from '../../../src/components/chat/TurnSkills';
import type { SkillSummary } from '../../../src/types';

afterEach(cleanup);

const skills = [
  { id: 'player-controller-2d', name: 'player-controller-2d', displayName: { en: 'Responsive 2D player controllers', 'zh-CN': '灵敏的 2D 玩家控制器' } },
  { id: 'phaser-game-dev', name: 'phaser-game-dev', displayName: { en: 'Phaser 3 craft', 'zh-CN': 'Phaser 3 游戏开发规范' } },
] as unknown as SkillSummary[];

function line(locale: 'zh-CN' | 'en', skillIds: string[], catalog = skills) {
  return render(
    <I18nProvider initial={locale}>
      <SkillNamesProvider skills={catalog}><TurnSkills skillIds={skillIds} /></SkillNamesProvider>
    </I18nProvider>,
  );
}

describe('TurnSkills', () => {
  it('names the skills in the interface language', () => {
    line('zh-CN', ['player-controller-2d', 'phaser-game-dev']);
    const text = screen.getByTestId('turn-skills').textContent;
    expect(text).toContain('这一轮用了');
    expect(text).toContain('灵敏的 2D 玩家控制器、Phaser 3 游戏开发规范');
    expect(text).not.toContain('player-controller-2d');
  });

  it('uses English names in English', () => {
    line('en', ['player-controller-2d']);
    expect(screen.getByTestId('turn-skills').textContent).toContain('Responsive 2D player controllers');
  });

  it('falls back to the id for a skill no longer in the catalogue', () => {
    line('zh-CN', ['gone-skill'], []);
    expect(screen.getByTestId('turn-skills').textContent).toContain('gone-skill');
  });

  it('renders nothing when the turn used no skill', () => {
    line('zh-CN', []);
    expect(screen.queryByTestId('turn-skills')).toBeNull();
  });
});
