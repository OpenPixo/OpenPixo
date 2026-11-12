import { useCallback, useEffect, useRef, useState } from 'react';

// Incremental rendering (moved out of FilesPanel): a long listing starts with
// one batch and reveals the next when an invisible end marker nears the
// viewport. A Unity project's 图片 filter or a web clone's 4,000 pages would
// otherwise mount every row, card and thumbnail at once and freeze the
// client. Environments without IntersectionObserver (jsdom) render everything.

export function useIncrementalRender(batch: number, scopeKey: string) {
  const enabled = typeof IntersectionObserver !== 'undefined';
  const [limit, setLimit] = useState(batch);
  const [scope, setScope] = useState(scopeKey);
  if (scope !== scopeKey) {
    // Adjust during render: a new folder / filter / layout drops back to the
    // first batch BEFORE it paints, never one frame at the old count.
    setScope(scopeKey);
    setLimit(batch);
  }
  const reveal = useCallback(() => setLimit((current) => current + batch), [batch]);
  return {
    limit: <T,>(entries: readonly T[]): readonly T[] => (enabled ? entries.slice(0, limit) : entries),
    sentinel: (total: number) => (enabled && total > limit
      // Keyed by the revealed count so each batch re-observes from scratch: a
      // sentinel still inside the extended viewport keeps revealing.
      ? <RenderSentinel key={`render-sentinel:${limit}`} onReveal={reveal} />
      : null),
  };
}

/** Deliberately invisible: an incrementally rendered list reads like a full one. */
function RenderSentinel({ onReveal }: { onReveal: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        onReveal();
        observer.disconnect();
      }
    }, { rootMargin: '0px 0px 1200px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [onReveal]);
  return (
    <div
      ref={ref}
      data-testid="file-list-grid-sentinel"
      aria-hidden
      style={{ gridColumn: '1 / -1', blockSize: 1, margin: 0, padding: 0, border: 0 }}
    />
  );
}
