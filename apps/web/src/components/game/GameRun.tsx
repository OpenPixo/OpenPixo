import { useEffect, useRef, useState } from 'react';
import { Button } from '@openpixo/components';
import type { GameInstallDepsResult, GameRunStatus } from '@openpixo/contracts';
import { Play, Square } from 'lucide-react';

import { useT } from '../../i18n';
import { openExternalUrl } from '../../providers/registry';
import { notifyStarterFactsChanged } from '../project-start/events';
import styles from './GameRun.module.css';
import { gameRequestError, gameRunErrorKey, readGameResponse } from './GameRun.errors';

/** While the game starts or runs, or an agent turn that may start it is in flight. */
const POLL_MS = 1_500;
/**
 * Nothing running and nobody about to run it: the user's own Run/Stop answers
 * at once, and an agent turn starting or ending, or the window coming back,
 * triggers a read, so an idle game is only re-checked as a backstop.
 */
const IDLE_POLL_MS = 15_000;
type Action = 'POST' | 'DELETE';
interface Session {
  projectId: string;
  active: boolean;
  busy: boolean;
  version: number;
  controller: AbortController;
  /** Read now and restart the timer. */
  refreshNow: () => void;
  /** Re-arm the timer for the current state (after a Run or Stop answered). */
  reschedule: () => void;
}

function pollDelay(run: GameRunStatus, watchClosely: boolean): number {
  return watchClosely || run.status === 'starting' || run.status === 'running' ? POLL_MS : IDLE_POLL_MS;
}

