import { forwardRef } from 'react';
import type { HTMLAttributes } from 'react';

import { joinClassNames } from './class-names';
import styles from './accent-text.module.css';

export type AccentTextProps = HTMLAttributes<HTMLSpanElement>;

export const AccentText = forwardRef<HTMLSpanElement, AccentTextProps>(function AccentText(
  { className, ...props },
  ref,
) {
  return <span {...props} ref={ref} className={joinClassNames(styles.accent, className)} />;
});
