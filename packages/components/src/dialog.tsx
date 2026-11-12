import { createContext, useContext, useEffect, useId, useRef, useState, type ComponentPropsWithoutRef, type FormEvent, type FormEventHandler, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './button';
import { joinClassNames } from './class-names';
import styles from './dialog.module.css';

const EXIT_MS = 140;
const dialogs: HTMLElement[] = [];
const dialogDepth = new WeakMap<HTMLElement, number>();
const DialogDepth = createContext(0);
function syncDialogStack() {
  dialogs.forEach((node, index) => {
    const active = index === dialogs.length - 1;
    node.inert = !active;
    if (active) node.removeAttribute('aria-hidden'); else node.setAttribute('aria-hidden', 'true');
    if (node.parentElement) node.parentElement.style.zIndex = String(1500 + index);
  });
}
let originalOverflow = '';
const focusableSelector = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"]), audio[controls], video[controls], iframe';
export interface DialogProps {
  children: ReactNode;
  open?: boolean;
  onClose?: () => void;
  onAfterClose?: () => void;
  className?: string;
  backdropClassName?: string;
  includeChromeClassName?: boolean;
  id?: string;
  role?: 'dialog' | 'alertdialog';
  ariaLabel?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
  initialFocusRef?: RefObject<HTMLElement>;
  size?: 'sm' | 'md' | 'lg' | 'side-sheet';
  layout?: 'default' | 'sectioned';
  as?: 'div' | 'form';
  onSubmit?: FormEventHandler<HTMLFormElement>;
  [key: `data-${string}`]: string | number | undefined;
}
export function Dialog({ children, open = true, onClose, onAfterClose, className, backdropClassName,
  includeChromeClassName = true, id, role = 'dialog', ariaLabel, ariaLabelledBy, ariaDescribedBy,
  closeOnBackdrop = true, closeOnEscape = true, onEscapeKeyDown, initialFocusRef, size = 'md',
  layout = 'default', as = 'div', onSubmit, ...dataAttributes }: DialogProps) {
  const depth = useContext(DialogDepth);
  const panel = useRef<HTMLDivElement & HTMLFormElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const wasPresent = useRef(false);
  const [phase, setPhase] = useState<'open' | 'closing' | 'closed'>(open ? 'open' : 'closed');
  const callbacks = useRef({ onClose, onAfterClose, onEscapeKeyDown });
  callbacks.current = { onClose, onAfterClose, onEscapeKeyDown };
  const dismissed = useRef(false);
  const present = phase !== 'closed';
  const [hasOpened, setHasOpened] = useState(open);
  // Capture before descendants commit autofocus.
  if (present && !wasPresent.current && typeof document !== 'undefined') {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  wasPresent.current = present;
  useEffect(() => {
    if (open) { dismissed.current = false; setHasOpened(true); setPhase('open'); }
    else setPhase(current => current === 'closed' ? 'closed' : 'closing');
  }, [open]);
  useEffect(() => {
    if (phase !== 'closing') return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const timer = window.setTimeout(() => {
      setPhase('closed');
      if (dismissed.current) callbacks.current.onClose?.();
      callbacks.current.onAfterClose?.();
    }, reduced ? 0 : EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);
  const dismissRef = useRef<() => void>(() => {});
  function dismiss() {
    if (!callbacks.current.onClose || phase !== 'open') return;
    dismissed.current = true;
    setPhase('closing');
  }
  dismissRef.current = dismiss;
  const escapeEnabled = useRef(closeOnEscape);
  escapeEnabled.current = closeOnEscape;
  useEffect(() => {
    const node = panel.current;
    if (!present || !node) return;
    const previous = returnFocus.current;
    if (!dialogs.length) { originalOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; }
    dialogDepth.set(node, depth);
    dialogs.push(node);
    dialogs.sort((a, b) => (dialogDepth.get(a) ?? 0) - (dialogDepth.get(b) ?? 0));
    syncDialogStack();
    const isTop = () => dialogs.at(-1) === node;
    const controls = () => Array.from(node.querySelectorAll<HTMLElement>(focusableSelector))
      .filter(element => element.tabIndex >= 0 && !element.matches(':disabled, input[type="hidden"]') && !element.closest('[hidden], [inert], [aria-hidden="true"]') && getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden');
    const focusFirst = () => {
      const items = controls();
      const preferred = initialFocusRef?.current ?? node.querySelector<HTMLElement>('[autofocus]');
      (preferred && items.includes(preferred) ? preferred : items[0] ?? node).focus();
    };
    if (isTop() && !node.contains(document.activeElement)) focusFirst();
    function onFocus(event: FocusEvent) { if (isTop() && !node!.contains(event.target as Node)) focusFirst(); }
    function onKey(event: KeyboardEvent) {
      if (!isTop() || event.defaultPrevented || event.isComposing) return;
      if (event.key === 'Escape') {
        callbacks.current.onEscapeKeyDown?.(event);
        if (!event.defaultPrevented && escapeEnabled.current) { event.preventDefault(); dismissRef.current(); }
      } else if (event.key === 'Tab') {
        const items = controls();
        const index = items.indexOf(document.activeElement as HTMLElement);
        if (!items.length || (event.shiftKey ? index <= 0 : index === items.length - 1 || index < 0)) {
          event.preventDefault();
          (event.shiftKey ? items.at(-1) : items[0])?.focus();
          if (!items.length) node!.focus();
        }
      }
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocus);
    return () => {
      const wasTop = isTop();
      dialogs.splice(dialogs.indexOf(node), 1);
      syncDialogStack();
      node.inert = false;
      node.removeAttribute('aria-hidden');
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocus);
      if (!dialogs.length) document.body.style.overflow = originalOverflow;
      if (wasTop && previous?.isConnected) previous.focus();
    };
    // Callback identities must not reset focus, scroll locks or stack order.
  }, [present, initialFocusRef, depth]);
  if (typeof document === 'undefined' || (!hasOpened && !present)) return null;
  const Tag = as;
  return createPortal(<DialogDepth.Provider value={depth + 1}><div className={joinClassNames(styles.backdrop, 'modal-backdrop', size === 'side-sheet' ? styles.sideBackdrop : undefined, backdropClassName)}
    hidden={!present} data-state={phase} role="presentation"
    onClick={event => { if (event.target === event.currentTarget && dialogs.at(-1) === panel.current && closeOnBackdrop) dismiss(); }}>
    <Tag ref={panel} id={id} role={present ? role : undefined} tabIndex={-1} aria-modal="true" aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy} aria-describedby={ariaDescribedBy}
      className={joinClassNames(styles.panel, includeChromeClassName ? styles.dialog : undefined, includeChromeClassName ? 'modal' : undefined,
        includeChromeClassName && layout === 'sectioned' ? styles.dialogSectioned : undefined, styles[size], className)}
      onClick={event => event.stopPropagation()} onSubmit={event => { if (event.currentTarget instanceof HTMLFormElement) onSubmit?.(event as FormEvent<HTMLFormElement>); }} {...dataAttributes}>{children}</Tag>
  </div></DialogDepth.Provider>, document.body);
}

type SectionProps = ComponentPropsWithoutRef<'div'>;
export function DialogHeader({ className, ...props }: SectionProps) { return <div className={joinClassNames(styles.header, className)} {...props} />; }
export function DialogBody({ className, ...props }: SectionProps) { return <div className={joinClassNames(styles.body, className)} {...props} />; }
export function DialogFooter({ className, ...props }: SectionProps) { return <div className={joinClassNames(styles.footer, className)} {...props} />; }
export function DialogTitle({ className, ...props }: ComponentPropsWithoutRef<'h2'>) { return <h2 className={joinClassNames(styles.title, className)} {...props} />; }
export function DialogDescription({ className, ...props }: ComponentPropsWithoutRef<'p'>) { return <p className={joinClassNames(styles.description, className)} {...props} />; }
export interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  destructive?: boolean;
  busy?: boolean;
  onAfterClose?: () => void;
}
export function ConfirmDialog({ open, title, children, confirmLabel, cancelLabel, onConfirm, onCancel, destructive = false, busy = false, onAfterClose }: ConfirmDialogProps) {
  const id = useId();
  const cancel = useRef<HTMLButtonElement>(null);
  const [cancelling, setCancelling] = useState(false);
  useEffect(() => { if (open) setCancelling(false); }, [open]);
  return <Dialog open={open && !cancelling} role="alertdialog" size="sm" ariaLabelledBy={id} ariaDescribedBy={`${id}-body`}
    initialFocusRef={cancel} closeOnEscape={!busy} closeOnBackdrop={!busy} onClose={onCancel}
    onAfterClose={() => { if (cancelling) onCancel(); onAfterClose?.(); }}>
    <DialogHeader><DialogTitle id={id}>{title}</DialogTitle></DialogHeader>
    <DialogBody id={`${id}-body`}>{children}</DialogBody>
    <DialogFooter>
      <Button ref={cancel} variant="ghost" disabled={busy || !open || cancelling} onClick={() => setCancelling(true)}>{cancelLabel}</Button>
      <Button variant={destructive ? 'danger' : 'primary'} disabled={busy || !open || cancelling} onClick={onConfirm}>{confirmLabel}</Button>
    </DialogFooter>
  </Dialog>;
}
