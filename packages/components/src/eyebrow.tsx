import { forwardRef } from 'react';
import type { HTMLAttributes } from 'react';

import { joinClassNames } from './class-names';
import styles from './eyebrow.module.css';

export type EyebrowProps = HTMLAttributes<HTMLSpanElement>;

export const Eyebrow = forwardRef<HTMLSpanElement, EyebrowProps>(function Eyebrow(
  { children, className, ...props },
  ref,
) {
  return (
    <span {...props} ref={ref} className={joinClassNames(styles.eyebrow, className)}>
      <span className={styles.pixel} aria-hidden="true" />
      {children}
    </span>
  );
});
