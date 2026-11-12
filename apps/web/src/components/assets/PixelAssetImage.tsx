import { useEffect, useRef, useState } from 'react';
import { integerPreviewScale } from './frame-grid';
import styles from './Assets.module.css';

export function useIntegerPreviewScale(width: number, height: number, maxHeight: number, fallbackWidth = 256, fitViewport = false) {
  const ref = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(fallbackWidth);
  const [availableHeight, setAvailableHeight] = useState(maxHeight);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      if (element.clientWidth > 0) setAvailableWidth(element.clientWidth);
      if (fitViewport && element.clientHeight > 0) setAvailableHeight(element.clientHeight);
    };
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(element);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [width, height, fitViewport]);
  return { ref, scale: integerPreviewScale(width, height, availableWidth, fitViewport ? Math.min(maxHeight, availableHeight) : maxHeight) };
}

/** Read original pixels, then fit at whole multiples. Overflow keeps native pixels intact. */
export function PixelAssetImage({ source, name, width = 0, height = 0, maxHeight = 144, className = '', onError, fitLarge = false, compact = false, fitViewport = false }: {
  source: string; name: string; width?: number; height?: number; maxHeight?: number; className?: string; onError?: () => void; fitLarge?: boolean; compact?: boolean; fitViewport?: boolean;
}) {
  const [natural, setNatural] = useState({ width, height });
  const imageWidth = width || natural.width, imageHeight = height || natural.height;
  const { ref, scale } = useIntegerPreviewScale(imageWidth, imageHeight, maxHeight, 256, fitViewport);
  const fit = fitLarge && Math.max(imageWidth, imageHeight) > 256;
  return <div ref={ref} className={`${styles.pixelViewport} ${compact ? styles.compactPreview : ''} ${className}`}>
    <img src={source} alt={name} loading="lazy" onError={onError}
      width={imageWidth ? imageWidth * scale : undefined} height={imageHeight ? imageHeight * scale : undefined}
      style={fit ? { width: '100%', height: '100%', objectFit: 'contain' } : {
        width: imageWidth ? imageWidth * scale : undefined, height: imageHeight ? imageHeight * scale : undefined, imageRendering: 'pixelated' }}
      onLoad={event => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} />
  </div>;
}
