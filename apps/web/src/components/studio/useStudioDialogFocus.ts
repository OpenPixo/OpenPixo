import { useEffect } from 'react';

export function useStudioDialogFocus(id: string, open = true) {
  useEffect(() => {
    if (!open) return;
    const panel = document.getElementById(id);
    if (!panel) return;
    const previous = document.activeElement;
    const controls = () => Array.from(panel.querySelectorAll<HTMLElement>(
      'a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled)',
    ));
    panel.tabIndex = -1;
    (controls()[0] ?? panel).focus();
    function trap(event: KeyboardEvent) {
      if (event.key !== 'Tab') return;
      const nodes = controls();
      const first = nodes[0] ?? panel!;
      const last = nodes.at(-1) ?? panel!;
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel)) {
        event.preventDefault(); first.focus();
      }
    }
    panel.addEventListener('keydown', trap);
    return () => { panel.removeEventListener('keydown', trap); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [id, open]);
}
