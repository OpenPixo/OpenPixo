import { useId, useState, type FormEvent } from 'react';
import { Button, Dialog, DialogBody, DialogFooter, DialogTitle, Input, Textarea } from '@openpixo/components';
import type { CharacterCard } from '@openpixo/contracts';
import { CharacterCardSchema } from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import { saveStudioCharacter } from '../../providers/studio';
import { studioCopy } from './copy';
import { useStudioDialogFocus } from './useStudioDialogFocus';
import styles from './StudioPanel.module.css';

export function CharacterEditor({ projectId, card, onSaved, onClose }: {
  projectId: string; card?: CharacterCard;
  onSaved: (card: CharacterCard) => void; onClose: () => void;
}) {
  const { locale } = useI18n();
  const copy = studioCopy(locale);
  const id = useId();
  useStudioDialogFocus(id);
  const [draft, setDraft] = useState<CharacterCard>(card ?? { slug: '', name: '', description: '', references: [], style: '', notes: '' });
  const [references, setReferences] = useState(card?.references.join('\n') ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function save(event: FormEvent) {
    event.preventDefault();
    setPending(true); setError('');
    try {
      const value = CharacterCardSchema.parse({ ...draft, references: references.split(/\r?\n/).map(path => path.trim()).filter(Boolean) });
      onSaved(await saveStudioCharacter(projectId, value, card?.slug));
    } catch (cause) { setError(cause instanceof Error ? cause.message : copy.error); }
    finally { setPending(false); }
  }
  return <Dialog id={id} as="form" onSubmit={event => void save(event)} onClose={pending ? undefined : onClose}
    closeOnEscape ariaLabelledBy={`${id}-title`} className={styles.dialog}>
    <DialogTitle id={`${id}-title`}>{card ? copy.editCharacter : copy.addCharacter}</DialogTitle>
    <DialogBody className={styles.form}>
      <label className={styles.field}>{copy.slug}<Input required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={80}
        disabled={!!card || pending} value={draft.slug} onChange={event => setDraft({ ...draft, slug: event.target.value })} /></label>
      <label className={styles.field}>{copy.name}<Input required maxLength={200} disabled={pending}
        value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
      <label className={styles.field}>{copy.description}<Textarea required rows={3} maxLength={20000} disabled={pending}
        value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} /></label>
      <label className={styles.field}>{copy.references}<Textarea rows={3} disabled={pending} value={references}
        onChange={event => setReferences(event.target.value)} /></label>
      <label className={styles.field}>{copy.style}<Input maxLength={2000} disabled={pending}
        value={draft.style} onChange={event => setDraft({ ...draft, style: event.target.value })} /></label>
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </DialogBody>
    <DialogFooter><Button disabled={pending} onClick={onClose}>{copy.cancel}</Button>
      <Button type="submit" variant="primary" disabled={pending} aria-busy={pending}>{copy.save}</Button></DialogFooter>
  </Dialog>;
}
