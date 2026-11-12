import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { appendResourceQuery } from '../../lib/resource-url';
import { projectFileUrl, projectRawUrl } from '../../providers/registry';
import { buildSrcdoc } from '../../runtime/srcdoc';
import type { ProjectFile } from '../../types';
import { getHtmlSourceSnapshot, htmlSourceSnapshotRefreshKey } from '../html-source-snapshot-cache';
import { getHtmlThumbnailSource, loadHtmlThumbnailSource } from '../html-thumbnail-source-cache';
import { categoryGlyph, fileCategory } from './file-meta';

// Moved out of FilesPanel unchanged: the page thumbnail of an HTML card.

const HTML_THUMBNAIL_INLINE_MAX_BYTES = 512 * 1024;

// At most this many thumbnail content fetches run concurrently. Each visible
// card fetches its HTML to build a srcDoc preview; without a cap, a large
// section fires thousands of parallel fetches, exhausting local sockets
// (net::ERR_INSUFFICIENT_RESOURCES) and starving the web<->daemon proxy.
const MAX_CONCURRENT_HTML_THUMBNAIL_FETCHES = 6;

let activeHtmlThumbnailFetches = 0;
const queuedHtmlThumbnailFetches: Array<() => void> = [];

// Start queued thumbnail fetches on a microtask, never synchronously from a
// release. A synchronous pump would let one card's unmount cleanup start a
// queued fetch for a sibling card that is being torn down in the same commit
// (its own cleanup just hasn't run yet). Deferring to a microtask lets every
// cleanup dequeue its task first; the pump then only starts live tasks.
function pumpHtmlThumbnailFetchQueue(): void {
  queueMicrotask(() => {
    while (
      activeHtmlThumbnailFetches < MAX_CONCURRENT_HTML_THUMBNAIL_FETCHES
      && queuedHtmlThumbnailFetches.length > 0
    ) {
      queuedHtmlThumbnailFetches.shift()!();
    }
  });
}

/**
 * FIFO concurrency gate for thumbnail content fetches. `start` runs once a
 * slot is free (synchronously when one is available now) and receives the
 * release function to call when the fetch settles. The returned function
 * abandons the reservation, for effect cleanup:
 * - abandoned before starting → the queued task is removed and never runs;
 * - abandoned after starting → the slot stays held until the underlying
 *   request settles and the settle path calls `release`. Cleanup must never
 *   free a slot whose request is still on the network: releasing early would
 *   let the queue pump start replacement fetches while the abandoned ones are
 *   still in flight, pushing real connection concurrency above the cap during
 *   directory/project navigation — the exact socket-exhaustion path this pool
 *   exists to prevent.
 */
function acquireHtmlThumbnailFetchSlot(
  start: (release: () => void) => void,
): () => void {
  let started = false;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    activeHtmlThumbnailFetches -= 1;
    pumpHtmlThumbnailFetchQueue();
  };
  const run = () => {
    started = true;
    activeHtmlThumbnailFetches += 1;
    start(release);
  };
  let abandoned = false;
  const abandon = () => {
    if (abandoned || started) return;
    abandoned = true;
    const index = queuedHtmlThumbnailFetches.indexOf(run);
    if (index >= 0) queuedHtmlThumbnailFetches.splice(index, 1);
  };
  if (activeHtmlThumbnailFetches < MAX_CONCURRENT_HTML_THUMBNAIL_FETCHES) {
    run();
  } else {
    queuedHtmlThumbnailFetches.push(run);
  }
  return abandon;
}

// Pages are laid out at a desktop-ish width and scaled down to the card, so
// the thumbnail reads as a zoomed-out page preview instead of the page's
// narrow mobile layout cropped to the card's top-left corner.
const PAGE_THUMB_LAYOUT_WIDTH = 1200;
const PAGE_THUMB_LAYOUT_HEIGHT = Math.round(PAGE_THUMB_LAYOUT_WIDTH * (9 / 16));

function baseDirForFile(name: string): string {
  const index = name.lastIndexOf('/');
  return index >= 0 ? name.slice(0, index + 1) : '';
}

export function FilePreviewPlaceholder({ file }: { file: ProjectFile }) {
  return (
    <div className="df-preview-placeholder" aria-hidden>
      {categoryGlyph(fileCategory(file))}
    </div>
  );
}

