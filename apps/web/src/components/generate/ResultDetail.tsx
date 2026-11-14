import { useEffect, useRef, useState } from 'react';
import { Button, Select } from '@openpixo/components';
import type { RecipeCandidate, RecipeRun } from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import { adoptStudioCandidates } from '../../providers/studio';
import { Icon } from '../Icon';
import { CandidateMedia, stagedFileUrl } from '../studio/CandidateGrid';
import { RecipeFailure } from '../studio/RecipeFailure';
import { formFromRun, runSummary, type GenerateForm } from './generate-request';
import styles from './GenerateView.module.css';

/**
 * The name a download gets: the result's own name (the one 保存到游戏 uses) for its
 * main file, and the staged file's name for the rest, which already say what they are.
 */
export function downloadName(run: Pick<RecipeRun, 'inputs'>, candidate: RecipeCandidate, index: number): string {
  const file = candidate.stagedFiles[index]?.ref.split(/[\\/]/u).at(-1) ?? 'result';
  const name = run.inputs.name;
  if (index !== 0 || typeof name !== 'string' || !/^[\w-]+$/u.test(name)) return file;
  return `${name}${/\.[^.]+$/u.exec(file)?.[0] ?? ''}`;
}

/** A game a result can be saved into. */
export interface GenerateGame { id: string; name: string }

/**
 * One result, large, with what made it and what to do with it
 * (specs/current/asset-generator.md §6.3). 保存到游戏 adopts it into a game's engine
 * path with provenance: the run's own game, or, for art made with no game, the game
 * picked here. 下载 saves a copy wherever the user picks; 再来一次 and 改一下 put the
 * same request back in the box (plain recipes only).
 */
