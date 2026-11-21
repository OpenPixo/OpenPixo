import { forwardRef } from 'react';
import type { HTMLAttributes, ReactNode } from 'react';

import { Button } from '../button';
import { joinClassNames } from '../class-names';
import styles from './Notice.module.css';

export type NoticeTone = 'info' | 'success' | 'warning' | 'danger';

export interface NoticeProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Colours the icon and tints the border and background. Defaults to `info`. */
  tone?: NoticeTone;
  /** One short line in 600 weight above the message. */
  title?: ReactNode;
  /** One control on the right, usually a small `Button`. */
  action?: ReactNode;
  /** Replaces the tone icon; `false` hides it. */
  icon?: ReactNode | false;
}

const toneClassNames: Record<NoticeTone, string | undefined> = {
  info: styles.info,
  success: styles.success,
  warning: styles.warning,
  danger: styles.danger,
};

function ToneIcon({ tone }: { tone: NoticeTone }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false,
  };
  if (tone === 'success') {
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="6.25" />
        <path d="M5.4 8.2l1.8 1.8 3.5-3.7" />
      </svg>
    );
  }
  if (tone === 'warning') {
    return (
      <svg {...common}>
        <path d="M8 2.3l6 10.4H2L8 2.3z" />
        <path d="M8 6.6v2.6" />
        <path d="M8 11.1h.01" />
      </svg>
    );
  }
  if (tone === 'danger') {
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="6.25" />
        <path d="M8 4.9v3.4" />
        <path d="M8 10.9h.01" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 7.3v3.6" />
      <path d="M8 5.1h.01" />
    </svg>
  );
}

/**
 * An inline message inside a page or card: a bordered box with a tone icon,
 * an optional title, one or two lines of text and at most one action on the
 * right. Tone colour sits only on the icon and a light border/background tint,
 * so a notice never shouts louder than the content around it.
 */
export const Notice = forwardRef<HTMLDivElement, NoticeProps>(function Notice(
  { tone = 'info', title, action, icon, className, children, role, ...props },
  ref,
) {
  const hasTitle = title !== undefined && title !== null && title !== false;
  return (
    <div
      ref={ref}
      role={role ?? (tone === 'danger' ? 'alert' : 'status')}
      data-tone={tone}
      className={joinClassNames(styles.notice, toneClassNames[tone], className)}
      {...props}
    >
      {icon === false ? null : (
        <span className={styles.icon} aria-hidden>
          {icon ?? <ToneIcon tone={tone} />}
        </span>
      )}
      <div className={styles.body}>
        {hasTitle ? <div className={styles.title}>{title}</div> : null}
        {children !== undefined && children !== null ? (
          <div className={hasTitle ? styles.message : styles.messageOnly}>{children}</div>
        ) : null}
      </div>
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
});

export interface NoticeRetryProps extends Omit<NoticeProps, 'tone' | 'action' | 'title'> {
  /** Short failure title, e.g. "加载失败". */
  title: ReactNode;
  /** Label of the retry button, e.g. "重试". */
  retryLabel: ReactNode;
  onRetry: () => void;
  /** Disables the button while a retry is in flight. */
  retrying?: boolean;
}

/**
 * The load-failure state: a danger notice whose one action tries again.
 *
 * ```tsx
 * <NoticeRetry title="加载失败" retryLabel="重试" onRetry={reload}>
 *   没能读到游戏列表，检查网络后再试一次。
 * </NoticeRetry>
 * ```
 */
export const NoticeRetry = forwardRef<HTMLDivElement, NoticeRetryProps>(function NoticeRetry(
  { title, retryLabel, onRetry, retrying = false, children, ...props },
  ref,
) {
  return (
    <Notice
      ref={ref}
      tone="danger"
      title={title}
      action={
        <Button variant="secondary" size="sm" onClick={onRetry} disabled={retrying} aria-busy={retrying || undefined}>
          {retryLabel}
        </Button>
      }
      {...props}
    >
      {children}
    </Notice>
  );
});
