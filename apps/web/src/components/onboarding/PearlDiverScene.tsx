import { useEffect, useRef, useState } from 'react';
import styles from './WelcomeHero.module.css';

/**
 * The little game in the first-run hero, drawn as vector pixel art so it stays
 * sharp at any window size. Everything here is original to OpenPixo and carries
 * no text, so it needs no translation.
 *
 * One art pixel always covers a whole number of screen pixels: `useArtViewBox`
 * widens or narrows how much of the world is visible instead of stretching it,
 * which is why the water and seabed bleed past the 210 x 131 safe area.
 */

const SAFE_W = 210;
const SAFE_H = 131;
const BLEED_X = 80;
const BLEED_Y = 50;
const LEFT = -BLEED_X;
const RIGHT = SAFE_W + BLEED_X;
const BOTTOM = SAFE_H + BLEED_Y;

type Palette = Record<string, string>;

/** Merges each row's same-colour pixels into runs, one path per colour. */
function spritePaths(rows: readonly string[], palette: Palette): Array<{ fill: string; d: string }> {
  const byColour = new Map<string, string>();
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const key = row[x] ?? '.';
      let end = x + 1;
      while (end < row.length && row[end] === key) end += 1;
      const fill = palette[key];
      if (fill) byColour.set(fill, `${byColour.get(fill) ?? ''}M${x} ${y}h${end - x}v1h-${end - x}z`);
      x = end;
    }
  });
  return [...byColour].map(([fill, d]) => ({ fill, d }));
}

function Sprite({ rows, palette, x, y, className }: {
  rows: readonly string[];
  palette: Palette;
  x: number;
  y: number;
  className?: string;
}) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <g className={className}>
        {spritePaths(rows, palette).map(({ fill, d }) => <path key={fill} fill={fill} d={d} />)}
      </g>
    </g>
  );
}

/* ---- Water ------------------------------------------------------------ */

const WATER = ['#35BFC4', '#26A5BC', '#1C8AAE', '#16709F', '#13598E', '#11457B', '#0F3568', '#0D2854', '#0B1F44'];
const BAND_H = 16;

function Water() {
  return (
    <>
      <defs>
        {WATER.slice(1).map((colour, index) => (
          <pattern key={colour} id={`pearl-dither-${index}`} width="2" height="2" patternUnits="userSpaceOnUse">
            <path fill={colour} d="M0 0h1v1h-1zM1 1h1v1h-1z" />
          </pattern>
        ))}
      </defs>
      <rect x={LEFT} y={-BLEED_Y} width={RIGHT - LEFT} height={BOTTOM + BLEED_Y} fill={WATER[0]} />
      {WATER.slice(1).map((colour, index) => {
        const y = (index + 1) * BAND_H - 4;
        return (
          <g key={colour}>
            <rect x={LEFT} y={y - 3} width={RIGHT - LEFT} height={3} fill={`url(#pearl-dither-${index})`} />
            <rect x={LEFT} y={y} width={RIGHT - LEFT} height={BOTTOM - y} fill={colour} />
          </g>
        );
      })}
    </>
  );
}

/* ---- Terrain ---------------------------------------------------------- */

function ridge(top: (x: number) => number, step: number): string {
  let d = '';
  for (let x = LEFT; x < RIGHT; x += step) d += `M${x} ${Math.round(top(x))}h${step}V${BOTTOM}h-${step}z`;
  return d;
}

function ridgeEdge(top: (x: number) => number, step: number, thickness: number): string {
  let d = '';
  for (let x = LEFT; x < RIGHT; x += step) d += `M${x} ${Math.round(top(x))}h${step}v${thickness}h-${step}z`;
  return d;
}

const farTop = (x: number) => 78 + 9 * Math.sin(x / 27) + 5 * Math.sin(x / 10 + 2);
const midTop = (x: number) => 97 + 6 * Math.sin(x / 21 + 1) + 3 * Math.sin(x / 8);
const bedTop = (x: number) => 115 + 2 * Math.sin(x / 19 + 0.5) + Math.sin(x / 7);

