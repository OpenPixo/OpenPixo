import { useEffect, useRef, useState, type ImgHTMLAttributes } from 'react';
import styles from './FadeImage.module.css';

/** Put on a picture's frame: it shimmers until the picture inside has loaded. */
export const loadingFrame = styles.frame;

/**
 * A picture that fades in once it has loaded instead of popping in, so a page of cards
 * fills in calmly. One already in the cache shows at once.
 */
export function FadeImage({ className, onLoad, ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  const ref = useRef<HTMLImageElement | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const image = ref.current;
    setLoaded(Boolean(image?.complete && image.naturalWidth));
  }, [props.src]);
  return <img ref={ref} alt="" {...props} className={`${styles.image}${className ? ` ${className}` : ''}`} data-loaded={loaded || undefined}
    onLoad={event => { setLoaded(true); onLoad?.(event); }} onError={event => { setLoaded(true); props.onError?.(event); }} />;
}
