import { useState } from 'react';
import { Button, SegmentedTabs, Select } from '@openpixo/components';
import type { RecipeCandidate, RecipeRun, RecipeSummary } from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import { stagedFileUrl } from '../studio/CandidateGrid';
import { studioRunIsActive } from '../studio/RecipeRunner';
import { localizedRecipeCopy } from '../studio/localization';
import { runSummary } from './generate-request';
import { FadeImage, loadingFrame } from './FadeImage';
import styles from './GenerateView.module.css';

type KindFilter = 'all' | 'image' | 'audio' | 'model3d';
type OriginFilter = 'all' | 'user' | 'agent';

/** The recipe's own title in this language, or its id when the catalogue does not list it. */
export function runTitle(run: Pick<RecipeRun, 'recipeId'>, recipes: readonly RecipeSummary[] | null, locale: string): string {
  const recipe = recipes?.find(entry => entry.id === run.recipeId || `openpixo/${entry.id}` === run.recipeId);
  return recipe ? localizedRecipeCopy(recipe, locale).title : run.recipeId;
}

/** A result with no picture of its own (a sound, a model) shows its kind's cover. */
function coverOf(run: Pick<RecipeRun, 'recipeId'>, mime: string): string {
  if (!mime.startsWith('audio/')) return 'model3d';
  return /music|bgm/u.test(run.recipeId) ? 'music' : /voice/u.test(run.recipeId) ? 'voice' : 'sfx';
}

function Tile({ run, candidate, label, onOpen }: { run: RecipeRun; candidate: RecipeCandidate; label: string; onOpen: () => void }) {
  const { t } = useI18n();
  const file = candidate.stagedFiles[0];
  const saved = Boolean(candidate.adoptedPaths?.length);
  let body;
  if (candidate.error) body = <span className={styles.tileProblem}>{t('generate.candidateFailed')}</span>;
  else if (!file) body = <span className={styles.tilePending} aria-hidden="true" />;
  else if (file.mime.startsWith('image/')) body = <FadeImage src={stagedFileUrl(run, candidate, 0)} className={styles.tileImage} loading="lazy" />;
  else body = <FadeImage src={`/generate-art/${coverOf(run, file.mime)}.webp`} className={styles.tileCover} loading="lazy" />;
  return <button type="button" className={`${styles.tile} ${loadingFrame}`} onClick={onOpen} aria-label={label} data-saved={saved || undefined}
    data-testid="generate-tile">
    {body}
    {saved && <span className={styles.tileBadge}>{t('generate.saved')}</span>}
  </button>;
}

/** Runs by the day they were made, newest first: 今天, 昨天, then the date. */
function byDay(runs: readonly RecipeRun[], locale: string, today: string, yesterday: string): Array<{ key: string; label: string; runs: RecipeRun[] }> {
  const groups: Array<{ key: string; label: string; runs: RecipeRun[] }> = [];
  const now = new Date();
  const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  const todayKey = dayKey(now);
  const yesterdayKey = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  for (const run of runs) {
    const date = new Date(run.createdAt);
    const key = dayKey(date);
    let group = groups.at(-1);
    if (!group || group.key !== key) {
      const label = key === todayKey ? today : key === yesterdayKey ? yesterday
        : date.toLocaleDateString(locale, { ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }), month: 'long', day: 'numeric' });
      group = { key, label, runs: [] };
      groups.push(group);
    }
    group.runs.push(run);
  }
  return groups;
}

/**
 * 我的作品: everything made on this machine, newest first and grouped by day, for the
 * picked game or for every game and none: the user's runs and the agent's. Every result
 * is one picture card with what made it under it; a card opens its detail.
 */