/** A scatter of sand specks; fixed so every render draws the same seabed. */
function sandSpecks(): string {
  let d = '';
  for (let i = 0; i < 70; i += 1) {
    const x = LEFT + ((i * 37) % (RIGHT - LEFT));
    const y = Math.round(bedTop(x)) + 4 + ((i * 13) % 40);
    d += `M${x} ${y}h${1 + (i % 2)}v1h-${1 + (i % 2)}z`;
  }
  return d;
}

/* ---- Kelp ------------------------------------------------------------- */

const KELP_STEM = '#127A70';
const KELP_LEAF = '#2CC48F';

function kelpSegment(height: number, phase: number, from: number, to: number): { stem: string; leaf: string } {
  let stem = '';
  let leaf = '';
  for (let row = from; row < to; row += 1) {
    const x = Math.round(1.6 * Math.sin((row + phase) / 5));
    stem += `M${x} ${-row}h2v1h-2z`;
    if (row % 6 === 2 && row < height - 2) {
      const right = Math.floor(row / 6) % 2 === 0;
      const leafX = right ? x + 2 : x - 5;
      leaf += `M${leafX} ${-row}h5v1h-5z`;
      leaf += `M${right ? leafX : leafX + 2} ${-row - 1}h3v1h-3z`;
      leaf += `M${right ? leafX + 3 : leafX} ${-row + 1}h2v1h-2z`;
    }
  }
  return { stem, leaf };
}

function Kelp({ x, y, height, phase, delay }: { x: number; y: number; height: number; phase: number; delay: number }) {
  const third = Math.ceil(height / 3);
  const swayClasses = [styles.sway1, styles.sway2, styles.sway3];
  return (
    <g transform={`translate(${x} ${y})`}>
      {swayClasses.map((swayClass, index) => {
        const { stem, leaf } = kelpSegment(height, phase, index * third, Math.min(height, (index + 1) * third));
        return (
          <g key={swayClass} className={swayClass} style={{ animationDelay: `${delay}s` }}>
            <path fill={KELP_STEM} d={stem} />
            <path fill={KELP_LEAF} d={leaf} />
          </g>
        );
      })}
    </g>
  );
}

/* ---- Sprites ---------------------------------------------------------- */

const DIVER_PALETTE: Palette = {
  k: '#101E3F', y: '#FFCB3D', o: '#E8901F', u: '#FFE48A',
  g: '#A5F4FF', G: '#2FA6C7', w: '#FFFFFF',
  t: '#EEF3F9', T: '#A7B6CC', b: '#33436F',
  l: '#F4FFAE',
};
const FLIPPER_PALETTE: Palette = { k: '#101E3F', f: '#7A5CFF', F: '#4A2DE0' };

const DIVER = [
  '................kkkkkkkk....',
  '..............kkyyyyyyyykk..',
  '.............kyyuuyyyyyyyyk.',
  '......kkkkk..kyuyyggggggyyyk',
  '.....kttttTk.kyyyggggggggyyk',
  '.....kttttTk.kyyggwwggggGGyk',
  '.....ktTTTTkkkyyggwgggggGGyk',
  '..kkkkkkkkkyyykyygggggGGGyyk',
  '.kyyyyyyyyyyyyykyyyGGGGGyyk.',
  'kyyyyyybbyyyyyyykyyyyyyyykk.',
  'kyyyoobbbboooyyyokkkkkkkk...',
  '.kkkkkkkkkkkkkyyyyk.........',
  '..............kyyyyk........',
  '...............kkkk.........',
];
const FLIPPER_UP = [
  '.....kk',
  '....kfk',
  '...kffk',
  '..kffFk',
  '.kffFk.',
  'kffFkk.',
  'kkkkk..',
];
const FLIPPER_DOWN = [
  'kkkkk..',
  'kffFkk.',
  '.kffFk.',
  '..kffFk',
  '...kffk',
  '....kfk',
  '.....kk',
];
const JELLY_PALETTE: Palette = {
  p: '#FF8CC6', P: '#E2589F', l: '#FFD6EA', k: '#3B1650',
  t: '#F470B4', T: '#B94D94',
};
const JELLY_BELL = [
  '.....pppppp.....',
  '...ppllllpppp...',
  '..pplllpppppPp..',
  '.pplppppppppPPp.',
  '.ppppppppppppPp.',
  'pppppppppppppPPp',
  'pppkkppppkkppPPp',
  'pppkkppppkkpPPPp',
  'ppppppppppppPPPP',
  'PpPPpPPpPPpPPpPP',
  '.P..P..P..P..P..',
];
const JELLY_TAIL = [
  '.t..t..T..t..t..',
  '..t.t..T.t..t...',
  '..t..t.T.t.t....',
  '.t...t..T..t....',
  '.t..t...T...t...',
  '....t...T...t...',
  '...t.......t....',
];

