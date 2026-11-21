import type { ReactNode } from 'react';
import { FolderOpen, Gamepad2, MessageSquareText } from 'lucide-react';
import { useI18n } from '../../i18n';
import type { Dict } from '../../i18n/types';
import styles from './HomeStartPaths.module.css';

export interface HomeStartPathsProps {
  /** Puts the user where they type an idea (the composer, or the new-game dialog). */
  onIdea?: () => void;
  onOpenFolder?: () => void;
  folderBusy?: boolean;
  onSample?: () => void;
  sampleBusy?: boolean;
  /** Accessible name of the tile group. */
  label: string;
  className?: string;
}

interface Tile {
  id: 'idea' | 'folder' | 'sample';
  icon: ReactNode;
  title: keyof Dict;
  body: keyof Dict;
  cost: keyof Dict;
  onClick: () => void;
  busy?: boolean;
}

/**
 * The ways a game can start, as option tiles: say an idea, open a folder, or
 * play the finished sample. A tile appears only when its action exists here.
 */
export function HomeStartPaths({ onIdea, onOpenFolder, folderBusy, onSample, sampleBusy, label, className }: HomeStartPathsProps) {
  const { t } = useI18n();
  const tiles: Tile[] = [];
  if (onIdea) tiles.push({ id: 'idea', icon: <MessageSquareText size={18} />, title: 'home.paths.ideaTitle',
    body: 'home.paths.ideaBody', cost: 'home.paths.ideaCost', onClick: onIdea });
  if (onOpenFolder) tiles.push({ id: 'folder', icon: <FolderOpen size={18} />, title: 'home.paths.folderTitle',
    body: 'home.paths.folderBody', cost: 'home.paths.instant', onClick: onOpenFolder, busy: folderBusy });
  if (onSample) tiles.push({ id: 'sample', icon: <Gamepad2 size={18} />, title: 'home.paths.sampleTitle',
    body: 'home.paths.sampleBody', cost: 'home.paths.instant', onClick: onSample, busy: sampleBusy });
  if (tiles.length === 0) return null;
  return <div className={[styles.tiles, className].filter(Boolean).join(' ')} role="group" aria-label={label}
    data-testid="home-start-paths">
    {tiles.map(tile => <button key={tile.id} type="button" className={styles.tile} data-path={tile.id}
      disabled={tile.busy} aria-busy={tile.busy || undefined} onClick={tile.onClick}>
      <span className={styles.icon} aria-hidden="true">{tile.icon}</span>
      <span className={styles.title}>{t(tile.title)}</span>
      <span className={styles.body}>{tile.busy ? t('home.paths.busy') : t(tile.body)}</span>
      <span className={styles.cost}>{t(tile.cost)}</span>
    </button>)}
  </div>;
}
