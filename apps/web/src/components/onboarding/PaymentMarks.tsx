// Acceptance marks for the ways Stripe Checkout takes money. A card product is
// also payable with Apple Pay and Google Pay, which Checkout offers on devices
// that support them, so "card" in the catalogue draws all three. Alipay shows
// only where the catalogue lists it (credit packs).

import { VisuallyHidden } from '@openpixo/components';
import { useT } from '../../i18n';
import { GoogleMark } from '../account/GoogleMark';
import styles from './PaymentMarks.module.css';

type Mark = 'card' | 'apple-pay' | 'google-pay' | 'alipay';

/**
 * Whether Alipay buyers must be sent from monthly plans to credit packs: packs
 * take Alipay and plans do not. Read from the catalogue, so the hint goes away
 * by itself once plans accept Alipay.
 */
export function alipayOnlyOnPacks(catalog: {
  plans: ReadonlyArray<{ paymentMethods: readonly string[] }>;
  topups: ReadonlyArray<{ paymentMethods: readonly string[] }>;
}): boolean {
  const takes = (items: ReadonlyArray<{ paymentMethods: readonly string[] }>) =>
    items.some((item) => item.paymentMethods.some((method) => method.toLowerCase() === 'alipay'));
  return catalog.plans.length > 0 && takes(catalog.topups) && !takes(catalog.plans);
}

/** The marks to draw for a catalogue's payment methods, first-seen order. */
export function paymentMarks(methods: readonly string[]): Mark[] {
  const marks: Mark[] = [];
  for (const method of methods.map((item) => item.toLowerCase())) {
    if (method === 'card') marks.push('card', 'apple-pay', 'google-pay');
    else if (method === 'alipay') marks.push('alipay');
  }
  return [...new Set(marks)];
}

export function PaymentMarks({ methods, className }: { methods: readonly string[]; className?: string }) {
  const t = useT();
  const marks = paymentMarks(methods);
  if (marks.length === 0) return null;
  return (
    <ul className={`${styles.marks} ${className ?? ''}`} data-testid="payment-marks">
      {marks.map((mark) => (
        <li key={mark} className={styles.mark} data-mark={mark}>
          {mark === 'card' ? (
            <>
              <svg width="20" height="14" viewBox="0 0 20 14" aria-hidden="true">
                <rect x="0.75" y="0.75" width="18.5" height="12.5" rx="2.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <rect x="0.75" y="3.5" width="18.5" height="2.5" fill="currentColor" />
                <rect x="3" y="8.5" width="5" height="1.6" rx="0.8" fill="currentColor" />
              </svg>
              <span>{t('account.payment.card')}</span>
            </>
          ) : mark === 'apple-pay' ? (
            <>
              <svg width="13" height="15" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
                <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
              </svg>
              <span className={styles.wordmark} aria-hidden="true">Pay</span>
              <VisuallyHidden>Apple Pay</VisuallyHidden>
            </>
          ) : mark === 'google-pay' ? (
            <>
              <GoogleMark size={14} />
              <span className={styles.wordmark} aria-hidden="true">Pay</span>
              <VisuallyHidden>Google Pay</VisuallyHidden>
            </>
          ) : (
            <span className={styles.alipay}>{t('account.payment.alipay')}</span>
          )}
        </li>
      ))}
    </ul>
  );
}