const PEARL_PALETTE: Palette = { a: '#C4F542', w: '#F8FFD6', d: '#8BBE1C' };
const PEARL = [
  '..aaa..',
  '.awwaa.',
  'awwaaad',
  'awaaaad',
  'aaaaadd',
  '.aaddd.',
  '..ddd..',
];

const CLAM_PALETTE: Palette = { c: '#F6B48F', C: '#C97B6B', k: '#5C2E44', i: '#FFD9C2' };
const CLAM = [
  '..cccccccccc..',
  '.cciiiiiiiicc.',
  'cCiiiiiiiiiiCc',
  'CC..........CC',
  'kC..........Ck',
  'CCCCCCCCCCCCCC',
  '.cCcCcCcCcCcC.',
  '..kkkkkkkkkk..',
];

const CORAL_PALETTE: Palette = { r: '#FF6F61', R: '#C8424E', h: '#FFB29F' };
const CORAL = [
  '..h.....h.....',
  '.rr.h..rr..h..',
  '.rr.r..rr..rr.',
  '.rrrr..rr.rrr.',
  '..rRr.rrrrrr..',
  '...Rr..rrRr...',
  '...RrrrrRR....',
  '....RrrRR.....',
  '.....RRR......',
];

const FISH_PALETTE: Palette = { f: '#7FE0D8' };
const FISH = ['f..ff.', 'ffffff', 'f..ff.'];

const HEART_PALETTE: Palette = { h: '#FF6F8E', H: '#D23F6B', w: '#FFD2DD', k: '#0B1530' };
const HEART = [
  '.kk.kk.',
  'khhkhhk',
  'kwhhhHk',
  'khhhhHk',
  '.khhHk.',
  '..kHk..',
  '...k...',
];
const HEART_EMPTY: Palette = { h: '#2A3A63', H: '#2A3A63', w: '#2A3A63', k: '#0B1530' };

const GLYPHS: Record<string, readonly string[]> = {
  '0': ['.##.', '#..#', '#..#', '#..#', '#..#', '.##.'],
  '1': ['.#..', '##..', '.#..', '.#..', '.#..', '###.'],
  '2': ['###.', '...#', '.##.', '#...', '#...', '####'],
  '7': ['####', '...#', '..#.', '.#..', '.#..', '.#..'],
  '/': ['...#', '...#', '..#.', '.#..', '#...', '#...'],
};
const GLYPH_PALETTE: Palette = { '#': '#FFFFFF' };

function HudText({ text, x, y }: { text: string; x: number; y: number }) {
  return (
    <>
      {[...text].map((char, index) => (
        <Sprite key={index} rows={GLYPHS[char] ?? []} palette={GLYPH_PALETTE} x={x + index * 5} y={y} />
      ))}
    </>
  );
}

function Pearl({ x, y, delay }: { x: number; y: number; delay: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <g className={styles.twinkle} style={{ animationDelay: `${delay}s` }}>
        <path fill="#C4F542" opacity=".22" d="M1 -2h5v1h1v1h1v1h1v5h-1v1h-1v1h-1v1h-5v-1h-1v-1h-1v-1h-1v-5h1v-1h1v-1h1z" />
      </g>
      <Sprite rows={PEARL} palette={PEARL_PALETTE} x={0} y={0} />
    </g>
  );
}

/* ---- Bubbles ---------------------------------------------------------- */

