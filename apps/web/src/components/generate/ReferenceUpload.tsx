import { useRef, useState, type ReactNode } from 'react';
import { Button } from '@openpixo/components';
import { useI18n } from '../../i18n';
import { uploadGenerateReference } from '../../providers/studio';
import styles from './GenerateBox.module.css';

/**
 * A picture uploaded to 生成 for a run with no game: the daemon's ref, the file's own
 * name, and a local preview of it while this page is open.
 */
export interface UploadedReference { ref: string; name: string; preview?: string | undefined }

function localPreview(file: File): string | undefined {
  try { return typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : undefined; } catch { return undefined; }
}

/**
 * Adds pictures to use as references when no game is picked (a game's runs use its files).
 * Each one goes to the daemon's generate area and comes back as a ref a run can name.
 */
export function ReferenceUpload({ disabled, onUploaded, className, children }: {
  disabled?: boolean | undefined;
  onUploaded: (upload: UploadedReference) => void;
  className?: string | undefined;
  /** The button's content; the plain "upload a picture" label when left out. */
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true); setError('');
    try {
      for (const file of Array.from(files)) {
        const { ref } = await uploadGenerateReference(file);
        onUploaded({ ref, name: file.name, preview: localPreview(file) });
      }
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : t('generate.uploadFailed'));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return <>
    <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden data-testid="generate-upload-input"
      onChange={event => void upload(event.target.files)} />
    <Button type="button" variant={className ? 'ghost' : 'secondary'} size={className ? 'default' : 'sm'} className={className} disabled={disabled || busy} aria-busy={busy}
      aria-label={t('generate.uploadReference')} onClick={() => input.current?.click()} data-testid="generate-upload">
      {children ?? t('generate.uploadReference')}</Button>
    {error && <span className={styles.uploadProblem} role="alert">{error}</span>}
  </>;
}