export function GenerateHistory({ runs, failed, recipes, gameNames, onRetry, onOpen, onCreate }: {
  runs: RecipeRun[] | null;
  /** Shown when the history covers every game: each run then names its game, or no game. */
  gameNames?: Readonly<Record<string, string>> | undefined;
  failed: boolean;
  recipes: readonly RecipeSummary[] | null;
  onRetry: () => void;
  onOpen: (runId: string, candidateId: string) => void;
  /** Nothing made yet: back to the box. */
  onCreate: () => void;
}) {
  const { t, locale } = useI18n();
  const [kind, setKind] = useState<KindFilter>('all');
  const [origin, setOrigin] = useState<OriginFilter>('all');
  const shown = (runs ?? []).filter(run => (kind === 'all' || (run.surface ?? 'image') === kind) && (origin === 'all' || (run.origin ?? 'user') === origin));
  const total = (runs ?? []).reduce((sum, run) => sum + Math.max(1, run.candidates.length), 0);
  const days = byDay(shown, locale, t('generate.today'), t('generate.yesterday'));
  const time = (run: RecipeRun) => new Date(run.createdAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  return <section className={styles.history} aria-labelledby="generate-history-title" data-testid="generate-history">
    <header className={styles.historyHeader}>
      <div className={styles.libraryHeading}>
        <h3 id="generate-history-title" className={styles.libraryTitle}>{t('generate.tabLibrary')}</h3>
        {runs && runs.length > 0 && <span className={styles.libraryCount}>{t('generate.libraryCount', { count: total })}</span>}
      </div>
      {runs && runs.length > 0 && <div className={styles.libraryFilters}>
        <SegmentedTabs className={styles.filterTabs} label={t('generate.filterKind')} value={kind} onValueChange={value => setKind(value as KindFilter)}
          items={[{ value: 'all', label: t('generate.all') }, { value: 'image', label: t('studio.cloud.makeImage') },
            { value: 'audio', label: t('generate.audio') }, { value: 'model3d', label: t('studio.cloud.makeModel3d') }]} />
        <label className={styles.originFilter}>
          <span className={styles.originLabel}>{t('generate.filterOrigin')}</span>
          <Select className={styles.originSelect} value={origin} onChange={event => setOrigin(event.target.value as OriginFilter)} data-testid="generate-origin">
            <option value="all">{t('generate.allMakers')}</option>
            <option value="user">{t('generate.byYou')}</option>
            <option value="agent">{t('generate.byAgent')}</option>
          </Select>
        </label>
      </div>}
    </header>
    {failed && !runs ? <div className={styles.problem} role="alert"><span>{t('generate.historyFailed')}</span>
      <Button size="sm" variant="secondary" onClick={onRetry}>{t('studio.cloud.retry')}</Button></div>
      : runs && !runs.length ? <div className={styles.libraryEmpty} data-testid="generate-library-empty">
        <span className={styles.libraryEmptyArt} aria-hidden="true">
          {['image', 'sfx', 'model3d'].map(kind => <img key={kind} src={`/generate-art/${kind}.webp`} alt="" />)}</span>
        <p className={styles.libraryEmptyTitle}>{t('generate.libraryEmpty')}</p>
        <Button className={styles.libraryEmptyButton} onClick={onCreate}>{t('generate.libraryStart')}</Button>
      </div>
      : runs && !shown.length ? <p className={styles.muted}>{t('generate.historyNoMatch')}</p> : null}
    {days.map(day => <section key={day.key} className={styles.day} aria-label={day.label}>
      <h4 className={styles.dayTitle}>{day.label}</h4>
      <ol className={styles.gallery}>
        {day.runs.map(run => {
          const title = runTitle(run, recipes, locale);
          const summary = runSummary(run);
          const active = studioRunIsActive(run);
          // One run, its results as cards in the day's grid; what made them under each.
          const meta = <div className={styles.resultMeta}>
            <p className={styles.runSummary} title={summary || undefined}>{summary || title}</p>
            <div className={styles.runHeader}>
              {summary && <span className={styles.runTitle}>{title}</span>}
              {run.origin === 'agent' && <span className={styles.badge}>{t('generate.byAgent')}</span>}
              {gameNames && <span className={styles.runGame}>{run.projectId ? gameNames[run.projectId] ?? t('generate.unknownGame') : t('generate.noGame')}</span>}
              <span className={styles.runTime}>{time(run)}</span>
            </div>
            {active && <p className={styles.working} role="status">{t('studio.cloud.generating')}</p>}
            {run.status === 'failed' && run.error && <p className={styles.problemText}>{run.error}</p>}
          </div>;
          return <li key={run.id} className={styles.run} data-testid="generate-run" data-status={run.status}>
            {run.candidates.map(candidate => <div key={candidate.id} className={styles.result}>
              <Tile run={run} candidate={candidate} label={t('generate.openResult', { title, n: candidate.index + 1 })} onOpen={() => onOpen(run.id, candidate.id)} />
              {meta}
            </div>)}
            {!run.candidates.length && <div className={styles.result}>
              {active ? <span className={styles.tileWaiting} aria-hidden="true" /> : <span className={styles.tileEmpty} aria-hidden="true" />}
              {meta}
            </div>}
          </li>;
        })}
      </ol>
    </section>)}
    {runs && runs.length > 0 && <p className={styles.note}>{t('generate.historyLocal')}</p>}
  </section>;
}

/**
 * The newest results, one row under the box on the 创作 home: a glance at what was just
 * made, with the way to all of them. Nothing shows until something has been made.
 */
export function RecentRuns({ runs, recipes, onOpen, onAll, limit = 12 }: {
  runs: RecipeRun[] | null;
  recipes: readonly RecipeSummary[] | null;
  onOpen: (runId: string, candidateId: string) => void;
  onAll: () => void;
  limit?: number;
}) {
  const { t, locale } = useI18n();
  const tiles = (runs ?? []).flatMap(run => run.candidates.map(candidate => ({ run, candidate }))).slice(0, limit);
  const waiting = (runs ?? []).some(run => studioRunIsActive(run) && !run.candidates.length);
  if (!tiles.length && !waiting) return null;
  return <section className={styles.recent} aria-labelledby="generate-recent-title" data-testid="generate-recent">
    <header className={styles.sectionHeader}>
      <h3 id="generate-recent-title" className={styles.sectionTitle}>{t('generate.recentTitle')}</h3>
      <Button size="sm" variant="ghost" className={styles.sectionLink} onClick={onAll} data-testid="generate-recent-all">
        {t('generate.allWorks')} →</Button>
    </header>
    <div className={styles.recentTiles}>
      {waiting && <span className={styles.tileWaiting} aria-hidden="true" />}
      {tiles.map(({ run, candidate }) => <Tile key={candidate.id} run={run} candidate={candidate}
        label={t('generate.openResult', { title: runTitle(run, recipes, locale), n: candidate.index + 1 })} onOpen={() => onOpen(run.id, candidate.id)} />)}
    </div>
  </section>;
}
