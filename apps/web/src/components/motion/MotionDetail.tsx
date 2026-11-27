import { useState, type ReactNode } from 'react';
import { Button, ConfirmDialog, Input, Select } from '@openpixo/components';
import { MOTION_NAME_MAX, type InstalledMotionCharacter, type MotionCharacter } from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import { deleteMotion, installMotion, motionDownload, renameMotion } from '../../providers/motion';
import { Icon } from '../Icon';
import { codeText, errorText } from './motion-text';
import { MotionProgress } from './MotionProgress';
import { MotionStage } from './MotionStage';
import styles from './Motion.module.css';

export interface MotionGame { id: string; name: string }

/** One moving character: how far it is, or the character moving, to try, download and put into a game. */
export function MotionDetail({ character: c, games, balance, onBack, onChange, onDeleted, onOpenProject }: {
  character: MotionCharacter;
  games: readonly MotionGame[];
  balance: ReactNode;
  onBack: () => void;
  onChange: (next: MotionCharacter) => void;
  onDeleted: (id: string) => void;
  onOpenProject: (id: string) => void;
}) {
  const { t } = useI18n();
  const [naming, setNaming] = useState<string | null>(null), [asking, setAsking] = useState(false), [busy, setBusy] = useState(false);
  const [game, setGame] = useState(games[0]?.id ?? ''), [installed, setInstalled] = useState<(InstalledMotionCharacter & { game: string }) | null>(null), [problem, setProblem] = useState<string | null>(null);
  const picked = games.some(g => g.id === game) ? game : games[0]?.id ?? '';

  async function act(work: () => Promise<void>): Promise<void> {
    setBusy(true);
    setProblem(null);
    try { await work(); } catch (error) { setProblem(errorText(t, error)); } finally { setBusy(false); }
  }
  const rename = (): Promise<void> => act(async () => { if (naming?.trim()) onChange(await renameMotion(c.id, naming.trim())); setNaming(null); });
  const install = (): Promise<void> => act(async () => {
    const done = await installMotion(c.id, picked);
    setInstalled({ ...done, game: picked });
  });

  return <>
    <header className={styles.detailHeader}>
      <Button size="icon" variant="ghost" aria-label={t('motion.back')} onClick={onBack}><Icon name="arrow-left" size={16} /></Button>
      {naming === null ? <h1>{c.name}{c.state === 'ready' && <Button size="icon" variant="ghost" aria-label={t('motion.rename')} onClick={() => setNaming(c.name)}><Icon name="pencil" size={14} /></Button>}</h1>
        : <form className={styles.rename} onSubmit={e => { e.preventDefault(); void rename(); }}>
          <Input value={naming} maxLength={MOTION_NAME_MAX} autoFocus aria-label={t('motion.nameLabel')} onChange={e => setNaming(e.target.value)} />
          <Button size="sm" type="submit" variant="primary" disabled={busy || !naming.trim()}>{t('motion.save')}</Button>
          <Button size="sm" variant="ghost" onClick={() => setNaming(null)}>{t('common.cancel')}</Button>
        </form>}
      <div className={styles.right}>{balance}</div>
    </header>
    <div className={styles.detail}>
      {c.state === 'ready' ? <MotionStage characterId={c.id} name={c.name} />
        : <div className={styles.stageWrap}><div className={styles.stage}>
          {c.state === 'making' && c.job ? <MotionProgress job={c.job} />
            : <div className={styles.cardFailed}><strong>{t('motion.state.failed')}</strong><span>{codeText(t, c.job?.errorCode ?? null)}</span><span>{t('motion.creditsBack')}</span></div>}
        </div></div>}
      <aside className={styles.panel}>
        {c.state === 'ready' && <>
          <h3>{t('motion.download')}</h3>
          <p className={styles.hint}>{t('motion.downloadHint')}</p>
          <a className={styles.download} href={motionDownload(c.id)} download data-testid="motion-download"><Icon name="download" size={14} /> {t('motion.download')}</a>
          <h3>{t('motion.addToGame')}</h3>
          {games.length ? <div className={styles.row}>
            <Select value={picked} aria-label={t('motion.pickGame')} disabled={busy} onChange={e => { setGame(e.target.value); setInstalled(null); }} data-testid="motion-game">
              {games.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </Select>
            <Button size="sm" variant="primary" disabled={busy || !picked} onClick={() => void install()} data-testid="motion-install">{busy ? t('motion.adding') : t('motion.addToGame')}</Button>
          </div> : <p className={styles.hint}>{t('motion.noGames')}</p>}
          {installed && <div className={styles.notice} role="status">
            <p>{installed.playerState === 'edited' ? t('motion.addedEdited', { file: installed.file }) : t('motion.added', { file: installed.file })}</p>
            <pre className={styles.usage}>{installed.usage}</pre>
            <Button size="sm" variant="secondary" onClick={() => onOpenProject(installed.game)}>{t('motion.openGame')}</Button>
          </div>}
        </>}
        {problem && <p className={styles.problem} role="alert">{problem}</p>}
        <div className={styles.panelEnd}>
          <Button size="sm" variant="ghost" disabled={busy || c.state === 'making'} onClick={() => setAsking(true)}><Icon name="trash" size={14} /> {t('motion.delete')}</Button>
        </div>
      </aside>
    </div>
    <ConfirmDialog open={asking} destructive busy={busy} title={t('motion.delete')} confirmLabel={t('motion.delete')} cancelLabel={t('common.cancel')} onCancel={() => setAsking(false)}
      onConfirm={() => void act(async () => { await deleteMotion(c.id); setAsking(false); onDeleted(c.id); })}>
      {t('motion.deleteConfirm', { name: c.name })}
    </ConfirmDialog>
  </>;
}
