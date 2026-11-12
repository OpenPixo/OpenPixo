import { useId, useState, type ReactNode } from 'react';
import { Button } from '@openpixo/components';
import styles from './StudioDisclosure.module.css';

/**
 * One collapsed group of Generate options: a full-width summary row (title +
 * current value) over content that expands with the shared accordion pattern.
 * Content stays mounted while closed so its data keeps loading and the exit
 * transition plays; it is `inert` and hidden from assistive tech until opened.
 */
export function StudioDisclosure({ title, meta, open: controlledOpen, defaultOpen = false, onOpenChange, id, children }: {
  title: string;
  meta?: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  id?: string;
  children: ReactNode;
}) {
  const [uncontrolled, setUncontrolled] = useState(defaultOpen);
  const open = controlledOpen ?? uncontrolled;
  const contentId = useId();
  function toggle() {
    const next = !open;
    if (controlledOpen === undefined) setUncontrolled(next);
    onOpenChange?.(next);
  }
  return <section id={id} className={styles.root} data-open={open}>
    <Button variant="ghost" className={styles.summary} aria-expanded={open} aria-controls={contentId} onClick={toggle}>
      <span className={styles.title}>{title}</span>
      {meta ? <>{' '}<span className={styles.meta}>{meta}</span></> : null}
      <span className={styles.chevron} aria-hidden="true" />
    </Button>
    <div id={contentId} className={`accordion-collapsible${open ? ' open' : ''}`} aria-hidden={!open}
      ref={(node) => { if (node) node.inert = !open; }}>
      <div className="accordion-collapsible-inner"><div className={styles.body}>{children}</div></div>
    </div>
  </section>;
}
