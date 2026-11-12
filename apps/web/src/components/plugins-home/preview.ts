// Preview-kind classifier for the plugins-home gallery.
//
// Each card variant in the home gallery wants different content
// in its hero region:
//   - `media`  → poster image (image-template plugins) or video
//                poster with optional hover-play (video-template)
//   - `html`   → sandboxed iframe rendering the plugin's example
//                output / preview entry (examples + scenarios that
//                ship a `pixo.preview.entry` or `exampleOutputs[]`)
//   - `design` → design-system showcase thumbnail, falling back to
//                a stylized brand patch when no showcase ref exists
//   - `text`   → fallback layout (other scenario plugins, atoms
//                that slip through the visiblePlugins filter, …)
//
// Keeping the classifier in its own pure module lets the renderer
// branch on a single discriminator and lets the unit tests assert
// classification without touching React.

import type { InstalledPluginRecord } from '@openpixo/contracts';


export type PluginPreviewKind = 'media' | 'html' | 'design' | 'text';

export interface MediaPreviewSpec {
  kind: 'media';
  /**
   * Asset family the card / detail surface should render:
   *   - 'image' → poster only (image-template plugins)
   *   - 'video' → poster + optional autoplay clip on hover
   *   - 'audio' → optional cover poster + native audio player
   */
  mediaType: 'image' | 'video' | 'audio';
  poster: string | null;
  videoUrl: string | null;
  audioUrl: string | null;
  /** True when the plugin only ships a still image, no video stream. */
  imageOnly: boolean;
  /**
   * For baked hover-pan clips: the leading `[0, loopHoldMs]` span is the page's
   * in-place animation (no scroll), which the gallery loops while idle; hover
   * plays on past it (the pan). Null for plain video-template plugins, which
   * just loop the whole clip.
   */
  loopHoldMs?: number | null;
}

export interface HtmlPreviewSpec {
  kind: 'html';
  /** URL the iframe should load — daemon-served sandboxed HTML. */
  src: string;
  /** Display label used in the chrome strip of the preview frame. */
  label: string;
  /**
   * Discriminates which daemon endpoint the preview comes from so
   * the detail modal can rebuild the same fetch via fetchPlugin*Html
   * helpers without re-parsing the URL.
   */
  source: 'preview' | 'example';
  /** Example stem when `source === 'example'`, otherwise undefined. */
  exampleStem?: string;
}

export interface DesignPreviewSpec {
  kind: 'design';
  brand: string;
  swatches: string[];

}

export interface TextPreviewSpec {
  kind: 'text';
}

export type PluginPreviewSpec =
  | MediaPreviewSpec
  | HtmlPreviewSpec
  | DesignPreviewSpec
  | TextPreviewSpec;

interface PreviewBlock {
  type?: unknown;
  poster?: unknown;
  galleryPosterOnly?: unknown;
  video?: unknown;
  gif?: unknown;
  entry?: unknown;
  audio?: unknown;
  holdMs?: unknown;
}

interface ExampleOutputEntry {
  path?: unknown;
  title?: unknown;
}


function readPreview(record: InstalledPluginRecord): PreviewBlock | null {
  const pixo = record.manifest?.pixo as { preview?: unknown } | undefined;
  if (!pixo || typeof pixo.preview !== 'object' || pixo.preview === null) return null;
  return pixo.preview as PreviewBlock;
}

// Pre-baked hover-pan clip attached by the daemon (scripts/bake-plugin-previews.mjs),
// kept separate from `pixo.preview` so only gallery tiles use it.
function readBakedPreview(
  record: InstalledPluginRecord,
): { poster: string; video: string; holdMs: number | null } | null {
  const pixo = record.manifest?.pixo as { bakedPreview?: unknown } | undefined;
  const b = pixo?.bakedPreview;
  if (!b || typeof b !== 'object') return null;
  const { poster, video, holdMs } = b as Record<string, unknown>;
  if (typeof poster !== 'string' || typeof video !== 'string') return null;
  return { poster, video, holdMs: typeof holdMs === 'number' ? holdMs : null };
}

function readExamples(record: InstalledPluginRecord): ExampleOutputEntry[] {
  const pixo = record.manifest?.pixo as
    | { useCase?: { exampleOutputs?: unknown } }
    | undefined;
  const list = pixo?.useCase?.exampleOutputs;
  if (!Array.isArray(list)) return [];
  return list as ExampleOutputEntry[];
}

