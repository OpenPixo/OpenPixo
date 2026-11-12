import { useCallback, useEffect, useId, useRef, useState, type ClipboardEvent, type FormEvent, type ReactNode } from 'react';
import { Button, Input, VisuallyHidden } from '@openpixo/components';
import type { OpenPixoAccountStatus, StartGoogleSignInResponse } from '@openpixo/contracts';
import { useT } from '../../i18n';
import { setOpenPixoAccountStatus } from '../../hooks/useOpenPixoAccount';
import {
  accountErrorCode,
  fetchGoogleSignInAttempt,
  OpenPixoAccountRequestError,
  startEmailSignIn,
  startGoogleSignIn,
  verifyEmailSignIn,
} from '../../providers/openpixo-account';
import { openExternalUrl } from '../../providers/registry';
import { Icon } from '../Icon';
import { accountErrorCodeMessage, accountErrorMessage } from './account-format';
import { GoogleMark } from './GoogleMark';
import styles from './CloudSignIn.module.css';

export const OTP_LENGTH = 6;
export const GOOGLE_POLL_INTERVAL_MS = 1_500;

export function isValidEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** Keeps only the digits of a typed or pasted code (`"123 456"`, `"Code: 123-456"`). */
export function normalizeOtp(value: string): string {
  return value.replace(/\D/g, '').slice(0, OTP_LENGTH);
}

export interface CloudSignInProps {
  provider: 'email' | 'google';
  /** Called with the daemon's account status once a session exists. */
  onSignedIn: (status: OpenPixoAccountStatus) => void | Promise<void>;
  /** Leaves the sign-in flow (Google "Cancel"). */
  onCancel?: () => void;
}

export function CloudSignIn({ provider, onSignedIn, onCancel }: CloudSignInProps) {
  return provider === 'email'
    ? <EmailSignIn onSignedIn={onSignedIn} />
    : <GoogleSignIn onSignedIn={onSignedIn} onCancel={onCancel} />;
}

/**
 * The one sign-in surface (first run, the nav sign-in window, Settings): Google
 * on top, email underneath, no provider pre-choice. There is no separate
 * sign-up, so the same form serves new and returning users.
 */
export function SignInPanel({ onSignedIn, autoFocus = true }: Pick<CloudSignInProps, 'onSignedIn'> & {
  /** False on a page that has more to read than the form (first run), where focus should not jump in. */
  autoFocus?: boolean;
}) {
  const t = useT();
  const [google, setGoogle] = useState(false);
  if (google) return <GoogleSignIn onSignedIn={onSignedIn} onCancel={() => setGoogle(false)} />;
  return (
    <EmailSignIn onSignedIn={onSignedIn} autoFocus={autoFocus} addressLead={<>
      <Button variant="secondary" size="lg" className={styles.wide} onClick={() => setGoogle(true)}>
        <GoogleMark />{t('onboarding.googleContinue')}
      </Button>
      <div className={styles.divider} role="presentation"><span>{t('account.or')}</span></div>
    </>} />
  );
}

/** Whole seconds left until a deadline; robust to throttled timers in background windows. */
function useCountdown() {
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until <= Date.now()) return;
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= until) window.clearInterval(timer);
    }, 250);
    return () => window.clearInterval(timer);
  }, [until]);
  const start = useCallback((seconds: number) => {
    const current = Date.now();
    setNow(current);
    setUntil(current + Math.max(0, seconds) * 1_000);
  }, []);
  return [Math.max(0, Math.ceil((until - now) / 1_000)), start] as const;
}

