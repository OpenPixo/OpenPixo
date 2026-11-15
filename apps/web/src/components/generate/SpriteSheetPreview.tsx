import { useEffect, useState } from 'react';
import type { RecipeCandidate, RecipeRun } from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import { stagedFileUrl } from '../studio/CandidateGrid';
import styles from './SpriteSheetPreview.module.css';

/** What `export-spritesheet` writes beside every sheet (`<name>.sheet.json`). */
export interface SpriteSheetLayout {
  image: string;
  cell: { width: number; height: number };
  columns: number;
  rows: number;
  fps: number;
  loop: boolean;
  animations: string[];
}

/** Where a result's sheet layout and its picture are among the staged files, or null for a result without one. */
export function spriteSheetFiles(candidate: Pick<RecipeCandidate, 'stagedFiles'>): { layout: number; image: number } | null {
  const name = (ref: string) => ref.split(/[\\/]/u).at(-1) ?? '';
  const layout = candidate.stagedFiles.findIndex(file => name(file.ref).endsWith('.sheet.json'));
  if (layout < 0) return null;
  const stem = name(candidate.stagedFiles[layout]!.ref).slice(0, -'.sheet.json'.length);
  const image = candidate.stagedFiles.findIndex(file => name(file.ref) === `${stem}.png`);
  return image < 0 ? null : { layout, image };
}

export function parseSpriteSheetLayout(value: unknown): SpriteSheetLayout | null {
  const item = value as Partial<SpriteSheetLayout> | null;
  const positive = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n > 0;
  if (!item || typeof item.image !== 'string' || !positive(item.cell?.width) || !positive(item.cell?.height) || !Number.isInteger(item.columns)
    || !Number.isInteger(item.rows) || !positive(item.columns) || !positive(item.rows) || !positive(item.fps) || !Array.isArray(item.animations)
    || item.animations.length !== item.rows || item.animations.some(name => typeof name !== 'string')) return null;
  return item as SpriteSheetLayout;
}

/** Arrows for the eight directions, so the tiles read the same in every language. */
const ARROWS: Record<string, string> = { down: '↓', 'down-right': '↘', right: '→', 'up-right': '↗', up: '↑', 'up-left': '↖', left: '←', 'down-left': '↙' };

const TILE = 112;

/**
 * Plays every animation of an exported sprite sheet at once, one tile per row of the sheet, at
 * the sheet's own frame rate: what the game will show, rather than the clip it was cut from.
 * With reduced motion it shows each animation's first frame.
 */
export function SpriteSheetPreview({ run, candidate }: { run: RecipeRun; candidate: RecipeCandidate }) {
  const { t } = useI18n();
  const files = spriteSheetFiles(candidate);
  const [layout, setLayout] = useState<SpriteSheetLayout | null>(null);
  const [frame, setFrame] = useState(0);
  const layoutUrl = files ? stagedFileUrl(run, candidate, files.layout) : null;
  useEffect(() => {
    if (!layoutUrl) return;
    const controller = new AbortController();
    void fetch(layoutUrl, { signal: controller.signal }).then(response => response.ok ? response.json() : null)
      .then(value => { if (!controller.signal.aborted) setLayout(parseSpriteSheetLayout(value)); }).catch(() => {});
    return () => controller.abort();
  }, [layoutUrl]);
  useEffect(() => {
    if (!layout || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(() => setFrame(value => (value + 1) % layout.columns), 1000 / layout.fps);
    return () => window.clearInterval(timer);
  }, [layout]);
  if (!files || !layout) return null;
  const scale = Math.min(TILE / layout.cell.width, TILE / layout.cell.height);
  const width = layout.cell.width * scale, height = layout.cell.height * scale;
  const sheet = stagedFileUrl(run, candidate, files.image);
  return <div className={styles.grid} role="group" aria-label={t('generate.spritePreview')} data-testid="generate-sprite-preview">
    {layout.animations.map((name, row) => <figure key={name} className={styles.tile}>
      <div className={styles.sprite} role="img" aria-label={name} style={{ width, height, backgroundImage: `url("${sheet}")`,
        backgroundSize: `${layout.columns * width}px ${layout.rows * height}px`, backgroundPosition: `${-frame * width}px ${-row * height}px` }} />
      <figcaption className={styles.name}>{ARROWS[name] ? <span aria-hidden="true">{ARROWS[name]} </span> : null}{name}</figcaption>
    </figure>)}
  </div>;
}
