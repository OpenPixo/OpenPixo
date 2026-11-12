import { forwardRef } from 'react';
import type { HTMLAttributes } from 'react';

import { joinClassNames } from './class-names';
import styles from './border-beam.module.css';

export type BorderBeamProps = HTMLAttributes<HTMLDivElement>;

/** A layout-neutral wrapper whose decorative border never intercepts input. */
export const BorderBeam = forwardRef<HTMLDivElement, BorderBeamProps>(function BorderBeam(
  { className, ...props },
  ref,
) {
  return <div ref={ref} className={joinClassNames(styles.beam, className)} {...props} />;
});
