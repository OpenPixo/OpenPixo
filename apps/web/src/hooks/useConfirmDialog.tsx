import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ConfirmDialog } from '@openpixo/components';
import { useT } from '../i18n';

interface Confirmation { title: string; body: ReactNode; confirmLabel: string; destructive?: boolean }
/** Adapts a user decision to promise-based workflows such as batch file deletion. */
export function useConfirmDialog() {
  const t = useT();
  const [request, setRequest] = useState<(Confirmation & { id: number }) | null>(null);
  const [accepted, setAccepted] = useState(false);
  const sequence = useRef(0);
  const resolve = useRef<((value: boolean) => void) | null>(null);
  useEffect(() => () => resolve.current?.(false), []);
  function settle(value: boolean) { const complete = resolve.current; resolve.current = null; setRequest(null); complete?.(value); }
  function confirm(next: Confirmation): Promise<boolean> {
    resolve.current?.(false);
    setAccepted(false);
    setRequest({ ...next, id: ++sequence.current });
    return new Promise<boolean>(complete => { resolve.current = complete; });
  }
  const dialog = request ? <ConfirmDialog key={request.id} open={!accepted} title={request.title} confirmLabel={request.confirmLabel}
    cancelLabel={t('common.cancel')} destructive={request.destructive} onConfirm={() => setAccepted(true)} onCancel={() => settle(false)} onAfterClose={() => { if (accepted) settle(true); }}>
    {request.body}
  </ConfirmDialog> : null;
  return { confirm, dialog };
}
