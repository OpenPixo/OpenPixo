import { useId, useState } from 'react';
import { Button, Dialog, DialogBody, DialogFooter, DialogTitle, Input } from '@openpixo/components';
import type { RecipeCandidate, RecipeRun } from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import { Model3dViewer } from '../Model3dViewer';
import { RecipeFailure } from './RecipeFailure';
import { studioCopy } from './copy';
import { useStudioDialogFocus } from './useStudioDialogFocus';
import styles from './StudioPanel.module.css';

/** Staged refs are daemon filesystem paths; the browser reads them through the staged-file route. */
export function stagedFileUrl(run: RecipeRun, candidate: RecipeCandidate, index: number): string {
  return `/api/projects/${encodeURIComponent(run.projectId)}/recipe-runs/${encodeURIComponent(run.id)}/candidates/${encodeURIComponent(candidate.id)}/files/${index}`;
}

export function CandidateMedia({ file, url, label }: { file: RecipeCandidate['stagedFiles'][number]; url: string; label: string }) {
  if (file.mime.startsWith('image/')) return <img src={url} alt={label} className={styles.candidateImage} />;
  if (file.mime.startsWith('audio/')) return <audio src={url} controls aria-label={label} />;
  if (file.mime.startsWith('video/')) return <video src={url} controls aria-label={label} className={styles.candidateImage} />;
  if (file.mime === 'model/gltf-binary') return <Model3dViewer src={url} name={label} height={220} />;
  return <a href={url} target="_blank" rel="noreferrer">{file.ref.split(/[\\/]/).at(-1)}</a>;
}

function Checks({ candidate }: { candidate: RecipeCandidate }) {
  const { locale } = useI18n();
  const copy = studioCopy(locale);
  return <ul className={styles.checks}>
    {candidate.checks.map((result, index) => <li key={`${result.check}-${index}`} title={result.detail}
      className={result.ok ? styles.checkPassed : styles.error}>
      {result.ok ? '✓' : '✕'} {result.check}: {result.ok ? copy.passed : copy.failed}{result.detail ? ` · ${result.detail}` : ''}
    </li>)}
    {candidate.error && <li className={styles.error}><RecipeFailure error={candidate.error} errorCode={candidate.errorCode} errorReason={candidate.errorReason} /></li>}
  </ul>;
}

export function CandidateGrid({ run, selected, pending, readOnly, onSelect, onAdopt, onOpenFile }: {
  run: RecipeRun; selected: string[]; pending: boolean; readOnly?: boolean;
  onSelect: (ids: string[]) => void; onAdopt: () => void; onOpenFile: (path: string) => void;
}) {
  const { locale } = useI18n();
  const copy = studioCopy(locale);
  const [enlarged, setEnlarged] = useState<RecipeCandidate | null>(null);
  const dialogId = useId();
  useStudioDialogFocus(dialogId, !!enlarged);
  const adopted = run.candidates.flatMap(candidate => candidate.adoptedPaths ?? []);
  return <section className={styles.results} aria-label={copy.candidates}>
    <h3>{copy.candidates}</h3>
    <p role="status">{copy.statuses[run.status]}</p>
    {run.error && <div role="alert" className={styles.error}><RecipeFailure error={run.error} errorCode={run.errorCode} errorReason={run.errorReason} /></div>}
    <div className={styles.candidateGrid}>
      {run.candidates.map(candidate => {
        const label = `${copy.candidate} ${candidate.index + 1}`;
        return <article key={candidate.id} className={styles.candidate} data-failed={candidate.checks.some(check => !check.ok) || !!candidate.error}>
          <label className={styles.candidateSelect}><Input type="checkbox" checked={selected.includes(candidate.id)}
            disabled={readOnly || pending || run.status !== 'ready' || !!candidate.error || !candidate.stagedFiles.length || !!candidate.adoptedPaths?.length}
            onChange={event => onSelect(event.target.checked ? [...selected, candidate.id] : selected.filter(id => id !== candidate.id))} />{label}</label>
          {candidate.stagedFiles[0] && <>
            <CandidateMedia file={candidate.stagedFiles[0]} url={stagedFileUrl(run, candidate, 0)} label={label} />
            <Button size="sm" variant="ghost" onClick={() => setEnlarged(candidate)} aria-label={`${copy.enlarge} ${label}`}>{copy.enlarge}</Button>
          </>}
          <Checks candidate={candidate} />
        </article>;
      })}
    </div>
    <Button variant="primary" size="sm" onClick={onAdopt} disabled={readOnly || pending || !selected.length || run.status !== 'ready'}>{copy.adopt}</Button>
    {adopted.length > 0 && <div role="status"><h3>{copy.adopted}</h3><ul className={styles.paths}>
      {adopted.map(path => <li key={path}><Button size="sm" variant="ghost" onClick={() => onOpenFile(path)}>{path}</Button></li>)}
    </ul></div>}
    {enlarged && <Dialog id={dialogId} onClose={() => setEnlarged(null)} closeOnEscape ariaLabel={`${copy.candidate} ${enlarged.index + 1}`} className={styles.previewDialog}>
      <DialogTitle>{copy.candidate} {enlarged.index + 1}</DialogTitle>
      <DialogBody>{enlarged.stagedFiles.map((file, index) => <figure key={file.ref} className={styles.previewFile}>
        <CandidateMedia file={file} url={stagedFileUrl(run, enlarged, index)} label={`${copy.candidate} ${enlarged.index + 1} · ${index + 1}`} />
        <figcaption>{file.ref.split(/[\\/]/).at(-1)}</figcaption>
      </figure>)}<Checks candidate={enlarged} /></DialogBody>
      <DialogFooter><Button onClick={() => setEnlarged(null)}>{copy.close}</Button></DialogFooter>
    </Dialog>}
  </section>;
}