function EmailSignIn({ onSignedIn, addressLead, autoFocus = true }: Pick<CloudSignInProps, 'onSignedIn'> & {
  /** Shown above the address form only (the Google button, in `SignInPanel`). */
  addressLead?: ReactNode;
  /** Whether the address field takes focus on mount; later phase changes always move focus. */
  autoFocus?: boolean;
}) {
  const t = useT();
  const id = useId();
  const [phase, setPhase] = useState<'address' | 'code'>('address');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resendIn, setResendIn] = useCountdown();
  const codeRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const verifying = useRef(false);
  // Re-arm on every mount: StrictMode remounts after the first cleanup.
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const focusedPhase = useRef<'address' | 'code' | null>(autoFocus ? null : 'address');
  useEffect(() => {
    if (focusedPhase.current === phase) return;
    focusedPhase.current = phase;
    (phase === 'code' ? codeRef : emailRef).current?.focus();
  }, [phase]);

  async function requestCode(resend: boolean) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await startEmailSignIn(email.trim());
      if (!mounted.current) return;
      setResendIn(Math.max(0, Math.ceil(result.resendAfterSec)));
      if (resend) {
        setCode('');
        setNotice(t('account.codeResent'));
        codeRef.current?.focus();
      } else {
        setPhase('code');
      }
    } catch (err) {
      if (!mounted.current) return;
      setError(accountErrorMessage(err, t));
      if (err instanceof OpenPixoAccountRequestError && err.retryAfterSec) setResendIn(err.retryAfterSec);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function verify(value: string) {
    if (verifying.current || value.length !== OTP_LENGTH) return;
    verifying.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const status = await verifyEmailSignIn(email.trim(), value);
      if (!mounted.current) return;
      if (!status.signedIn) throw new OpenPixoAccountRequestError('Not signed in', 'ACCOUNT_LOGIN_FAILED', 200);
      setOpenPixoAccountStatus(status);
      await onSignedIn(status);
    } catch (err) {
      if (!mounted.current) return;
      const code = accountErrorCode(err);
      setError(accountErrorMessage(err, t));
      if (code === 'ACCOUNT_LOGIN_EXPIRED') setResendIn(0);
      if (err instanceof OpenPixoAccountRequestError && err.retryAfterSec) setResendIn(err.retryAfterSec);
      setCode('');
      codeRef.current?.focus();
    } finally {
      verifying.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function submitAddress(event: FormEvent) {
    event.preventDefault();
    if (!isValidEmailAddress(email)) {
      setError(t('account.error.emailInvalid'));
      emailRef.current?.focus();
      return;
    }
    void requestCode(false);
  }

  function changeCode(next: string) {
    const digits = normalizeOtp(next);
    setCode(digits);
    if (error) setError(null);
    if (digits.length === OTP_LENGTH) void verify(digits);
  }

  function pasteCode(event: ClipboardEvent<HTMLInputElement>) {
    const pasted = normalizeOtp(event.clipboardData.getData('text'));
    if (!pasted) return;
    event.preventDefault();
    changeCode(pasted);
  }

  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  if (phase === 'address') {
    return (
      <form className={styles.panel} noValidate onSubmit={submitAddress}>
        {addressLead}
        <label htmlFor={`${id}-email`}><VisuallyHidden>{t('account.emailLabel')}</VisuallyHidden></label>
        <Input ref={emailRef} id={`${id}-email`} name="email" type="email" autoComplete="email"
          className={styles.input} value={email} placeholder={t('account.emailPlaceholder')} disabled={busy}
          aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined}
          onChange={(event) => { setEmail(event.target.value); if (error) setError(null); }} />
        {error && <p id={errorId} role="alert" className={styles.error}>{error}</p>}
        <Button type="submit" variant="primary" size="lg" disabled={busy} className={styles.submit}>
          {busy && <Icon name="spinner" size={16} className={styles.spinner} />}{t('account.sendCode')}
        </Button>
      </form>
    );
  }

  return (
    <form className={styles.panel} noValidate onSubmit={(event) => { event.preventDefault(); void verify(code); }}>
      <p className={styles.sentTo}>{t('account.codeSentTo', { email: email.trim() })}</p>
      <label className={styles.label} htmlFor={`${id}-code`}>{t('account.codeLabel')}</label>
      <Input ref={codeRef} id={`${id}-code`} name="one-time-code" type="text" inputMode="numeric"
        autoComplete="one-time-code" pattern="[0-9]*" maxLength={OTP_LENGTH} spellCheck={false}
        className={`${styles.input} ${styles.codeInput}`} value={code} disabled={busy}
        placeholder={'0'.repeat(OTP_LENGTH)}
        aria-invalid={error ? true : undefined}
        aria-describedby={[error ? errorId : null, hintId].filter(Boolean).join(' ')}
        onChange={(event) => changeCode(event.target.value)} onPaste={pasteCode} />
      {error && <p id={errorId} role="alert" className={styles.error}>{error}</p>}
      <p className={styles.notice} role="status" aria-live="polite">{notice}</p>
      <Button type="submit" variant="primary" size="lg" disabled={busy || code.length !== OTP_LENGTH} className={styles.submit}>
        {busy && <Icon name="spinner" size={16} className={styles.spinner} />}{t('account.verify')}
      </Button>
      <div className={styles.codeActions}>
        <Button variant="ghost" size="sm" disabled={busy || resendIn > 0} onClick={() => void requestCode(true)}>
          {resendIn > 0 ? t('account.resendIn', { n: resendIn }) : t('account.resend')}
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => {
          setPhase('address'); setCode(''); setError(null); setNotice(null);
        }}>{t('account.changeEmail')}</Button>
      </div>
      <p id={hintId} className={styles.hint}><Icon name="mail" size={14} />{t('account.spamHint')}</p>
    </form>
  );
}

