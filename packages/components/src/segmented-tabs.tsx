import { useId, useRef } from 'react';
import type { HTMLAttributes, KeyboardEvent, ReactNode } from 'react';

import { joinClassNames } from './class-names';
import styles from './segmented-tabs.module.css';

export interface SegmentedTab {
  value: string;
  label: ReactNode;
  count?: number | string;
  disabled?: boolean;
  id?: string;
  panelId?: string;
}

export interface SegmentedTabsProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'onChange'> {
  items: readonly SegmentedTab[];
  value: string;
  onValueChange: (value: string) => void;
  /** Accessible name for the tab group, supplied in the caller's locale. */
  label: string;
  orientation?: 'horizontal' | 'vertical';
}

export function SegmentedTabs({
  items,
  value,
  onValueChange,
  label,
  orientation = 'horizontal',
  className,
  id,
  dir,
  ...props
}: SegmentedTabsProps) {
  const generatedId = useId();
  const groupId = id ?? generatedId;
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = items.findIndex((item) => item.value === value && !item.disabled);
  const focusIndex = selectedIndex < 0 ? items.findIndex((item) => !item.disabled) : selectedIndex;

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.defaultPrevented) return;
    const previousKey = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft';
    const nextKey = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight';
    if (![previousKey, nextKey, 'Home', 'End'].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;

    event.preventDefault();
    const enabled = items.flatMap((item, itemIndex) => item.disabled ? [] : [itemIndex]);
    if (enabled.length === 0) return;

    let nextIndex: number | undefined;
    if (event.key === 'Home') nextIndex = enabled[0];
    else if (event.key === 'End') nextIndex = enabled[enabled.length - 1];
    else {
      const isRtl = orientation === 'horizontal' && getComputedStyle(event.currentTarget).direction === 'rtl';
      const direction = (event.key === nextKey ? 1 : -1) * (isRtl ? -1 : 1);
      const position = enabled.indexOf(index);
      nextIndex = enabled[(position + direction + enabled.length) % enabled.length];
    }

    const nextItem = nextIndex === undefined ? undefined : items[nextIndex];
    if (nextItem && nextIndex !== undefined) {
      onValueChange(nextItem.value);
      tabRefs.current[nextIndex]?.focus();
    }
  }

  return (
    <div
      {...props}
      id={groupId}
      dir={dir}
      role="tablist"
      aria-label={label}
      aria-orientation={orientation}
      className={joinClassNames(styles.tabs, className)}
    >
      {items.map((item, index) => (
        <button
          key={item.value}
          ref={(element) => { tabRefs.current[index] = element; }}
          id={item.id ?? `${groupId}-tab-${index}`}
          className={styles.tab}
          type="button"
          role="tab"
          disabled={item.disabled}
          aria-selected={index === selectedIndex}
          aria-controls={item.panelId}
          tabIndex={index === focusIndex ? 0 : -1}
          onClick={() => onValueChange(item.value)}
          onKeyDown={(event) => handleKeyDown(event, index)}
        >
          {item.label}
          {item.count !== undefined && <>{' '}<span className={styles.count}>{item.count}</span></>}
        </button>
      ))}
    </div>
  );
}
