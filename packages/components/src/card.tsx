import { forwardRef } from 'react';
import type { HTMLAttributes } from 'react';

import { joinClassNames } from './class-names';
import styles from './card.module.css';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Adds a hover lift without imposing interaction semantics on the content. */
  interactive?: boolean;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { className, interactive = false, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={joinClassNames(styles.card, interactive && styles.interactive, className)}
      {...props}
    />
  );
});
