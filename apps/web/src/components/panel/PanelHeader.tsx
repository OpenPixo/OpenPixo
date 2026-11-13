import { useEffect, useRef, useState, type ReactNode } from 'react';
import { SegmentedTabs, type SegmentedTab } from '@openpixo/components';
import { useT } from '../../i18n';
import { Icon } from '../Icon';
import { PanelMenu, type PanelMenuItem } from './PanelMenu';
import { PANEL_VIEWS, type PanelView } from './panel-nav';
import styles from './PanelHeader.module.css';

/** Below this panel width the engine chip is dropped so the header keeps one row. */
export const PANEL_HEADER_COMPACT_WIDTH = 520;

const VIEW_LABEL_KEYS = {
  game: 'panel.view.game',
  changes: 'panel.view.changes',
  library: 'panel.view.library',
  generate: 'panel.view.generate',
} as const;

export interface PanelHeaderProps {
  view: PanelView;
  onViewChange: (view: PanelView) => void;
  /** Count shown on 改动; hidden when 0 or undefined (fed by the Changes slice). */
  changesBadge?: number;
  /** Focus mode docks the project tab strip at the start of this row. */
  leading?: ReactNode;
  /** Project-level controls: engine chip, then checkpoints. */
  actions?: ReactNode;
  menuItems: readonly PanelMenuItem[];
  focusMode: boolean;
  onFocusModeChange?: (next: boolean) => void;
  /** False while the first materialization is pending: no switcher, no actions. */
  ready: boolean;
}

/**
 * The panel's one 48px header row (specs/current/openpixo-game-panel.md §3):
 * view switcher, then engine chip, checkpoints, ⋯ and maximise / restore.
 *
 * Keeps the `ws-tabs-*` global class names because the shell stylesheet
 * (styles/workspace/project-shell.css) sizes the row, drops the engine chip in
 * compact mode and clears the floating update control through them.
 */
export function PanelHeader({
  view,
  onViewChange,
  changesBadge,
  leading,
  actions,
  menuItems,
  focusMode,
  onFocusModeChange,
  ready,
}: PanelHeaderProps) {
  const t = useT();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [compact, setCompact] = useState(false);
  // Measured, not a container query: size containment would trap the
  // header's fixed popovers.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setCompact(root.clientWidth < PANEL_HEADER_COMPACT_WIDTH));
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  const badge = changesBadge && changesBadge > 0 ? changesBadge : 0;
  const items: SegmentedTab[] = PANEL_VIEWS.map((value) => ({
    value,
    id: `panel-view-${value}`,
    label: value === 'changes' && badge > 0 ? (
      <>
        {t(VIEW_LABEL_KEYS[value])}
        <span className={styles.badge} data-testid="panel-changes-badge" aria-label={t('panel.changesBadge', { n: badge })}>
          {badge > 99 ? '99+' : badge}
        </span>
      </>
    ) : t(VIEW_LABEL_KEYS[value]),
  }));
  const focusLabel = focusMode ? t('workspace.showChat') : t('projectShell.maximizePanel');

  return (
    <div
      ref={rootRef}
      className={`ws-tabs-shell ${styles.header}`}
      data-compact={compact || undefined}
      data-testid="panel-header"
    >
      {leading}
      {ready ? (
        <SegmentedTabs
          className={styles.switcher}
          items={items}
          value={view}
          onValueChange={(next) => onViewChange(next as PanelView)}
          label={t('panel.views')}
          data-testid="panel-view-switcher"
        />
      ) : null}
      <div className={`ws-tabs-actions ${styles.actions}`}>
        {ready && actions ? <div className="ws-tabs-project-actions">{actions}</div> : null}
        {ready ? <PanelMenu label={t('panel.more')} items={menuItems} /> : null}
        {onFocusModeChange ? (
          <button
            type="button"
            className={`icon-only ${focusMode ? 'ws-focus-expand' : 'ws-focus-maximize'} pixo-tooltip`}
            data-testid={focusMode ? 'workspace-focus-toggle' : 'workspace-maximize-toggle'}
            aria-pressed={focusMode}
            title={focusLabel}
            data-tooltip={focusLabel}
            data-tooltip-placement="bottom"
            aria-label={focusLabel}
            onClick={() => onFocusModeChange(!focusMode)}
          >
            <Icon name={focusMode ? 'minimize' : 'maximize'} size={15} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