type GooglePhase =
  | { kind: 'starting' }
  | { kind: 'waiting'; attempt: StartGoogleSignInResponse }
  | { kind: 'error'; message: string };

function GoogleSignIn({ onSignedIn, onCancel }: Pick<CloudSignInProps, 'onSignedIn' | 'onCancel'>) {
  const t = useT();
  const [phase, setPhase] = useState<GooglePhase>({ kind: 'starting' });
  const ticket = useRef(0);
  const timer = useRef<number | null>(null);
  const signedInRef = useRef(onSignedIn);
  signedInRef.current = onSignedIn;
  const retryRef = useRef<HTMLButtonElement>(null);
  const tRef = useRef(t);
  tRef.current = t;

  const stop = useCallback(() => {
    ticket.current += 1;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const start = useCallback(() => {
    stop();
    const t = tRef.current;
    const mine = ticket.current;
    const live = () => mine === ticket.current;
    const fail = (message: string) => { if (live()) setPhase({ kind: 'error', message }); };
    const poll = (attemptId: string) => {
      timer.current = window.setTimeout(async () => {
        if (!live()) return;
        try {
          const result = await fetchGoogleSignInAttempt(attemptId);
          if (!live()) return;
          if (result.state === 'pending') { poll(attemptId); return; }
          if (result.state === 'completed' && result.account?.signedIn) {
            ticket.current += 1;
            setOpenPixoAccountStatus(result.account);
            await signedInRef.current(result.account);
            return;
          }
          if (result.state === 'expired') { fail(t('account.error.googleExpired')); return; }
          fail(result.error ? accountErrorCodeMessage(result.error, t) : t('account.error.googleFailed'));
        } catch (err) {
          fail(accountErrorMessage(err, t));
        }
      }, GOOGLE_POLL_INTERVAL_MS);
    };
    setPhase({ kind: 'starting' });
    void (async () => {
      try {
        const attempt = await startGoogleSignIn();
        if (!live()) return;
        setPhase({ kind: 'waiting', attempt });
        void openExternalUrl(attempt.authorizeUrl);
        poll(attempt.attemptId);
      } catch (err) {
        fail(accountErrorMessage(err, t));
      }
    })();
  }, [stop]);

  useEffect(() => {
    // Deferred so a StrictMode mount/unmount/mount opens the browser once.
    const deferred = window.setTimeout(start, 0);
    return () => { window.clearTimeout(deferred); stop(); };
  }, [start, stop]);

  useEffect(() => {
    if (phase.kind === 'error') retryRef.current?.focus();
  }, [phase.kind]);

  const waiting = phase.kind !== 'error';
  return (
    <div className={styles.panel}>
      <div className={styles.googleWait} role="status" aria-live="polite" aria-busy={waiting}>
        <GoogleMark size={20} />
        {waiting && <Icon name="spinner" size={18} className={styles.spinner} />}
        <span>{phase.kind === 'starting' ? t('account.googleOpening')
          : phase.kind === 'waiting' ? t('account.googleWaiting') : null}</span>
      </div>
      {phase.kind === 'error' && <p role="alert" className={styles.error}>{phase.message}</p>}
      <div className={styles.googleActions}>
        {phase.kind === 'waiting' && (
          <Button variant="ghost" size="sm" onClick={() => void openExternalUrl(phase.attempt.authorizeUrl)}>
            {t('account.googleOpenAgain')}<Icon name="external-link" size={13} />
          </Button>
        )}
        {phase.kind === 'error' && (
          <Button ref={retryRef} variant="primary" size="sm" onClick={start}>{t('account.tryAgain')}</Button>
        )}
        {onCancel && (
          <Button variant="secondary" size="sm" onClick={() => { stop(); onCancel(); }}>{t('account.cancel')}</Button>
        )}
      </div>
    </div>
  );
}
