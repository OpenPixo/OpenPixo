import { useEffect, useState } from 'react';
import { Button } from '@openpixo/components';
import type { GameTuningParameter } from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import { Icon } from '../Icon';
import { readTuningGameRun, tuningPreviewUrl } from './tuning-api';
import { useTuning } from './useTuning';
import { TuningParameter } from './TuningParameter';
import styles from './TuningPanel.module.css';

function useRunningPreview(projectId: string, active: boolean) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try { const run = await readTuningGameRun(projectId, controller.signal); if (!controller.signal.aborted) setUrl(tuningPreviewUrl(run)); }
      catch { if (!controller.signal.aborted) setUrl(null); }
      if (!controller.signal.aborted) timer = setTimeout(() => void refresh(), 1_500);
    };
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [projectId, active]);
  return url;
}

export interface TuningPanelProps {
  projectId: string;
  viewerOnly?: boolean;
  active?: boolean;
  onOpenFile: (path: string, line: number) => void;
  onRefreshFiles?: () => Promise<void>;
  /**
   * Reloads the running game the panel sits under. The panel has no game of
   * its own: a second iframe would run a second copy of the game below the
   * first one.
   */
  onReloadGame?: () => void;
}

export function TuningPanel({ projectId, viewerOnly, active = true, onOpenFile, onRefreshFiles, onReloadGame }: TuningPanelProps) {
  const { locale, t } = useI18n();
  const tuning = useTuning(projectId, onRefreshFiles);
  const url = useRunningPreview(projectId, active);
  const [applying, setApplying] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const groups = new Map<string, GameTuningParameter[]>();
  for (const parameter of tuning.parameters) groups.set(parameter.group, [...(groups.get(parameter.group) ?? []), parameter]);
  const web = tuning.parameters.some(parameter => parameter.source === 'web-json');
  const errorKey = tuning.error === 'TUNING_CONFLICT' ? 'gameTuning.error.conflict'
    : tuning.error === 'TUNING_INVALID_VALUE' ? 'gameTuning.error.invalid'
      : tuning.error === 'TUNING_CHECKPOINT_FAILED' ? 'gameTuning.error.checkpoint' : 'gameTuning.error.generic';
  async function applyRefresh() {
    setApplying(true); setPreviewError(false);
    try {
      if (!await tuning.flush()) return;
      // Re-check after saving; a run may have ended while the controls were being edited.
      const currentUrl = tuningPreviewUrl(await readTuningGameRun(projectId));
      if (!currentUrl) throw new Error('No active web game');
      onReloadGame?.();
    } catch { setPreviewError(true); }
    finally { setApplying(false); }
  }
  const showStatus = !tuning.loading && !tuning.error && tuning.parameters.length > 0;
  // One line: the full hint stays in the text (read out whole) and its tooltip; only the view truncates it.
  const hint = `${t('gameTuning.hint')} ${t('gameTuning.resetHint')}`;
  return <section className={styles.root} aria-label={t('gameTuning.tab')}>
    <header className={styles.header}>
      <h2>{t('gameTuning.title')}</h2>
      <p className={styles.headerHint} title={hint}>{hint}</p>
      {showStatus ? <p role="status" className={styles.status}>
        {t(tuning.saving ? 'gameTuning.saving' : tuning.dirty ? 'gameTuning.pending' : 'gameTuning.saved')}
      </p> : null}
      <Button size="icon" variant="ghost" className={styles.iconAction} aria-label={t('gameTuning.rescan')} title={t('gameTuning.rescan')}
        disabled={tuning.loading || tuning.saving || tuning.dirty || applying} onClick={tuning.refresh}>
        <Icon name="refresh" size={14} />
      </Button>
    </header>
    {viewerOnly ? <p className={styles.hint}>{t('gameTuning.readOnly')}</p> : null}
    {tuning.error ? <p className={styles.error} role="alert">{t(errorKey)}</p> : null}
    {tuning.warnings.map(warning => <p className={styles.hint} key={`${warning.code}:${warning.filePath}`}>
      {t(warning.code === 'TUNING_SCAN_LIMIT' ? 'gameTuning.warning.scanLimit' : warning.code === 'TUNING_INVALID_JSON' ? 'gameTuning.warning.invalidJson' : 'gameTuning.warning.readFailed', { path: warning.filePath })}
    </p>)}
    {tuning.loading ? <p role="status">{t('gameTuning.loading')}</p> : !tuning.parameters.length && !tuning.error ? <div className={styles.empty}>
      <h3>{t('gameTuning.emptyTitle')}</h3><p>{t('gameTuning.emptyGodot')}</p><p>{t('gameTuning.emptyWeb')}</p><p>{t('gameTuning.askAgent')}</p>
    </div> : <div className={styles.groups}>
      {[...groups].map(([group, parameters]) => <section key={group} className={styles.group}>
        <h3 className={styles.groupTitle}>{parameters.find(parameter => parameter.group_i18n?.[locale]?.trim())?.group_i18n?.[locale] || group}</h3>
        {parameters.map(parameter => <TuningParameter key={parameter.id} projectId={projectId} parameter={parameter}
          disabled={!!viewerOnly || !!tuning.error || applying} onChange={value => tuning.edit(parameter.id, value)} onOpenFile={onOpenFile} />)}
      </section>)}
    </div>}
    {web ? <div className={styles.playtest}>
      <p className={styles.hint}>{t(url ? 'gameTuning.previewHint' : 'gameTuning.previewStopped')}</p>
      {url && onReloadGame ? <Button size="sm" variant="secondary" disabled={!!viewerOnly || !!tuning.error || applying} onClick={() => void applyRefresh()}>
        {t(applying ? 'gameTuning.applying' : 'gameTuning.applyRefresh')}
      </Button> : null}
      {previewError ? <p role="alert">{t('gameTuning.error.preview')}</p> : null}
    </div> : null}
  </section>;
}
