import styles from './OpenPixoLogo.module.css';

/** The pixel P and its detached pixel form the OpenPixo home wordmark; `compact` fits app chrome. */
export function OpenPixoLogo({ compact = false }: { compact?: boolean }) {
  return (
    <span className={compact ? `${styles.logo} ${styles.compact}` : styles.logo} role="img" aria-label="OpenPixo">
      <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true" fill="none">
        <path fill="currentColor" fillRule="evenodd" d="M6 6h17v5h5v12h-5v5H13v8H6V6Zm7 7v8h8v-8h-8Z" clipRule="evenodd" />
        <path className={styles.pixel} d="M29 3h7v7h-7z" />
      </svg>
      <span className={styles.wordmark} aria-hidden="true">OpenPixo</span>
    </span>
  );
}
