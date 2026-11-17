// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { GameStage, gameStageContent } from '../../../src/components/game/GameStage';
import { I18nProvider } from '../../../src/i18n';

function liveFrame(engine?: Parameters<typeof gameStageContent>[0]['engine']) {
  const content = gameStageContent({ running: true, liveUrl: 'http://127.0.0.1:5173/', shot: null, engine });
  render(<I18nProvider initial="en"><GameStage content={content} /></I18nProvider>);
  return screen.getByTestId('panel-game-frame');
}

afterEach(cleanup);

describe('live game frame', () => {
  it.each(['phaser', 'threejs'] as const)('never shows page scrollbars for the canvas engine %s', (engine) => {
    expect(liveFrame(engine).getAttribute('scrolling')).toBe('no');
  });

  it.each(['web-generic', undefined] as const)('lets a page-based game (%s) scroll to reach its content', (engine) => {
    expect(liveFrame(engine).hasAttribute('scrolling')).toBe(false);
  });

  it('reloads the same game in place when its reload key changes', () => {
    const content = gameStageContent({ running: true, liveUrl: 'http://127.0.0.1:5173/', shot: null, engine: 'phaser' });
    const view = render(<I18nProvider initial="en"><GameStage content={content} reloadKey={0} /></I18nProvider>);
    const first = screen.getByTestId('panel-game-frame');
    view.rerender(<I18nProvider initial="en"><GameStage content={content} reloadKey={1} /></I18nProvider>);
    expect(screen.getAllByTestId('panel-game-frame')).toHaveLength(1);
    expect(screen.getByTestId('panel-game-frame')).not.toBe(first);
  });
});

// Seen 2026-11-18: for the ~10 s a Phaser game takes to start, the toolbar said
// 「正在启动…」 while the stage still said 「还没有运行。点「运行」」 with a Run button.
describe('empty stage while the game starts', () => {
  it('says the game is starting and offers no second Run button', () => {
    const content = gameStageContent({ running: false, liveUrl: null, shot: null });
    render(<I18nProvider initial="zh-CN"><GameStage content={content} onRun={() => {}} startingLabel="正在启动…" /></I18nProvider>);
    const stage = screen.getByTestId('panel-game-stage');
    expect(stage.textContent).toContain('正在启动…');
    expect(stage.textContent).not.toContain('还没有运行');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('keeps the Run button when nothing is starting', () => {
    const content = gameStageContent({ running: false, liveUrl: null, shot: null });
    render(<I18nProvider initial="zh-CN"><GameStage content={content} onRun={() => {}} /></I18nProvider>);
    expect(screen.getByTestId('panel-game-stage').textContent).toContain('还没有运行');
    expect(screen.getByRole('button')).toBeTruthy();
  });
});
