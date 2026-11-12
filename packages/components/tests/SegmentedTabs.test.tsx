// @vitest-environment jsdom

import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SegmentedTabs } from '../src/segmented-tabs';
import type { SegmentedTab } from '../src/segmented-tabs';

afterEach(cleanup);

const items: SegmentedTab[] = [
  { value: 'skills', label: '技能', count: 18, id: 'skills-tab', panelId: 'skills-panel' },
  { value: 'connections', label: 'MCP 连接', count: 0, disabled: true },
  { value: 'templates', label: '项目模板', count: 5 },
];

function ControlledTabs({ vertical = false }: { vertical?: boolean }) {
  const [value, setValue] = useState('skills');
  return <SegmentedTabs label="工坊分类" items={items} value={value} onValueChange={setValue} orientation={vertical ? 'vertical' : 'horizontal'} />;
}

describe('SegmentedTabs', () => {
  it('exposes labelled tabs, counts, panel linkage and a single tab stop', () => {
    render(<ControlledTabs />);

    expect(screen.getByRole('tablist', { name: '工坊分类' }).getAttribute('aria-orientation')).toBe('horizontal');
    const selected = screen.getByRole('tab', { name: '技能 18', selected: true });
    expect(selected.id).toBe('skills-tab');
    expect(selected.getAttribute('aria-controls')).toBe('skills-panel');
    expect(selected.tabIndex).toBe(0);
    expect(screen.getByRole('tab', { name: '项目模板 5' }).tabIndex).toBe(-1);
    expect(screen.getByRole('tab', { name: 'MCP 连接 0' }).hasAttribute('disabled')).toBe(true);
  });

  it('selects on arrows, skips disabled tabs, wraps and supports Home and End', () => {
    render(<ControlledTabs />);
    const first = screen.getByRole('tab', { name: '技能 18' });
    const last = screen.getByRole('tab', { name: '项目模板 5' });

    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(last.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(last);
    expect(last.tabIndex).toBe(0);

    fireEvent.keyDown(last, { key: 'ArrowRight' });
    expect(first.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(first, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: 'Home' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: 'End' });
    expect(document.activeElement).toBe(last);
  });

  it('uses Up and Down for vertical tabs and preserves other browser shortcuts', () => {
    render(<ControlledTabs vertical />);
    const first = screen.getByRole('tab', { name: '技能 18' });
    const last = screen.getByRole('tab', { name: '项目模板 5' });

    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(first.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(first, { key: 'ArrowDown', ctrlKey: true });
    expect(first.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(first);
  });

  it('reports clicks through the controlled callback and leaves disabled tabs inert', () => {
    const onValueChange = vi.fn();
    render(<SegmentedTabs label="Workshop" items={items} value="skills" onValueChange={onValueChange} />);
    fireEvent.click(screen.getByRole('tab', { name: 'MCP 连接 0' }));
    expect(onValueChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('tab', { name: '项目模板 5' }));
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith('templates');
    expect(screen.getByRole('tab', { name: '技能 18' }).getAttribute('aria-selected')).toBe('true');
  });

  it('keeps an enabled tab reachable if the selected value disappears', () => {
    const { rerender } = render(<SegmentedTabs label="Workshop" items={items} value="missing" onValueChange={vi.fn()} />);
    expect(screen.getByRole('tab', { name: '技能 18' }).tabIndex).toBe(0);

    rerender(<SegmentedTabs label="Workshop" items={items.map((item) => ({ ...item, disabled: true }))} value="skills" onValueChange={vi.fn()} />);
    expect(screen.getAllByRole('tab').every((tab) => tab.tabIndex === -1 && tab.getAttribute('aria-selected') === 'false')).toBe(true);
  });
});
