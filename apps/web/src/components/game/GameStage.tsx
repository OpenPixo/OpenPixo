import { Button } from '@openpixo/components';
import type { GameEngineId } from '@openpixo/contracts';
import { Play } from 'lucide-react';

import { useT } from '../../i18n';
import { Icon } from '../Icon';
import styles from './GameStage.module.css';

export type GameStageContent =
  | { kind: 'live'; url: string; fixedPage: boolean }
  | { kind: 'native'; shot: GameStageShot | null }
  | { kind: 'shot'; shot: GameStageShot }
  | { kind: 'empty' };

export interface GameStageShot { src: string; alt: string; source: 'verify' | 'playtest' }

/**
 * What the 游戏 stage shows (specs/current/openpixo-game-panel.md §4), in
 * order: a running web game whose URL passed the loopback check plays live;
 * a running game without one (Godot, Unity, desktop builds) is in its own
 * window, so the stage says so over the last screenshot; otherwise the newest
 * screenshot; otherwise the empty state.
 */
export function gameStageContent({ running, liveUrl, shot, engine }: {
  running: boolean; liveUrl: string | null; shot: GameStageShot | null; engine?: GameEngineId;
}): GameStageContent {
  if (running && liveUrl) return { kind: 'live', url: liveUrl, fixedPage: engine === 'phaser' || engine === 'threejs' };
  if (running) return { kind: 'native', shot };
  if (shot) return { kind: 'shot', shot };
  return { kind: 'empty' };
}

/**
 * The stage. The live iframe keeps the former preview's sandbox flags and
 * referrer policy, and keeps its place in the tree for as long as the same
 * URL is live, so maximising the panel or switching views never reloads the
 * game. A canvas engine's page never scrolls, whatever the project's own CSS
 * does; a page-based web game may need to.
 */
export function GameStage({ content, onRun, runDisabled, reloadKey = 0 }: {
  content: GameStageContent;
  /** Absent when this project cannot run here (no Run button then). */
  onRun?: () => void;
  runDisabled?: boolean;
  /** Changing it reloads the live game (after tuning writes new values). */
  reloadKey?: number;
}) {
  const t = useT();
  return <div className={styles.stage} data-testid="panel-game-stage" data-stage={content.kind}>
    {content.kind === 'live' ? <iframe key={`${content.url}#${reloadKey}`}className={styles.frame} src={content.url} title={t('gameRun.preview')}
      sandbox="allow-scripts allow-same-origin allow-pointer-lock" referrerPolicy="no-referrer" scrolling={content.fixedPage ? 'no' : undefined} data-testid="panel-game-frame" /> : null}
    {content.kind === 'shot' || (content.kind === 'native' && content.shot) ? (
      <img className={styles.shot} src={content.kind === 'shot' ? content.shot.src : content.shot!.src}
        alt={content.kind === 'shot' ? content.shot.alt : content.shot!.alt} data-testid="panel-game-shot" />
    ) : null}
    {content.kind === 'native' ? <div className={styles.native} data-has-shot={content.shot ? true : undefined} role="status">
      <Icon name="external-link" size={16} className={styles.icon} />
      <p className={styles.title}>{t('panel.game.nativeWindow')}</p>
      <p className={styles.body}>{t(content.shot ? 'panel.game.nativeWindowShot' : 'panel.game.nativeWindowNoShot')}</p>
    </div> : null}
    {content.kind === 'empty' ? <div className={styles.empty}>
      <Icon name="play" size={20} className={styles.icon} />
      <p className={styles.title}>{t('panel.game.emptyTitle')}</p>
      {onRun ? <Button size="sm" variant="primary" className={styles.run} disabled={runDisabled} onClick={onRun}>
        <Play size={13} aria-hidden="true" />{t('gameRun.run')}
      </Button> : null}
    </div> : null}
  </div>;
}
