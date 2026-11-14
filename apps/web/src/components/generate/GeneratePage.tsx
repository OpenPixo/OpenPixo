import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SegmentedTabs, Select } from '@openpixo/components';
import type { ProjectFile } from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import { fetchProjectFiles } from '../../providers/registry';
import { isCloudAccountAvailable, useOpenPixoAccount, useOpenPixoCredits } from '../../hooks/useOpenPixoAccount';
import { formatCredits } from '../account/account-format';
import { navigate } from '../../router';
import { takeGenerateHandoff } from '../studio/entry';
import { GenerateView, type GenerateSection } from './GenerateView';
import styles from './GeneratePage.module.css';
import theme from './studio-theme.module.css';

const LAST_GAME_KEY = 'pixo:generate:game';
const NO_FILES: ProjectFile[] = [];

interface PageGame { id: string; name: string; updatedAt?: number | string | undefined; createdAt?: number | string | undefined }

function storedGame(): string | null {
  try { return window.localStorage.getItem(LAST_GAME_KEY); } catch { return null; }
}
function storeGame(id: string | null) {
  try { if (id) window.localStorage.setItem(LAST_GAME_KEY, id); else window.localStorage.removeItem(LAST_GAME_KEY); } catch { /* a convenience only */ }
}
const time = (value: number | string | undefined) => typeof value === 'number' ? value : Date.parse(value ?? '') || 0;

/**
 * 生成, one page beside 工坊 (owner decision 2026-11-14): the generator for every game and
 * for none. The game picker at the top decides where references come from and which
 * game a result is saved into; with no game, results wait in history until saved into one.
 */
export function GeneratePage({ routeProjectId, games, onOpenAccount, onOpenExtensions }: {
  /** `/generate/:projectId`: the game an entry point opened 生成 for. */
  routeProjectId: string | undefined;
  games: readonly PageGame[];
  onOpenAccount: () => void;
  onOpenExtensions: () => void;
}) {
  const { t, locale } = useI18n();
  const account = useOpenPixoAccount();
  const signedIn = isCloudAccountAvailable(account.status) && Boolean(account.status?.signedIn);
  const { credits } = useOpenPixoCredits(signedIn);
  const sorted = useMemo(() => [...games].sort((a, b) => time(b.updatedAt ?? b.createdAt) - time(a.updatedAt ?? a.createdAt))
    .map(game => ({ id: game.id, name: game.name })), [games]);
  const known = useCallback((id: string | null | undefined) => Boolean(id && games.some(game => game.id === id)), [games]);
  const [picked, setPicked] = useState<string | null>(() => routeProjectId ?? storedGame());
  const projectId = picked && (known(picked) || !games.length) ? picked : null;
  const [files, setFiles] = useState<ProjectFile[]>(NO_FILES);
  const [section, setSection] = useState<GenerateSection>('create');
  const [handoff, setHandoff] = useState<{ references: string[]; request: number; recipeId: string | null }>({ references: [], request: 0, recipeId: null });

  useEffect(() => { if (routeProjectId) setPicked(routeProjectId); }, [routeProjectId]);
  // An entry point inside the game handed over pictures or a preset with it.
  useEffect(() => {
    if (!projectId) return;
    const waiting = takeGenerateHandoff(projectId);
    if (waiting) setHandoff(previous => ({ references: waiting.references ?? [], request: previous.request + 1, recipeId: waiting.recipeId ?? null }));
  }, [projectId]);
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;
  const readFiles = useCallback(async (id: string, fresh = false) => {
    try {
      const next = await fetchProjectFiles(id, fresh ? { fresh: true, afterChange: true } : undefined);
      setFiles(current => (id === projectIdRef.current ? next : current));
    } catch (cause) { console.warn('[generate] could not read the game\'s files:', cause); }
  }, []);
  useEffect(() => {
    setFiles(NO_FILES);
    if (projectId) void readFiles(projectId);
  }, [projectId, readFiles]);

  function pick(id: string | null) {
    setPicked(id);
    storeGame(id);
    navigate({ kind: 'home', view: 'generate', ...(id ? { generateProjectId: id } : {}) }, { replace: true });
  }

  // The studio is dark in either app theme, like the media tools it is modelled on.
  return <main className={`${theme.studio} ${styles.page}`} data-theme="dark" data-testid="generate-page">
    <span className={styles.glow} aria-hidden="true" />
    {/* A bar with no ground of its own, floating over the page so the hero reaches the top. */}
    <header className={styles.header}>
      <h1 className={styles.title}>{t('generate.pageTitle')}</h1>
      <label className={styles.game}>
        <span className={styles.gameLabel}>{t('generate.forGame')}</span>
        <Select className={styles.gameSelect} value={projectId ?? ''} onChange={event => pick(event.target.value || null)} data-testid="generate-game">
          <option value="">{t('generate.noGame')}</option>
          {sorted.map(game => <option key={game.id} value={game.id}>{game.name}</option>)}
        </Select>
      </label>
      <SegmentedTabs className={styles.sections} label={t('generate.pageTitle')} value={section} onValueChange={value => setSection(value as GenerateSection)}
        items={[{ value: 'create', label: t('generate.tabCreate') }, { value: 'library', label: t('generate.tabLibrary') }]} />
      <div className={styles.right}>
        {credits && <button type="button" className={styles.credits} onClick={onOpenAccount} data-testid="generate-credits">
          <span className={styles.creditsDot} aria-hidden="true" />
          <span>{t('generate.balance', { count: formatCredits(credits.available, locale) })}</span>
          <span className={styles.topUp}>{t('generate.topUp')}</span>
        </button>}
      </div>
    </header>
    <GenerateView key={projectId ?? 'none'} projectId={projectId} files={files} games={sorted}
      section={section} onSection={setSection}
      initialRecipeId={handoff.recipeId} referencePaths={handoff.references} referenceRequest={handoff.request}
      onOpenFile={(id, path) => navigate({ kind: 'project', projectId: id, fileName: path })}
      onFilesChanged={id => { if (id === projectId) return readFiles(id, true); }}
      onOpenExtensions={onOpenExtensions} onOpenAccount={onOpenAccount} />
  </main>;
}
