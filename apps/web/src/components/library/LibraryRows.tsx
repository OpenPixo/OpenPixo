import type { ProjectFile } from '../../types';
import { AddToChatButton } from '../files/AddToChatButton';
import { Icon } from '../Icon';
import { EntryMenuButton, RenameInput, SelectCheck, type EntryContext } from './entry-controls';
import { categoryGlyph, categoryLabel, fileCategory, humanBytes, relativeTime } from './file-meta';
import { baseName, folderWithinDir, relativeToDir } from './library-entries';
import styles from './Library.module.css';

// 资源库 list mode: one compact row per folder or file. The row markup and
// its `df-*` classes are the Files list rows from before the merge (styled in
// styles/workspace/files.css), so tests and e2e flows keep their hooks.

export function FileRow({ file, ctx }: { file: ProjectFile; ctx: EntryContext }) {
  const category = fileCategory(file);
  const isSelected = ctx.selected.has(file.name);
  const renameState = ctx.renaming?.name === file.name ? ctx.renaming : null;
  // A flat result names the file and shows its folder underneath; a folder
  // listing shows the name relative to the folder being browsed.
  const label = ctx.flat ? baseName(file.name) : relativeToDir(file.name, ctx.currentDir);
  const folder = ctx.flat ? folderWithinDir(file.name, ctx.currentDir) : '';
  const open = () => ctx.onOpen(file.name);
  return (
    <div
      data-testid={`design-file-row-${file.name}`}
      className={`df-row df-file-row ${styles.row} ${isSelected ? 'selected' : ''}`}
      draggable={!renameState}
      onDragStart={(event) => ctx.onDragStart(event, file)}
      onContextMenu={(event) => ctx.onContextMenu(event, file.name)}
    >
      <SelectCheck className="df-row-check" name={file.name} checked={isSelected} ctx={ctx} />
      <span className="df-row-icon df-row-openable" data-kind={category} aria-hidden onClick={open}>
        {categoryGlyph(category)}
      </span>
      <div className="df-row-name-wrap">
        {renameState ? <RenameInput state={renameState} ctx={ctx} /> : (
          <button type="button" className="df-row-name-btn" onClick={open}>
            <span className="df-row-name-wrap">
              <span className="df-row-name" title={relativeToDir(file.name, ctx.currentDir)}>{label}</span>
              <span className="df-row-sub">
                <span>{categoryLabel(category, ctx.t)}</span>
                {folder ? <span className={styles.subDir}>{folder}</span> : null}
              </span>
            </span>
          </button>
        )}
      </div>
      <span className="df-row-size df-row-openable" onClick={open}>{humanBytes(file.size)}</span>
      <span className="df-row-time df-row-openable" onClick={open}>{relativeTime(file.mtime, ctx.t)}</span>
      {ctx.viewerOnly ? <span aria-hidden /> : <AddToChatButton name={file.name} onAdd={() => ctx.onAddToChat([file.name])} />}
      <EntryMenuButton name={file.name} ctx={ctx} />
    </div>
  );
}

export function DirRow({ path, name, count, ctx }: { path: string; name: string; count: number; ctx: EntryContext }) {
  return (
    <div className={`df-row df-dir-row ${styles.row}`} data-testid={`library-dir-${path}`} onClick={() => ctx.onOpenDir(path)}>
      <span className="df-row-check" aria-hidden />
      <span className="df-row-icon" data-kind="folder" aria-hidden>
        <Icon name="folder" size={14} />
      </span>
      <div className="df-row-name-wrap">
        <button
          type="button"
          className="df-row-name-btn"
          onClick={(event) => {
            event.stopPropagation();
            ctx.onOpenDir(path);
          }}
        >
          <span className="df-row-name-wrap">
            <span className="df-row-name" title={name}>{name}</span>
            <span className="df-row-sub">{ctx.t('filesPanel.folderCount', { n: count })}</span>
          </span>
        </button>
      </div>
      <span className="df-row-size" />
      <span className="df-row-time" />
      <span aria-hidden />
      <span className="df-row-menu df-row-menu-placeholder" aria-hidden />
    </div>
  );
}
