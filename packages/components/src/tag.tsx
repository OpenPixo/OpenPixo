import { forwardRef } from 'react';
import type { HTMLAttributes } from 'react';

import { joinClassNames } from './class-names';
import styles from './tag.module.css';

export type TagProps = HTMLAttributes<HTMLSpanElement>;

export const Tag = forwardRef<HTMLSpanElement, TagProps>(function Tag({ className, ...props }, ref) {
  return <span {...props} ref={ref} className={joinClassNames(styles.tag, className)} />;
});