/** Only a credential-free loopback http(s) URL may be framed or opened. */
export function previewUrl(value?: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

const IDLE: GameRunStatus = { status: 'idle' };

function useGameRun(projectId: string, enabled: boolean, watchClosely: boolean) {
  const sessionRef = useRef<Session | null>(null);
  const watchRef = useRef(watchClosely);
  watchRef.current = watchClosely;
  const runRef = useRef<GameRunStatus>(IDLE);
  const [snapshot, setSnapshot] = useState<{
    projectId: string; run: GameRunStatus; busy: Action | null; error: boolean; requestError?: ReturnType<typeof gameRequestError>;
  }>({ projectId, run: IDLE, busy: null, error: false });
  const base = `/api/projects/${encodeURIComponent(projectId)}/game/run`;
  useEffect(() => {
    if (!enabled) { sessionRef.current = null; return; }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const session: Session = { projectId, active: true, busy: false, version: 0, controller: new AbortController(), refreshNow: () => {}, reschedule: () => {} };
    sessionRef.current = session;
    runRef.current = IDLE;
    setSnapshot({ projectId, run: IDLE, busy: null, error: false });
    const refresh = async () => {
      clearTimeout(timer);
      timer = undefined;
      if (!session.busy) {
        const version = ++session.version;
        try {
          const response = await fetch(base, { signal: session.controller.signal });
          const run = await readGameResponse<GameRunStatus>(response);
          if (session.active && version === session.version) { runRef.current = run; setSnapshot({ projectId, run, busy: null, error: false }); }
        } catch (caught) {
          if (session.active && version === session.version) setSnapshot(previous => ({ ...previous, error: true, requestError: gameRequestError(caught) }));
        }
      }
      // A newer read (refreshNow) may have armed the timer meanwhile; keep only one.
      if (session.active && timer === undefined) timer = setTimeout(() => void refresh(), pollDelay(runRef.current, watchRef.current));
    };
    session.refreshNow = () => { if (session.active) void refresh(); };
    session.reschedule = () => {
      if (!session.active) return;
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), pollDelay(runRef.current, watchRef.current));
    };
    const onVisible = () => { if (document.visibilityState !== 'hidden') session.refreshNow(); };
    document.addEventListener('visibilitychange', onVisible);
    void refresh();
    return () => {
      session.active = false; session.controller.abort(); clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [projectId, base, enabled]);
  // An agent turn starting may start the game, and one ending may have left it
  // running or stopped it: look at once either way. The first render is skipped:
  // the session's own first read covers it.
  const previousWatch = useRef(watchClosely);
  useEffect(() => {
    if (previousWatch.current === watchClosely) return;
    previousWatch.current = watchClosely;
    sessionRef.current?.refreshNow();
  }, [watchClosely]);

  const mutate = async (method: Action) => {
    const session = sessionRef.current;
    if (!session?.active || session.projectId !== projectId || session.busy) return;
    session.busy = true;
    // A GET started before this mutation cannot replace its newer result.
    const version = ++session.version;
    setSnapshot(previous => ({ projectId, run: method === 'POST' ? { status: 'starting', engine: previous.run.engine } : previous.run, busy: method, error: false }));
    try {
      const response = await fetch(base, { method, signal: session.controller.signal });
      const run = await readGameResponse<GameRunStatus>(response);
      if (session.active && version === session.version) { runRef.current = run; setSnapshot({ projectId, run, busy: null, error: false }); }
    } catch (caught) {
      if (session.active && version === session.version) setSnapshot(previous => ({ ...previous,
        run: method === 'POST' ? { status: 'failed', reasonCode: 'START_FAILED' } : previous.run, busy: null, error: true, requestError: gameRequestError(caught) }));
    } finally { session.busy = false; session.reschedule(); }
  };
  const current = snapshot.projectId === projectId && enabled
    ? snapshot
    : { run: IDLE, busy: null, error: false, requestError: undefined };
  return { ...current, mutate };
}

export type GameRunController = ReturnType<typeof useGameRunController>;

/**
 * Run state for the 游戏 view (specs/current/openpixo-game-panel.md §4): the
 * same `/game/run` polling, start/stop and `/game/install-deps` calls the Run
 * dialog used to make. `enabled` is false while the project row is not on the
 * daemon yet; nothing is read then. A new `startRequest` nonce (a starter
 * checklist "run the game") starts an inactive game once.
 * Run means run: a start that finds dependencies missing installs them once and runs.
 */
export function useGameRunController({ projectId, enabled = true, startRequest = 0, agentRunning = false }: {
  projectId: string; enabled?: boolean; startRequest?: number;
  /** An agent turn is in flight in this project; it may start or stop the game. */
  agentRunning?: boolean;
}) {
  const t = useT();
  const { run, busy, error, requestError, mutate } = useGameRun(projectId, enabled, agentRunning);
  const [openFailed, setOpenFailed] = useState(false);
  const [installation, setInstallation] = useState<GameInstallDepsResult | null>(null);
  const [installLogTail, setInstallLogTail] = useState('');
  const [installRequestError, setInstallRequestError] = useState<ReturnType<typeof gameRequestError> | null>(null);
  const installController = useRef<AbortController | null>(null);
  const autoInstallArmed = useRef(false);
  const consumedStartRequest = useRef(0);
  const previousFactStatus = useRef<{ projectId: string; status: GameRunStatus['status'] } | null>(null);
  const installing = installation?.status === 'installing';
  const active = run.status === 'starting' || run.status === 'running';
  const url = run.status === 'running' ? previewUrl(run.url) : null;

  const start = () => {
    if (installController.current || busy || !enabled) return;
    autoInstallArmed.current = true;
    setOpenFailed(false); setInstallation(null); setInstallLogTail(''); setInstallRequestError(null);
    void mutate('POST');
  };
  const stop = () => { autoInstallArmed.current = false; void mutate('DELETE'); };
  async function installDependencies(runAfter: boolean) {
    if (installController.current || busy) return;
    const controller = new AbortController(); installController.current = controller;
    setInstallRequestError(null);
    setInstallLogTail('');
    setInstallation({ status: 'installing' });
    const endpoint = `/api/projects/${encodeURIComponent(projectId)}/game/install-deps`;
    try {
      let result = await readGameResponse<GameInstallDepsResult>(await fetch(endpoint, { method: 'POST', signal: controller.signal }));
      while (result.status === 'installing') {
        if (controller.signal.aborted) return;
        if (result.logTail) setInstallLogTail(result.logTail);
        setInstallation(result);
        await new Promise<void>(resolve => window.setTimeout(resolve, 750));
        if (controller.signal.aborted) return;
        result = await readGameResponse<GameInstallDepsResult>(await fetch(endpoint, { signal: controller.signal }));
      }
      if (controller.signal.aborted) return;
      if (result.logTail) setInstallLogTail(result.logTail);
      setInstallation(result);
      if (result.status === 'installed' && runAfter) { setInstallation(null); await mutate('POST'); }
    } catch (caught) {
      if (!controller.signal.aborted) {
        const failure = gameRequestError(caught);
        setInstallRequestError(failure);
        setInstallation({ status: 'failed', reasonCode: 'INSTALL_FAILED', message: failure.detail });
      }
    } finally { if (installController.current === controller) installController.current = null; }
  }
  useEffect(() => {
    autoInstallArmed.current = false;
    setInstallation(null);
    setInstallLogTail('');
    setInstallRequestError(null);
    setOpenFailed(false);
    return () => { installController.current?.abort(); installController.current = null; };
  }, [projectId]);
  useEffect(() => {
    if (!autoInstallArmed.current || busy) return;
    if (enabled && run.reasonCode === 'DEPENDENCIES_MISSING') {
      autoInstallArmed.current = false;
      void installDependencies(true);
    } else if (!enabled || run.status !== 'starting') autoInstallArmed.current = false;
  });
  useEffect(() => {
    if (!startRequest || startRequest === consumedStartRequest.current || !enabled) return;
    consumedStartRequest.current = startRequest;
    if (run.status === 'idle' || run.status === 'exited' || run.status === 'failed') start();
  });
  useEffect(() => {
    const previous = previousFactStatus.current;
    previousFactStatus.current = { projectId, status: run.status };
    if ((previous?.projectId !== projectId || previous.status !== run.status)
      && (run.status === 'running' || run.status === 'exited')) notifyStarterFactsChanged(projectId);
  }, [projectId, run.status]);
  const openBrowser = async () => {
    if (!url) return;
    try { setOpenFailed(!await openExternalUrl(url)); } catch { setOpenFailed(true); }
  };

  const statusLabel = installing ? t('gameRun.installing')
    : installation?.status === 'installed' && !active ? t('gameRun.installed')
      : run.status === 'idle' ? ''
        : t(run.status === 'running' && run.engine === 'godot' ? 'gameRun.runningGodot' : `gameRun.status.${run.status}`);
  return {
    enabled, run, busy, error, requestError, installation, installLogTail, installRequestError, installing, active, url,
    openFailed, statusLabel, start, stop, installDependencies, openBrowser,
  };
}

/** The toolbar's one Run / Stop control. */
export function GameRunButton({ controller, disabled }: { controller: GameRunController; disabled?: boolean }) {
  const t = useT();
  const { active, busy, installing } = controller;
  if (active) {
    return <Button size="sm" variant="secondary" className={styles.button} disabled={!!busy} data-testid="game-run-stop"
      onClick={controller.stop}>
      <Square size={12} aria-hidden="true" />{t(busy === 'DELETE' ? 'gameRun.stopping' : 'gameRun.stop')}
    </Button>;
  }
  return <Button size="sm" variant="secondary" className={styles.button} disabled={disabled || installing || !!busy} data-testid="game-run-start"
    onClick={controller.start}>
    <Play size={13} aria-hidden="true" />{t('gameRun.run')}
  </Button>;
}

/**
 * What the Run dialog's body used to say, inline under the 游戏 toolbar:
 * failure reasons, dependency install, Node and tool guidance, the engine
 * settings shortcut and technical details. Renders nothing while the run is
 * healthy.
 */
export function GameRunNotice({ controller, disabled, onOpenSettings }: {
  controller: GameRunController; disabled?: boolean; onOpenSettings?: () => void;
}) {
  const t = useT();
  const { run, busy, error, requestError, installation, installLogTail, installRequestError, installing, active, openFailed } = controller;
  const dependencyInfo = installation ?? run;
  const nodeMissing = dependencyInfo.reasonCode === 'NODE_MISSING' || dependencyInfo.reasonCode === 'PACKAGE_MANAGER_MISSING';
  const needsDependencies = run.reasonCode === 'DEPENDENCIES_MISSING' && installation?.status !== 'installed' && !active && !installing;
  const logTail = installation?.logTail ?? (needsDependencies ? installLogTail : '');
  const showInstallCommand = !active && (needsDependencies || installing || installation?.status === 'failed');
  const installCommand = installation?.installCommand ?? run.installCommand;
  const detail = requestError?.detail
    ?? installation?.message
    ?? (run.message && (run.reasonCode === 'START_FAILED' || gameRunErrorKey(run.reasonCode) === 'gameRun.unknownError') ? run.message : undefined);
  const reason = run.reasonCode && !installation ? t(gameRunErrorKey(run.reasonCode)) : null;
  const guidance = run.missingToolGuidance ?? [];
  const content = error || reason || installation?.reasonCode || nodeMissing || (showInstallCommand && installCommand)
    || detail || guidance.length || openFailed || needsDependencies || logTail;
  if (!content) return null;
  const tone = !installing && (error || run.status === 'failed' || installation?.status === 'failed') ? 'danger' : undefined;
  return <section className={styles.notice} data-tone={tone} data-testid="game-run-notice" aria-label={t('gameRun.title')}>
    {error ? <p role="alert">{t(requestError?.code ? gameRunErrorKey(requestError.code) : 'gameRun.requestFailed')}</p> : null}
    {reason ? <p>{reason}</p> : null}
    {installation?.reasonCode ? <p role="alert">{t(gameRunErrorKey(installRequestError?.code ?? installation.reasonCode))}</p> : null}
    {nodeMissing ? <p>{t('gameRun.nodeGuide')}{' '}<a href="https://nodejs.org/en/download" target="_blank" rel="noreferrer">{t('gameRun.nodeDownload')}</a></p> : null}
    {!nodeMissing && showInstallCommand && installCommand ? <div className={styles.block}><p>{t('gameRun.installCommand')}</p><code className={styles.command}>{installCommand}</code></div> : null}
    {showInstallCommand && dependencyInfo.fallback ? <p>{t('gameRun.managerFallback', { manager: dependencyInfo.requestedPackageManager ?? '' })}</p> : null}
    {guidance.map(item => <div key={item.tool} className={styles.block}>
      <p>{t('gameVerify.toolUnavailable', { name: item.name, tool: item.tool })}</p>
      {item.installUrl ? <a href={item.installUrl} target="_blank" rel="noreferrer">{t('gameVerify.downloadTool', { name: item.name })}</a> : null}
      <p className={styles.muted}>{t(item.configuration === 'engine-settings' ? 'gameRun.enginePathHint' : 'gameRun.pathHint')}</p>
    </div>)}
    {openFailed ? <p role="alert">{t('gameRun.openFailed')}</p> : null}
    {needsDependencies || (guidance.some(item => item.configuration === 'engine-settings') && onOpenSettings) ? <div className={styles.actions}>
      {needsDependencies ? <>
        <Button size="sm" variant="primary" disabled={!!busy || disabled || installing} onClick={() => void controller.installDependencies(true)}>{t('gameRun.installAndRun')}</Button>
        <Button size="sm" variant="secondary" disabled={!!busy || disabled || installing} onClick={() => void controller.installDependencies(false)}>{t('gameRun.installOnly')}</Button>
      </> : null}
      {guidance.some(item => item.configuration === 'engine-settings') && onOpenSettings
        ? <Button size="sm" variant="secondary" onClick={onOpenSettings}>{t('gameEngine.configure')}</Button> : null}
    </div> : null}
    {detail ? <details className={styles.details}><summary>{t('game.errorDetails')}</summary><pre>{detail}</pre></details> : null}
    {logTail ? <details className={styles.details} open={installation?.status === 'failed' || needsDependencies}><summary>{t('gameRun.installLog')}</summary><pre>{logTail}</pre></details> : null}
  </section>;
}