function exampleStem(entry: ExampleOutputEntry): string | null {
  if (typeof entry.path !== 'string') return null;
  const segments = entry.path.split(/[\\/]/).filter(Boolean);
  const base = segments[segments.length - 1] ?? '';
  const stem = base.replace(/\.[^.]+$/, '');
  return stem || null;
}

// Synthetic colour swatches derived from the plugin id so cards stay
// visually distinct without dragging in the real DESIGN.md content.
// Hue is pinned per-plugin (stable across renders) but lightness /
// saturation rotate so each design-system tile reads as a brand
// patch rather than a random gradient.


export function inferPluginPreview(
  record: InstalledPluginRecord,
  opts?: {
    preferBaked?: boolean;

  },
): PluginPreviewSpec {
  const preview = readPreview(record);
  // Gallery tiles opt in to a pre-baked hover-pan clip (cheap thumbnail) when
  // the daemon has attached one. Everything else — crucially the detail modal —
  // falls through to the real `pixo.preview`, so opening a plugin still shows the
  // live, interactive page rather than the baked video.
  if (opts?.preferBaked && preview?.galleryPosterOnly !== true) {
    const baked = readBakedPreview(record);
    if (baked) {
      return {
        kind: 'media',
        mediaType: 'video',
        poster: baked.poster,
        videoUrl: baked.video,
        audioUrl: null,
        imageOnly: false,
        loopHoldMs: baked.holdMs,
      };
    }
  }
  const examples = readExamples(record);

  if (preview) {
    const t = typeof preview.type === 'string' ? preview.type.toLowerCase() : '';
    const poster = typeof preview.poster === 'string' ? preview.poster : null;
    const video = typeof preview.video === 'string' ? preview.video : null;
    const gif = typeof preview.gif === 'string' ? preview.gif : null;
    const audio = typeof preview.audio === 'string' ? preview.audio : null;
    const entry = typeof preview.entry === 'string' ? preview.entry : null;

    if (t === 'html' && entry) {
      // Bundled stills make new templates usable before the post-merge CDN
      // bake. They belong to cards only; details keep the real HTML preview.
      if (opts?.preferBaked && poster) {
        const relative = !/^(?:[a-z][a-z\d+.-]*:|\/)/i.test(poster);
        const posterUrl = relative
          ? `/api/plugins/${encodeURIComponent(record.id)}/asset/${poster.replace(/^\.\//, '').split('/').map(encodeURIComponent).join('/')}`
          : poster;
        return {
          kind: 'media', mediaType: 'image', poster: posterUrl,
          videoUrl: null, audioUrl: null, imageOnly: true,
        };
      }
      return {
        kind: 'html',
        src: `/api/plugins/${encodeURIComponent(record.id)}/preview`,
        label: entry.replace(/^\.\//, '').split(/[\\/]/).pop() ?? entry,
        source: 'preview',
      };
    }

    if (t === 'video' || video) {
      const holdMs = typeof preview.holdMs === 'number' ? preview.holdMs : null;
      return {
        kind: 'media',
        mediaType: 'video',
        poster: poster ?? gif ?? null,
        videoUrl: video,
        audioUrl: null,
        imageOnly: !video,
        loopHoldMs: holdMs,
      };
    }
    if (t === 'audio' || audio) {
      return {
        kind: 'media',
        mediaType: 'audio',
        poster: poster ?? gif ?? null,
        videoUrl: null,
        audioUrl: audio,
        imageOnly: false,
      };
    }
    if (t === 'image' || poster || gif) {
      return {
        kind: 'media',
        mediaType: 'image',
        poster: poster ?? gif ?? null,
        videoUrl: null,
        audioUrl: null,
        imageOnly: true,
      };
    }
  }

  if (examples.length > 0) {
    const stem = exampleStem(examples[0]!);
    if (stem) {
      const title =
        typeof examples[0]!.title === 'string' ? (examples[0]!.title as string) : stem;
      return {
        kind: 'html',
        src: `/api/plugins/${encodeURIComponent(record.id)}/example/${encodeURIComponent(stem)}`,
        label: title,
        source: 'example',
        exampleStem: stem,
      };
    }
  }


  return { kind: 'text' };
}
