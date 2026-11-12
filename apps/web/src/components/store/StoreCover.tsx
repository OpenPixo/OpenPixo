import { useEffect, useMemo, useState, type CSSProperties, type ReactElement } from 'react';
import type { StoreCatalogItem } from '@openpixo/contracts';
import { nameSeed } from './workshop-catalog';
import styles from './StoreCover.module.css';

type CoverItem = Pick<StoreCatalogItem, 'name' | 'kind' | 'coverUrl'>;

/**
 * Cover artwork for a Workshop item. The designed pixel composition is always
 * painted underneath, so a cover that is missing, still loading or 404s reads
 * as intentional art instead of a broken image; a real cover fades in on top.
 */
export function StoreCover({ item, className, eager = false, zoom = false }: {
  item: CoverItem;
  className?: string;
  /** Above-the-fold art (the spotlight) loads immediately. */
  eager?: boolean;
  /** Lets a hovered parent card zoom the art. */
  zoom?: boolean;
}) {
  const [failed, setFailed] = useState<string>();
  const [loaded, setLoaded] = useState<string>();
  const src = item.coverUrl && failed !== item.coverUrl ? item.coverUrl : undefined;
  useEffect(() => { setLoaded(undefined); }, [src]);
  const state = !src ? 'fallback' : loaded === src ? 'loaded' : 'loading';
  return <div className={[styles.cover, zoom ? styles.zoom : '', className ?? ''].filter(Boolean).join(' ')} data-kind={item.kind} data-cover-state={state}>
    <CoverArt name={item.name} kind={item.kind} />
    {src ? <img className={styles.image} src={src} alt="" loading={eager ? 'eager' : 'lazy'} decoding="async" draggable={false}
      onLoad={() => setLoaded(src)} onError={() => setFailed(src)} /> : null}
  </div>;
}

/** Hue families per kind keep a shelf readable at a glance; the seed varies each item within its family. */
const KIND_HUES: Record<string, [number, number]> = {
  'asset-pack': [248, 300],
  skill: [262, 168],
  'project-template': [28, 340],
  mcp: [196, 150],
};

function random(seed: number) {
  let state = seed || 1;
  return () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return ((state >>> 0) % 10_000) / 10_000;
  };
}

const W = 40;
const H = 25;
const LIME = '#C4F542';

function CoverArt({ name, kind }: { name: string; kind: string }) {
  const art = useMemo(() => composeArt(name, kind), [name, kind]);
  return <div className={styles.art} style={art.style} aria-hidden="true" data-testid="store-cover-fallback">
    <svg className={styles.pixels} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" shapeRendering="crispEdges">{art.shapes}</svg>
  </div>;
}

