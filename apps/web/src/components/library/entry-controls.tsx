import type { DragEvent, MouseEvent } from 'react';
import type { ProjectFile } from '../../types';
import { RemixIcon } from '../RemixIcon';
import type { TranslateFn } from './file-meta';

export interface RenameState {
  name: string;
  draft: string;
  saving: boolean;
}

/**
 * Everything a list row or grid card needs from the browser. One object so
 * the two renderings stay interchangeable: the list / grid toggle only swaps
 * the component, never the behaviour.
 */
export interface EntryContext {
  projectId: string;
  /** Directory the browser shows; names render relative to it. */
  currentDir: string;
  /** The listing is a flat search / type result: entries show their folder. */
  flat: boolean;
  viewerOnly: boolean;
  filesRefreshKey: number;
  selected: ReadonlySet<string>;
  renaming: RenameState | null;
  t: TranslateFn;
  onOpen: (name: string) => void;
  onOpenDir: (path: string) => void;
  onToggleSelect: (name: string) => void;
  onMenu: (name: string, anchor: HTMLElement) => void;
  onContextMenu: (event: MouseEvent<HTMLElement>, name: string) => void;
  onDragStart: (event: DragEvent<HTMLElement>, file: ProjectFile) => void;
  onAddToChat: (names: readonly string[]) => void;
  onStartRename: (name: string) => void;
  onRenameDraft: (state: RenameState) => void;
  onCommitRename: (name: string, draft: string) => void;
  onCancelRename: () => void;
}

/** Hover-revealed selection chip (always visible once anything is selected). */
export function SelectCheck({
  className,
  name,
  checked,
  ctx,
}: {
  className: string;
  name: string;
  checked: boolean;
  ctx: EntryContext;
}) {
  // Read-only viewers cannot batch-select (batch actions mutate).
  if (ctx.viewerOnly) return <span className={className} aria-hidden />;
  return (
    <span
      className={className}
      role="checkbox"
      aria-checked={checked}
      aria-label={ctx.t('gameAssets.selectFile', { name })}
      tabIndex={0}
      onClick={(event) => {
        event.stopPropagation();
        ctx.onToggleSelect(name);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        ctx.onToggleSelect(name);
      }}
    >
      <RemixIcon name={checked ? 'checkbox-line' : 'checkbox-blank-line'} size={14} />
    </span>
  );
}

/** The ⋯ trigger of an entry's menu (right-click opens the same menu). */
export function EntryMenuButton({ name, className, ctx }: { name: string; className?: string; ctx: EntryContext }) {
  return (
    <span
      data-testid={`design-file-menu-${name}`}
      className={['df-row-menu', className].filter(Boolean).join(' ')}
      role="button"
      tabIndex={0}
      aria-label={ctx.t('filesPanel.rowMenu')}
      aria-haspopup="menu"
      onClick={(event) => {
        event.stopPropagation();
        ctx.onMenu(name, event.currentTarget);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        ctx.onMenu(name, event.currentTarget);
      }}
    >
      ⋯
    </span>
  );
}

/** Inline rename field: Enter commits, Esc cancels, blur commits. */
export function RenameInput({ state, ctx }: { state: RenameState; ctx: EntryContext }) {
  return (
    <input
      autoFocus
      className="df-rename-input"
      aria-label={ctx.t('common.rename')}
      value={state.draft}
      disabled={state.saving}
      onChange={(event) => ctx.onRenameDraft({ ...state, draft: event.target.value })}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onBlur={(event) => {
        if (event.currentTarget.dataset.skipRenameCommit === '1') return;
        ctx.onCommitRename(state.name, state.draft);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.dataset.skipRenameCommit = '1';
          ctx.onCommitRename(state.name, state.draft);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          // Esc here cancels the rename; it must not also pop the panel stack.
          event.stopPropagation();
          event.currentTarget.dataset.skipRenameCommit = '1';
          ctx.onCancelRename();
        }
      }}
    />
  );
}