/**
 * The HTML page thumbnail: fetch + buildSrcdoc (guarded by the inline size
 * cap), rendered through a fixed-layout iframe scaled to the card width.
 * While no srcdoc is available (too large, still fetching, or fetch failed)
 * the glyph placeholder shows instead of URL-loading the iframe.
 */
export function HtmlCardThumbnail({
  projectId,
  file,
  filesRefreshKey,
  className,
}: {
  projectId: string;
  file: ProjectFile;
  filesRefreshKey: number;
  className?: string;
}) {
  const tooLargeForThumbnail = file.size > HTML_THUMBNAIL_INLINE_MAX_BYTES;
  const url = projectFileUrl(projectId, file.name);
  const authorizationScopeKey = 'local';
  const refreshKey = htmlSourceSnapshotRefreshKey(file, filesRefreshKey);
  const thumbnailIdentity = { authorizationScopeKey, projectId, fileName: file.name, refreshKey };
  const baseHref = projectRawUrl(projectId, baseDirForFile(file.name));
  const cachedSource = () =>
    getHtmlSourceSnapshot(authorizationScopeKey, projectId, file.name, refreshKey)?.source
    ?? getHtmlThumbnailSource(thumbnailIdentity);
  // A thumbnail never owns playback. Only marked motion videos wait for a
  // host grant, which this static card intentionally never provides.
  const [srcDoc, setSrcDoc] = useState<string | null>(() => {
    const source = cachedSource();
    return source === null ? null : buildSrcdoc(source, { baseHref, motionPreview: true });
  });
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState<number | null>(null);

  // Content fetches wait until the card scrolls near the viewport; a card
  // that has intersected once stays "near" for good. Environments without
  // IntersectionObserver (jsdom) treat every card as immediately visible.
  const [nearViewport, setNearViewport] = useState(false);
  useEffect(() => {
    if (nearViewport) return;
    const host = hostRef.current;
    if (!host) return;
    if (typeof IntersectionObserver === 'undefined') {
      setNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNearViewport(true);
          observer.disconnect();
        }
      },
      { rootMargin: '0px 0px 800px 0px' },
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, [nearViewport]);

  useEffect(() => {
    setSrcDoc(null);
    if (tooLargeForThumbnail) return;
    const cached = cachedSource();
    if (cached !== null) {
      setSrcDoc(buildSrcdoc(cached, { baseHref, motionPreview: true }));
      return;
    }
    // Only an actual network load waits for viewport proximity and for a free
    // fetch slot — the gate + pool that keep a huge grid from firing
    // thousands of fetches.
    if (!nearViewport) return;
    let cancelled = false;
    const abandonSlot = acquireHtmlThumbnailFetchSlot((release) => {
      void loadHtmlThumbnailSource(thumbnailIdentity, async () => {
        const response = await fetch(appendResourceQuery(url, `v=${Math.round(file.mtime)}`), {});
        return response?.ok ? response.text() : null;
      })
        .then((html) => {
          if (cancelled || html === null) return;
          setSrcDoc(buildSrcdoc(html, { baseHref, motionPreview: true }));
        })
        .catch(() => {
          if (!cancelled) setSrcDoc(null);
        })
        // Success and failure both pass through here exactly once per started
        // fetch — the ONLY place a started fetch's slot is freed. Cleanup
        // abandons the reservation without freeing the slot, so a fetch
        // abandoned mid-flight keeps its slot until the network settles it.
        .finally(release);
    });
    return () => {
      cancelled = true;
      abandonSlot();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorizationScopeKey, baseHref, nearViewport, refreshKey, tooLargeForThumbnail, url]);

  // Track the host width before paint so the iframe's first rendered viewport
  // is the fixed desktop layout; only its outer transform follows the card.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const update = () => {
      const width = host.clientWidth;
      if (width > 0) setScale(width / PAGE_THUMB_LAYOUT_WIDTH);
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={hostRef} className={['df-thumb-scale-host', className].filter(Boolean).join(' ')}>
      {tooLargeForThumbnail || srcDoc === null ? (
        <FilePreviewPlaceholder file={file} />
      ) : (
        <iframe
          title={file.name}
          srcDoc={srcDoc}
          sandbox="allow-scripts allow-downloads"
          loading="lazy"
          tabIndex={-1}
          style={{
            width: PAGE_THUMB_LAYOUT_WIDTH,
            height: PAGE_THUMB_LAYOUT_HEIGHT,
            ...(scale ? { transform: `scale(${scale})`, transformOrigin: '0 0' } : {}),
          }}
        />
      )}
    </div>
  );
}
