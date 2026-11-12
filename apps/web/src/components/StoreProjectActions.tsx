import { useId, useState } from 'react';
import { Button, Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle, Select } from '@openpixo/components';
import { useI18n } from '../i18n';
import { navigate } from '../router';
import { setProjectArtStyle } from '../providers/styles';
import { clearProjectComposerPrefill, queueProjectComposerPrefill } from '../state/composer-prefill';
import { StoreView, type StoreProject, type StoreTab } from './store/StoreView';
import styles from './StoreProjectActions.module.css';

type StoreAction = { kind: 'example'; prompt: string; styleId?: string } | { kind: 'style'; styleId: string };

interface Props {
  itemName?: string;
  initialTab?: StoreTab;
  projects: StoreProject[];
  onOpenProject: (id: string) => Promise<boolean> | boolean | void;
  onOpenAccount?: () => void;
}

export function StoreProjectActions({ itemName, initialTab, projects, onOpenProject, onOpenAccount }: Props) {
  const { t, locale } = useI18n();
  const titleId = useId();
  const selectId = useId();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pending, setPending] = useState<StoreAction | null>(null);
  const [projectId, setProjectId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const selected = projects.find(project => project.id === projectId) ?? projects[0];

  async function apply(action: StoreAction, id: string) {
    setBusy(true); setError('');
    try {
      if (action.styleId) await setProjectArtStyle(id, action.styleId, undefined, locale);
      if (action.kind === 'example') queueProjectComposerPrefill(id, action.prompt);
      const opened = await onOpenProject(id);
      if (opened === false) {
        if (action.kind === 'example') clearProjectComposerPrefill(id);
        setError(t('store.action.openFailed'));
      } else setPending(null);
    } catch (cause) {
      clearProjectComposerPrefill(id);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  }

  function begin(action: StoreAction) {
    setPending(action); setPickerOpen(true); setError('');
    const onlyProject = projects.length === 1 ? projects[0] : undefined;
    if (onlyProject) void apply(action, onlyProject.id);
  }

  return <>
    <StoreView itemName={itemName} initialTab={initialTab} projects={projects} onOpenAccount={onOpenAccount}
      onTryExample={(prompt, styleId) => begin({ kind: 'example', prompt, styleId })}
      onUseStyle={styleId => begin({ kind: 'style', styleId })} />
    {pending && <Dialog open={pickerOpen} ariaLabelledBy={titleId} closeOnEscape={!busy} closeOnBackdrop={!busy}
      onClose={() => setPending(null)} onAfterClose={() => { if (!pickerOpen) setPending(null); }}>
      <div className={styles.content}>
        <DialogHeader><DialogTitle id={titleId}>{t('store.action.chooseProject')}</DialogTitle></DialogHeader>
        <DialogBody>
          {selected ? <label className={styles.field} htmlFor={selectId}>{t('store.project')}
            <Select id={selectId} value={selected.id} disabled={busy} onChange={event => setProjectId(event.target.value)}>
              {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
            </Select>
          </label> : <p>{t('store.action.projectRequired')}</p>}
          {busy && <p role="status">{t('common.loading')}</p>}
          {error && <p role="alert">{error}</p>}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={() => setPickerOpen(false)}>{t('store.action.cancel')}</Button>
          {selected ? <Button variant="primary" disabled={busy} onClick={() => { void apply(pending, selected.id); }}>{t('store.action.openProject')}</Button>
            : <Button variant="primary" onClick={() => navigate({ kind: 'home', view: 'projects' })}>{t('store.action.openProjects')}</Button>}
        </DialogFooter>
      </div>
    </Dialog>}
  </>;
}
