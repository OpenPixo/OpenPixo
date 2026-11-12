import { Button } from '@openpixo/components';
import { Component, type ErrorInfo, type ReactNode } from 'react';

import { reportHandledException } from '../analytics/error-tracking';
import { detectInitialLocale, tForLanguageTag } from '../i18n';

import styles from './AppErrorBoundary.module.css';

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  failed: boolean;
}

/**
 * The last line of defence: a render error or a lazy chunk that fails to load
 * ends here instead of leaving a dead window. It sits outside every provider,
 * so it resolves its own locale, and it only offers a reload because after an
 * uncaught render error nothing below it can be trusted.
 */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  override state: AppErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    reportHandledException(error, info.componentStack ?? undefined);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    const t = tForLanguageTag(detectInitialLocale());
    return (
      <div className={styles.root} role="alert">
        <h1 className={styles.title}>{t?.('appError.title')}</h1>
        <p className={styles.body}>{t?.('appError.body')}</p>
        <Button variant="primary" onClick={() => window.location.reload()}>
          {t?.('appError.reload')}
        </Button>
      </div>
    );
  }
}