function composeArt(name: string, kind: string): { style: CSSProperties; shapes: ReactElement[] } {
  const seed = nameSeed(name + ':' + kind);
  const next = random(seed);
  const [base, accent] = KIND_HUES[kind] ?? [250, 190];
  const hue = base + Math.round(next() * 36 - 18);
  const hue2 = accent + Math.round(next() * 40 - 20);
  const style = {
    '--cover-a': `hsl(${hue} 62% 22%)`,
    '--cover-b': `hsl(${hue2} 70% 46%)`,
    '--cover-glow': `hsl(${hue2} 90% 70% / 55%)`,
  } as CSSProperties;
  const shapes: ReactElement[] = [];
  const px = (x: number, y: number, fill: string, opacity = 1, w = 1, h = 1) =>
    shapes.push(<rect key={shapes.length} x={x} y={y} width={w} height={h} fill={fill} opacity={opacity} />);

  // Stars or dust give every composition depth.
  for (let index = 0; index < 22; index += 1) px(Math.floor(next() * W), Math.floor(next() * H * 0.6), '#fff', 0.15 + next() * 0.45);

  if (kind === 'asset-pack') {
    const sunX = 6 + Math.floor(next() * 26);
    px(sunX, 4, `hsl(${hue2 + 30} 95% 78%)`, 0.95, 4, 4);
    px(sunX - 1, 5, `hsl(${hue2 + 30} 95% 78%)`, 0.95, 6, 2);
    const ridge = (offset: number, amplitude: number, colour: string, grass: boolean) => {
      let height = offset + next() * amplitude;
      for (let x = 0; x < W; x += 1) {
        height = Math.max(offset - amplitude, Math.min(offset + amplitude, height + (next() - 0.5) * 2.4));
        const top = Math.round(H - height);
        px(x, top, colour, 1, 1, H - top);
        if (grass && next() > 0.35) px(x, top, LIME, 0.9);
        if (grass && next() > 0.93) { px(x, top - 2, `hsl(${hue2 - 40} 55% 30%)`, 1, 1, 2); px(x - 1, top - 3, LIME, 0.75, 3, 1); }
      }
    };
    ridge(12, 4, `hsl(${hue} 45% 30%)`, false);
    ridge(7, 3, `hsl(${hue} 50% 14%)`, true);
  } else if (kind === 'skill') {
    const cx = 20 + Math.round(next() * 8 - 4);
    const cy = 12;
    for (let d = -5; d <= 5; d += 1) { px(cx + d, cy, LIME, 1 - Math.abs(d) * 0.13); px(cx, cy + d, LIME, 1 - Math.abs(d) * 0.13); }
    for (let d = -2; d <= 2; d += 1) { px(cx + d, cy + d, '#fff', 0.55); px(cx + d, cy - d, '#fff', 0.55); }
    for (let index = 0; index < 5; index += 1) {
      const x = 3 + Math.floor(next() * 34);
      const y = 3 + Math.floor(next() * 19);
      if (Math.abs(x - cx) < 6 && Math.abs(y - cy) < 6) continue;
      px(x, y, LIME, 0.85); px(x - 1, y, LIME, 0.4); px(x + 1, y, LIME, 0.4); px(x, y - 1, LIME, 0.4); px(x, y + 1, LIME, 0.4);
    }
    for (let x = 0; x < W; x += 2) px(x, H - 2, '#fff', 0.08 + next() * 0.12, 1, 2);
  } else if (kind === 'project-template') {
    const left = 7;
    const top = 4;
    px(left, top, '#fff', 0.16, 26, 18);
    px(left, top, '#fff', 0.32, 26, 2);
    [0, 1, 2].forEach(index => px(left + 1 + index * 2, top + 0.5, index === 0 ? LIME : '#fff', 0.85));
    for (let row = 0; row < 4; row += 1) for (let col = 0; col < 6; col += 1) {
      const roll = next();
      const fill = roll > 0.82 ? LIME : roll > 0.45 ? `hsl(${hue2} 75% 70%)` : '#fff';
      px(left + 2 + col * 4, top + 3 + row * 4, fill, roll > 0.82 ? 0.9 : roll > 0.45 ? 0.55 : 0.12, 3, 3);
    }
  } else {
    const ay = 6 + Math.floor(next() * 6);
    const by = 9 + Math.floor(next() * 8);
    px(4, ay, '#fff', 0.85, 7, 7);
    px(5, ay + 1, `hsl(${hue} 60% 30%)`, 1, 5, 5);
    px(29, by, '#fff', 0.85, 7, 7);
    px(30, by + 1, `hsl(${hue2} 60% 34%)`, 1, 5, 5);
    const mid = 20;
    for (let x = 11; x < mid; x += 1) px(x, ay + 3, LIME, x % 2 ? 0.95 : 0.5);
    for (let y = Math.min(ay, by) + 3; y <= Math.max(ay, by) + 3; y += 1) px(mid, y, LIME, y % 2 ? 0.95 : 0.5);
    for (let x = mid; x < 29; x += 1) px(x, by + 3, LIME, x % 2 ? 0.95 : 0.5);
  }
  return { style, shapes };
}
