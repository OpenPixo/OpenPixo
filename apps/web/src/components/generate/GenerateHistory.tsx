import { useState } from 'react';
import { Button, SegmentedTabs } from '@openpixo/components';
import type { RecipeCandidate, RecipeRun, RecipeSummary } from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import { stagedFileUrl } from '../studio/CandidateGrid';
import { studioRunIsActive } from '../studio/RecipeRunner';
import { localizedRecipeCopy } from '../studio/localization';
import { runSummary } from './generate-request';
import styles from './GenerateView.module.css';

type KindFilter = 'all' | 'image' | 'audio' | 'model3d';
type OriginFilter = 'all' | 'user' | 'agent';

/** The recipe's own title in this language, or its id when the catalogue does not list it. */
export function runTitle(run: Pick<RecipeRun, 'recipeId'>, recipes: readonly RecipeSummary[] | null, locale: string): string {
  const recipe = recipes?.find(entry => entry.id === run.recipeId || `openpixo/${entry.id}` === run.recipeId);
  return recipe ? localizedRecipeCopy(recipe, locale).title : run.recipeId;
}

function Tile({ run, candidate, label, onOpen }: { run: RecipeRun; candidate: RecipeCandidate; label: string; onOpen: () => void }) {
  const { t } = useI18n();
  const file = candidate.stagedFiles[0];
  const saved = Boolean(candidate.adoptedPaths?.length);
  let body;
  if (candidate.error) body = <span className={styles.tileProblem}>{t('generate.candidateFailed')}</span>;
  else if (!file) body = <span className={styles.tilePending} aria-hidden="true" />;
  else if (file.mime.startsWith('image/')) body = <img src={stagedFileUrl(run, candidate, 0)} alt="" className={styles.tileImage} loading="lazy" />;
  else if (file.mime.startsWith('audio/')) body = <span className={styles.tileGlyph} aria-hidden="true">♪</span>;
  else body = <span className={styles.tileGlyph} aria-hidden="true">3D</span>;
  return <button type="button" className={styles.tile} onClick={onOpen} aria-label={label} data-saved={saved || undefined}
    data-testid="generate-tile">
    {body}
    {saved && <span className={styles.tileBadge}>{t('generate.saved')}</span>}
  </button>;
}

/**
 * Everything made for this project on this machine, newest first: the user's runs
 * and the agent's, each with its results as tiles. A tile opens its detail.
 */
export function GenerateHistory({ runs, failed, recipes, onRetry, onOpen }: {
  runs: RecipeRun[] | null;
  failed: boolean;
  recipes: readonly RecipeSummary[] | null;
  onRetry: () => void;
  onOpen: (runId: string, candidateId: string) => void;
}) {
  const { t, locale } = useI18n();
  const [kind, setKind] = useState<KindFilter>('all');
  const [origin, setOrigin] = useState<OriginFilter>('all');
  const shown = (runs ?? []).filter(run => (kind === 'all' || (run.surface ?? 'image') === kind) && (origin === 'all' || (run.origin ?? 'user') === origin));
  return <section className={styles.history} aria-labelledby="generate-history-title" data-testid="generate-history">
    <header className={styles.historyHeader}>
      <h3 id="generate-history-title" className={styles.sectionTitle}>{t('generate.history')}</h3>
      <div className={styles.filters}>
        <SegmentedTabs className={styles.filterTabs} label={t('generate.filterKind')} value={kind} onValueChange={value => setKind(value as KindFilter)}
          items={[{ value: 'all', label: t('generate.all') }, { value: 'image', label: t('studio.cloud.makeImage') },
            { value: 'audio', label: t('generate.audio') }, { value: 'model3d', label: t('studio.cloud.makeModel3d') }]} />
        <SegmentedTabs className={styles.filterTabs} label={t('generate.filterOrigin')} value={origin} onValueChange={value => setOrigin(value as OriginFilter)}
          items={[{ value: 'all', label: t('generate.all') }, { value: 'user', label: t('generate.byYou') }, { value: 'agent', label: t('generate.byAgent') }]} />
      </div>
    </header>
    <p className={styles.note}>{t('generate.historyLocal')}</p>
    {failed && !runs ? <div className={styles.problem} role="alert"><span>{t('generate.historyFailed')}</span>
      <Button size="sm" variant="secondary" onClick={onRetry}>{t('studio.cloud.retry')}</Button></div>
      : runs && !shown.length ? <p className={styles.muted}>{runs.length ? t('generate.historyNoMatch') : t('generate.historyEmpty')}</p> : null}
    <ol className={styles.runs}>
      {shown.map(run => {
        const title = runTitle(run, recipes, locale);
        const summary = runSummary(run);
        return <li key={run.id} className={styles.run} data-testid="generate-run">
          <div className={styles.runHeader}>
            <span className={styles.runTitle}>{title}</span>
            {run.origin === 'agent' && <span className={styles.badge}>{t('generate.byAgent')}</span>}
            <span className={styles.runTime}>{new Date(run.createdAt).toLocaleString(locale, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          {summary && <p className={styles.runSummary}>{summary}</p>}
          {studioRunIsActive(run) && <p className={styles.muted} role="status">{t('studio.cloud.generating')}</p>}
          {run.status === 'failed' && run.error && <p className={styles.problemText}>{run.error}</p>}
          <div className={styles.tiles}>
            {run.candidates.map(candidate => <Tile key={candidate.id} run={run} candidate={candidate}
              label={t('generate.openResult', { title, n: candidate.index + 1 })} onOpen={() => onOpen(run.id, candidate.id)} />)}
          </div>
        </li>;
      })}
    </ol>
  </section>;
}