function Bubble({ x, y, size, delay, duration }: { x: number; y: number; size: 1 | 2 | 3; delay: number; duration: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <g className={styles.bubble} style={{ animationDelay: `${delay}s`, animationDuration: `${duration}s` }}>
        <path fill="#D6FBFF" opacity=".85" d={size === 1 ? 'M0 0h1v1h-1z' : size === 2 ? 'M0 0h2v2h-2z' : 'M1 0h2v1h1v2h-1v1h-2v-1h-1v-2h1z'} />
      </g>
    </g>
  );
}

/**
 * How much of the world fits the frame at a whole-number pixel scale. Starts at
 * the safe area, then follows the element's real size and the screen's density.
 */
function useArtViewBox() {
  const ref = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, w: SAFE_W, h: SAFE_H });
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      const density = window.devicePixelRatio || 1;
      const scale = Math.max(1, Math.round((width * density) / SAFE_W)) / density;
      const w = width / scale;
      const h = height / scale;
      setView({ x: Math.round((SAFE_W - w) / 2), y: Math.round((SAFE_H - h) / 2), w, h });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, view };
}

/** The headlamp's beam, widening in whole art pixels. */
function lampBeam(x: number, y: number, from: number, to: number): string {
  let d = '';
  for (let dx = from; dx < to; dx += 2) {
    const half = 1 + Math.floor(dx * 0.3);
    d += `M${x + dx} ${y - half}h2v${half * 2 + 1}h-2z`;
  }
  return d;
}

