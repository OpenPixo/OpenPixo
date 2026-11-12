import { describe, expect, it } from 'vitest';

import {
  initialPanelNav,
  panelItems,
  panelItemView,
  panelTop,
  popPanelItem,
  pushPanelItem,
  removePanelItems,
  renamePanelItem,
  replacePanelItem,
  switchPanelView,
} from '../../../src/components/panel/panel-nav';

describe('panel navigation model', () => {
  it('starts on 游戏 with empty stacks', () => {
    const nav = initialPanelNav();
    expect(nav.view).toBe('game');
    expect(panelTop(nav)).toBeNull();
    expect(panelItems(nav)).toEqual([]);
  });

  it('pushes onto a view stack, optionally switching to it', () => {
    let nav = pushPanelItem(initialPanelNav(), 'library', 'a.png');
    expect(nav.view).toBe('game');
    expect(panelTop(nav, 'library')).toBe('a.png');
    nav = pushPanelItem(nav, 'library', 'b.png', { activate: true });
    expect(nav.view).toBe('library');
    expect(nav.stacks.library).toEqual(['a.png', 'b.png']);
  });

  it('keeps an item in one stack: re-opening moves it to the top of the target stack', () => {
    let nav = pushPanelItem(initialPanelNav(), 'game', 'a.png');
    nav = pushPanelItem(nav, 'library', 'b.png');
    nav = pushPanelItem(nav, 'library', 'a.png');
    expect(nav.stacks.game).toEqual([]);
    expect(nav.stacks.library).toEqual(['b.png', 'a.png']);
    expect(panelItemView(nav, 'a.png')).toBe('library');
  });

  it('returns the same object when a push changes nothing', () => {
    const nav = pushPanelItem(initialPanelNav('library'), 'library', 'a.png');
    expect(pushPanelItem(nav, 'library', 'a.png')).toBe(nav);
  });

  it('pops only the given view and leaves the others alone', () => {
    let nav = pushPanelItem(initialPanelNav(), 'game', 'terminal:1');
    nav = pushPanelItem(nav, 'library', 'a.png');
    const { nav: popped, popped: item } = popPanelItem(switchPanelView(nav, 'library'));
    expect(item).toBe('a.png');
    expect(popped.stacks.game).toEqual(['terminal:1']);
    expect(popPanelItem(initialPanelNav()).popped).toBeNull();
  });

  it('removes, renames and replaces items in place', () => {
    let nav = pushPanelItem(initialPanelNav(), 'library', 'a.png');
    nav = pushPanelItem(nav, 'library', 'b.png');
    nav = renamePanelItem(nav, 'a.png', 'c.png');
    expect(nav.stacks.library).toEqual(['c.png', 'b.png']);
    nav = replacePanelItem(nav, 'b.png', 'page.html', 'game');
    expect(nav.stacks.library).toEqual(['c.png', 'page.html']);
    nav = removePanelItems(nav, (item) => item === 'c.png');
    expect(nav.stacks.library).toEqual(['page.html']);
    expect(removePanelItems(nav, () => false)).toBe(nav);
  });
});
