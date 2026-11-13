import { useEffect, useRef, useState } from 'react';
import { Button } from '@openpixo/components';
import type { RecipeCandidate, RecipeRun } from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import { adoptStudioCandidates } from '../../providers/studio';
import { Icon } from '../Icon';
import { CandidateMedia, stagedFileUrl } from '../studio/CandidateGrid';
import { RecipeFailure } from '../studio/RecipeFailure';
import { formFromRun, runSummary, type GenerateForm } from './generate-request';
import styles from './GenerateView.module.css';

/** The name a download gets: the file's own name in staging. */
export function downloadName(candidate: RecipeCandidate, index: number): string {
  return candidate.stagedFiles[index]?.ref.split(/[\\/]/u).at(-1) ?? 'result';
}

/**
 * One result, large, with what made it and what to do with it
 * (specs/current/asset-generator.md §6.3). 保存到游戏 adopts it into the project's
 * engine path with provenance; 下载 saves a copy wherever the user picks; 再来一次
 * and 改一下 put the same request back in the box (plain recipes only).
 */
export function ResultDetail({ run, candidate, title, readOnly, onBack, onRunChange, onSaved, onOpenFile, onAgain, onEdit }: {
  run: RecipeRun;
  candidate: RecipeCandidate;
  title: string;
  readOnly?: boolean;
  onBack: () => void;
  onRunChange: (run: RecipeRun) => void;
  onSaved: () => Promise<void>;
  onOpenFile: (path: string) => void;
  onAgain: (form: GenerateForm) => void;
  onEdit: (form: GenerateForm) => void;
}) {
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => { headingRef.current?.focus({ preventScroll: true }); }, [candidate.id]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) onBack(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack]);

  const form = formFromRun(run);
  const saved = candidate.adoptedPaths ?? [];
  const usable = run.status === 'ready' && !candidate.error && candidate.stagedFiles.length > 0;
  const label = `${title} · ${candidate.index + 1}`;
  const model = run.model.provider === 'openpixo' ? t('generate.paidWithCredits') : run.model.id;

  async function save() {
    if (readOnly || pending || !usable || saved.length) return;
    setPending(true); setError('');
    try {
      onRunChange(await adoptStudioCandidates(run.projectId, run.id, [candidate.id]));
      await onSaved();
    } catch (cause) {
      console.warn('[generate] save failed:', cause);
      setError(cause instanceof Error && cause.message ? cause.message : t('generate.failed'));
    } finally { setPending(false); }
  }

  return <section className={styles.detail} aria-labelledby="generate-detail-title" data-testid="generate-detail">
    <Button size="sm" variant="ghost" className={styles.back} onClick={onBack}>
      <Icon name="arrow-left" size={14} />{t('generate.history')}
    </Button>
    <h3 id="generate-detail-title" ref={headingRef} tabIndex={-1} className={styles.detailTitle}>{label}</h3>
    <div className={styles.preview}>
      {candidate.stagedFiles[0] ? <CandidateMedia file={candidate.stagedFiles[0]} url={stagedFileUrl(run, candidate, 0)} label={label} />
        : candidate.error ? null : <p className={styles.muted} role="status">{t('studio.cloud.generating')}</p>}
    </div>
    {candidate.stagedFiles.length > 1 && <ul className={styles.derived} aria-label={t('generate.allFiles')}>
      {candidate.stagedFiles.map((file, index) => <li key={file.ref}>
        <a href={stagedFileUrl(run, candidate, index)} download={downloadName(candidate, index)}>{downloadName(candidate, index)}</a>
      </li>)}
    </ul>}
    {candidate.error && <div className={styles.problem} role="alert">
      <RecipeFailure error={candidate.error} errorCode={candidate.errorCode} errorReason={candidate.errorReason} /></div>}
    {candidate.checks.some(check => !check.ok) && <ul className={styles.checks}>
      {candidate.checks.filter(check => !check.ok).map((check, index) => <li key={`${check.check}-${index}`}>{check.check}{check.detail ? ` · ${check.detail}` : ''}</li>)}
    </ul>}

    <dl className={styles.facts}>
      {runSummary(run) && <><dt>{t('generate.asked')}</dt><dd>{runSummary(run)}</dd></>}
      <dt>{t('generate.madeWith')}</dt><dd>{model}</dd>
      <dt>{t('generate.madeBy')}</dt><dd>{run.origin === 'agent' ? t('generate.byAgent') : t('generate.byYou')}</dd>
      {saved.length > 0 && <><dt>{t('generate.savedTo')}</dt><dd><ul className={styles.paths}>
        {saved.map(path => <li key={path}><Button size="sm" variant="ghost" onClick={() => onOpenFile(path)}>{path}</Button></li>)}
      </ul></dd></>}
    </dl>

    {error && <p className={styles.problem} role="alert">{error}</p>}
    <div className={styles.detailActions}>
      <Button variant="primary" onClick={() => void save()} disabled={readOnly || pending || !usable || saved.length > 0} aria-busy={pending}
        data-testid="generate-save">{saved.length ? t('generate.saved') : t('generate.save')}</Button>
      {usable && <a className={styles.download} href={stagedFileUrl(run, candidate, 0)} download={downloadName(candidate, 0)}
        data-testid="generate-download">{t('generate.download')}</a>}
      {form && !readOnly && <Button variant="secondary" onClick={() => onAgain(form)} data-testid="generate-again">{t('generate.again')}</Button>}
      {form && !readOnly && <Button variant="ghost" onClick={() => onEdit(form)} data-testid="generate-edit">{t('generate.edit')}</Button>}
    </div>
  </section>;
}