export function PearlDiverScene() {
  const { ref, view } = useArtViewBox();
  const hudLeft = view.x + 4;
  const hudRight = view.x + view.w - 4;
  const hudTop = view.y + 4;
  return (
    <div ref={ref} className={styles.sceneBox}>
      <svg
        className={styles.scene}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        preserveAspectRatio="xMidYMid slice"
        shapeRendering="crispEdges"
        focusable="false"
      >
        <Water />

        {/* Sun through the surface. */}
        <g className={styles.rays}>
          <path fill="#FFFFFF" opacity=".08" d="M18 -50h24L6 100h-34z" />
          <path fill="#FFFFFF" opacity=".05" d="M76 -50h14L58 86h-22z" />
          <path fill="#FFFFFF" opacity=".09" d="M140 -50h30L134 110h-42z" />
          <path fill="#FFFFFF" opacity=".05" d="M206 -50h16L198 92h-24z" />
        </g>

        <g className={styles.layerFar}>
          <path fill="#0F4470" d={ridge(farTop, 3)} />
          <path fill="#14587F" d={ridgeEdge(farTop, 3, 1)} />
          <g className={styles.school}>
            <Sprite rows={FISH} palette={FISH_PALETTE} x={166} y={56} />
            <Sprite rows={FISH} palette={FISH_PALETTE} x={174} y={51} />
            <Sprite rows={FISH} palette={FISH_PALETTE} x={181} y={58} />
            <Sprite rows={FISH} palette={FISH_PALETTE} x={189} y={53} />
          </g>
        </g>

        <g className={styles.layerMid}>
          <path fill="#0B2B52" d={ridge(midTop, 2)} />
          <path fill="#12426B" d={ridgeEdge(midTop, 2, 1)} />
          <Kelp x={10} y={122} height={52} phase={0} delay={0} />
          <Kelp x={22} y={122} height={32} phase={3} delay={-0.6} />
          <Kelp x={183} y={122} height={64} phase={7} delay={-1.1} />
          <Kelp x={196} y={122} height={38} phase={2} delay={-0.3} />
          <Kelp x={-16} y={122} height={60} phase={4} delay={-0.9} />
          <Kelp x={228} y={122} height={50} phase={1} delay={-0.4} />
        </g>

        {/* The headlamp points at the next pearl. */}
        <path fill="#F4FFAE" opacity=".16" d={lampBeam(93, 60, 0, 26)} />
        <path fill="#F4FFAE" opacity=".1" d={lampBeam(93, 60, 26, 38)} />
        <path fill="#F4FFAE" opacity=".05" d={lampBeam(93, 60, 38, 48)} />

        <Pearl x={124} y={57} delay={0} />
        <Pearl x={168} y={82} delay={-0.7} />
        <Pearl x={40} y={34} delay={-1.2} />

        <g className={styles.jellySlow}>
          <Sprite rows={JELLY_BELL} palette={JELLY_PALETTE} x={146} y={27} />
          <Sprite rows={JELLY_TAIL} palette={JELLY_PALETTE} x={146} y={38} className={styles.tail} />
        </g>
        <g className={styles.jellyFast}>
          <Sprite rows={JELLY_BELL} palette={JELLY_PALETTE} x={92} y={84} />
          <Sprite rows={JELLY_TAIL} palette={JELLY_PALETTE} x={92} y={95} className={styles.tail} />
        </g>

        <g className={styles.diver}>
          <g className={styles.frameA}><Sprite rows={FLIPPER_UP} palette={FLIPPER_PALETTE} x={56} y={58} /></g>
          <g className={styles.frameB}><Sprite rows={FLIPPER_DOWN} palette={FLIPPER_PALETTE} x={56} y={61} /></g>
          <Sprite rows={DIVER} palette={DIVER_PALETTE} x={62} y={53} />
          {/* The lamp on the helmet. */}
          <path fill="#101E3F" d="M90 58h3v5h-3z" />
          <path fill="#F4FFAE" d="M90 59h2v3h-2z" />
        </g>

        <Bubble x={86} y={49} size={2} delay={0} duration={3.6} />
        <Bubble x={82} y={46} size={1} delay={-1.2} duration={3} />
        <Bubble x={89} y={42} size={3} delay={-2.2} duration={4.2} />
        <Bubble x={36} y={98} size={2} delay={-0.8} duration={5} />
        <Bubble x={156} y={104} size={3} delay={-2.8} duration={5.6} />
        <Bubble x={160} y={98} size={1} delay={-1.6} duration={4.6} />

        <g className={styles.layerNear}>
          <path fill="#3D6B86" d={ridge(bedTop, 2)} />
          <path fill="#E6D39E" d={ridgeEdge(bedTop, 2, 1)} />
          <path fill="#A9AE93" d={ridgeEdge((x) => bedTop(x) + 1, 2, 1)} />
          <path fill="#578AA0" d={sandSpecks()} />
          <Sprite rows={CORAL} palette={CORAL_PALETTE} x={34} y={108} />
          <Sprite rows={CORAL} palette={{ ...CORAL_PALETTE, r: '#FF9A4D', R: '#C7622F', h: '#FFD08A' }} x={-14} y={107} />
          <Sprite rows={CORAL} palette={{ ...CORAL_PALETTE, r: '#B987FF', R: '#7A4FC9', h: '#E0C8FF' }} x={214} y={107} />
          <Sprite rows={CLAM} palette={CLAM_PALETTE} x={112} y={109} />
          <Sprite rows={PEARL} palette={PEARL_PALETTE} x={115.5} y={108} />
        </g>

        {/* HUD: pearls found, lives, oxygen. */}
        <path fill="#0B1530" opacity=".66" d={`M${hudLeft + 1} ${hudTop}h37v1h1v9h-1v1h-37v-1h-1v-9h1z`} />
        <Sprite rows={PEARL} palette={PEARL_PALETTE} x={hudLeft + 2} y={hudTop + 2} />
        <HudText text="07/12" x={hudLeft + 12} y={hudTop + 3} />

        <path fill="#0B1530" opacity=".66" d={`M${hudRight - 57} ${hudTop}h56v1h1v9h-1v1h-56v-1h-1v-9h1z`} />
        <Sprite rows={HEART} palette={HEART_PALETTE} x={hudRight - 56} y={hudTop + 2} />
        <Sprite rows={HEART} palette={HEART_PALETTE} x={hudRight - 48} y={hudTop + 2} />
        <Sprite rows={HEART} palette={HEART_EMPTY} x={hudRight - 40} y={hudTop + 2} />
        <path fill="#2A3A63" d={`M${hudRight - 30} ${hudTop + 3}h27v5h-27z`} />
        <path className={styles.oxygen} fill="#C4F542" d={`M${hudRight - 29} ${hudTop + 4}h25v3h-25z`} />
      </svg>
    </div>
  );
}
