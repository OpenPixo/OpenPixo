import { useEffect, useState } from 'react';
import { Button, Dialog, DialogBody, DialogHeader, DialogTitle } from '@openpixo/components';
import { useT } from '../i18n';
import { isMacPlatform } from '../utils/platform';
import styles from './KeyboardShortcutsHelp.module.css';

const OPEN_EVENT = 'pixo:keyboard-shortcuts:open';

export function openKeyboardShortcuts(): void {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

export function KeyboardShortcutsHelp() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const modifier = isMacPlatform() ? '⌘' : 'Ctrl';

  useEffect(() => {
    const show = () => {
      if (!document.querySelector('[role="dialog"], [role="alertdialog"]')) setOpen(true);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat || event.altKey) return;
      const primary = isMacPlatform()
        ? event.metaKey && !event.ctrlKey
        : event.ctrlKey && !event.metaKey;
      const modifiedSlash = primary && !event.shiftKey && (event.key === '/' || event.code === 'Slash');
      const editable = event.target instanceof Element && event.target.closest(
        'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
      );
      const questionMark = event.key === '?' && !event.ctrlKey && !event.metaKey && !editable;
      if (!modifiedSlash && !questionMark) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener(OPEN_EVENT, show);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener(OPEN_EVENT, show);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const shortcuts = [
    { label: t('shortcuts.show'), keys: `? / ${modifier}+/` },
    { label: t('shortcuts.projects'), keys: `${modifier}+K` },
    { label: t('shortcuts.files'), keys: `${modifier}+P` },
    { label: t('shortcuts.settings'), keys: `${modifier}+,` },
    { label: t('shortcuts.send'), keys: `Enter / ${modifier}+Enter` },
    { label: t('shortcuts.newline'), keys: 'Shift+Enter' },
  ];
  return (
    <Dialog open={open} ariaLabelledBy="keyboard-shortcuts-title" onClose={() => setOpen(false)}>
      <DialogHeader className={styles.header}>
        <DialogTitle id="keyboard-shortcuts-title">{t('shortcuts.title')}</DialogTitle>
        <Button variant="ghost" onClick={() => setOpen(false)}>{t('common.close')}</Button>
      </DialogHeader>
      <DialogBody>
        <dl className={styles.list}>
          {shortcuts.map(({ label, keys }) => (
            <div className={styles.row} key={label}>
              <dt>{label}</dt>
              <dd><kbd>{keys}</kbd></dd>
            </div>
          ))}
        </dl>
      </DialogBody>
    </Dialog>
  );
}