export function ResultDetail({ run, candidate, title, readOnly, games, defaultGameId, onBack, onSaved, onOpenFile, onAgain, onEdit, onPickCandidate }: {
  run: RecipeRun;
  candidate: RecipeCandidate;
  title: string;
  readOnly?: boolean | undefined;
  games: readonly GenerateGame[];
  /** The game picked on the page, offered first for a result made with no game. */
  defaultGameId: string | null;
  onBack: () => void;
  /** Saved into this game; the run comes back with where. */
  onSaved: (run: RecipeRun, projectId: string) => Promise<void>;
  onOpenFile: (projectId: string, path: string) => void;
  onAgain: (form: GenerateForm) => void;
  onEdit: (form: GenerateForm) => void;
  /** Shows another result of the same run. */
  onPickCandidate?: ((candidateId: string) => void) | undefined;
}) {
  const { t, locale } = useI18n();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => { headingRef.current?.focus({ preventScroll: true }); }, [candidate.id]);

  const form = formFromRun(run);
  const savedGame = candidate.adoptedPaths?.length ? candidate.adoptedProjectId ?? run.projectId : null;
  const [target, setTarget] = useState<string>(run.projectId ?? defaultGameId ?? savedGame ?? games[0]?.id ?? '');
  // A game's result goes only into its game; one made with no game goes into any, again if picked again.
  const saved = savedGame && savedGame === target ? candidate.adoptedPaths ?? [] : [];
  const gameName = (id: string | null) => games.find(entry => entry.id === id)?.name ?? id ?? '';
  const usable = run.status === 'ready' && !candidate.error && candidate.stagedFiles.length > 0;
  const label = title;
  const model = run.model.provider === 'openpixo' ? t('generate.paidWithCredits') : run.model.id;

  async function save() {
    if (readOnly || pending || !usable || saved.length || !target) return;
    setPending(true); setError('');
    try {
      await onSaved(await adoptStudioCandidates(target, run.id, [candidate.id]), target);
    } catch (cause) {
      console.warn('[generate] save failed:', cause);
      setError(cause instanceof Error && cause.message ? cause.message : t('generate.failed'));
    } finally { setPending(false); }
  }

  return <section className={styles.detail} aria-labelledby="generate-detail-title" data-testid="generate-detail">
    <div className={styles.stage}>
      <div className={styles.preview}>
        {candidate.stagedFiles[0] ? <CandidateMedia file={candidate.stagedFiles[0]} url={stagedFileUrl(run, candidate, 0)} label={label} />
          : candidate.error ? null : <p className={styles.muted} role="status">{t('studio.cloud.generating')}</p>}
      </div>
      {run.candidates.length > 1 && onPickCandidate && <div className={styles.siblings} role="group" aria-label={t('generate.otherResults')}>
        {run.candidates.map(entry => <button key={entry.id} type="button" className={styles.sibling} aria-pressed={entry.id === candidate.id}
          aria-label={`${title} · ${entry.index + 1}`} onClick={() => onPickCandidate(entry.id)} data-testid="generate-sibling">
          {entry.stagedFiles[0]?.mime.startsWith('image/') ? <img src={stagedFileUrl(run, entry, 0)} alt="" loading="lazy" /> : <span>{entry.index + 1}</span>}
        </button>)}
      </div>}
      {candidate.stagedFiles.length > 1 && <details className={styles.derivedBox}>
        <summary>{t('generate.allFiles')} · {candidate.stagedFiles.length}</summary>
        <ul className={styles.derived} aria-label={t('generate.allFiles')}>
          {candidate.stagedFiles.map((file, index) => <li key={file.ref}>
            <a href={stagedFileUrl(run, candidate, index)} download={downloadName(run, candidate, index)}>{downloadName(run, candidate, index)}</a>
          </li>)}
        </ul>
      </details>}
    </div>

    <aside className={styles.info}>
      <header className={styles.infoHeader}>
        <div className={styles.infoHeading}>
          <h3 id="generate-detail-title" ref={headingRef} tabIndex={-1} className={styles.detailTitle}>{label}</h3>
          <p className={styles.detailMeta}>
            <span>{new Date(run.createdAt).toLocaleString(locale, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
            {run.candidates.length > 1 && <span>{t('generate.resultNumber', { n: candidate.index + 1, total: run.candidates.length })}</span>}
          </p>
        </div>
        <Button size="sm" variant="ghost" className={styles.close} onClick={onBack} aria-label={t('generate.closeResult')}>
          <Icon name="close" size={16} /></Button>
      </header>
      {candidate.error && <div className={styles.problem} role="alert">
        <RecipeFailure error={candidate.error} errorCode={candidate.errorCode} errorReason={candidate.errorReason} /></div>}
      {candidate.checks.some(check => !check.ok) && <ul className={styles.checks}>
        {candidate.checks.filter(check => !check.ok).map((check, index) => <li key={`${check.check}-${index}`}>{check.check}{check.detail ? ` · ${check.detail}` : ''}</li>)}
      </ul>}
      {runSummary(run) && <figure className={styles.asked}>
        <figcaption className={styles.askedLabel}>{t('generate.askedFor')}</figcaption>
        <blockquote>{runSummary(run)}</blockquote>
      </figure>}

      <dl className={styles.facts}>
        <dt>{t('generate.madeWith')}</dt><dd>{model}</dd>
        <dt>{t('generate.madeBy')}</dt><dd>{run.origin === 'agent' ? t('generate.byAgent') : t('generate.byYou')}</dd>
        <dt>{t('generate.game')}</dt><dd>{run.projectId ? gameName(run.projectId) : t('generate.noGame')}</dd>
        {savedGame && (candidate.adoptedPaths?.length ?? 0) > 0 && <><dt>{t('generate.savedTo')}</dt><dd>
          {run.projectId === null && <span className={styles.savedGame}>{gameName(savedGame)}</span>}
          <ul className={styles.paths}>
            {candidate.adoptedPaths!.map(path => <li key={path}><Button size="sm" variant="ghost" onClick={() => onOpenFile(savedGame, path)}>{path}</Button></li>)}
          </ul></dd></>}
      </dl>

      {error && <p className={styles.problem} role="alert">{error}</p>}
      <div className={styles.saveRow}>
        {run.projectId === null && usable && !readOnly && (games.length ? <label className={styles.saveTarget}>
          <span>{t('generate.saveInto')}</span>
          <Select value={target} onChange={event => setTarget(event.target.value)} data-testid="generate-save-game">
            {games.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          </Select>
        </label> : <span className={styles.muted}>{t('generate.noGamesYet')}</span>)}
        <Button className={styles.saveButton} onClick={() => void save()} disabled={readOnly || pending || !usable || saved.length > 0 || !target} aria-busy={pending}
          data-testid="generate-save"><Icon name={saved.length ? 'check' : 'folder-2'} size={15} />
          {saved.length ? t('generate.saved') : savedGame && run.projectId === null ? t('generate.saveAnother') : t('generate.save')}</Button>
      </div>
      <div className={styles.detailActions}>
        {usable && <a className={styles.secondaryAction} href={stagedFileUrl(run, candidate, 0)} download={downloadName(run, candidate, 0)}
          data-testid="generate-download">{t('generate.download')}</a>}
        {form && !readOnly && <button type="button" className={styles.secondaryAction} onClick={() => onAgain(form)} data-testid="generate-again">{t('generate.again')}</button>}
        {form && !readOnly && <button type="button" className={styles.secondaryAction} onClick={() => onEdit(form)} data-testid="generate-edit">{t('generate.edit')}</button>}
      </div>
    </aside>
  </section>;
}
