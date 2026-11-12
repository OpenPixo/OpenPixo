import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Button } from '@openpixo/components';
import { LoaderCircle } from 'lucide-react';
import { useT } from '../../i18n';
import { Icon } from '../Icon';
import { GameRunButton, GameRunNotice, useGameRunController } from '../game/GameRun';
import { GameVerifyNotice, GameVerifySummary, useGameVerify } from '../game/GameVerify';
import { GamePlaytestEditor, GamePlaytestNotice, GamePlaytestSummary, useGamePlaytest } from '../game/GamePlaytest';
import { GameStage, gameStageContent, type GameStageShot } from '../game/GameStage';
import { ShareButton, ShareDialog, useShareAvailable } from '../game/ShareDialog';
import { GameToolbarMenu, type GameToolbarMenuItem } from '../game/GameToolbarMenu';
import { GAME_PLAYTEST_PRESETS, PLAYTEST_PRESET_COPY } from '../game/playtest-presets';
import { listGameTuning } from '../tuning/tuning-api';
import { TuningPanel } from '../tuning/TuningPanel';
import { PanelSheet } from './PanelSheet';
import { GAME_SPLIT_PROPERTY, GameSplitHandle } from './GameSplitHandle';
import { clampGameSplit, GAME_SPLIT_DEFAULT, readGameSplit, writeGameSplit } from './game-split';
import toolbar from './ViewToolbar.module.css';
import styles from './GameView.module.css';

/** What ProjectView tells the 游戏 view about the project's game controls. */
export interface GameViewControls {
  /** False hides Verify and Playtest; every project has a folder they can read. */
  verifyAvailable: boolean;
  /** A request from the composer's slash commands: start this action (or, for a playtest, open its menu), once per nonce. */
  startRequest: { kind: 'run-game' | 'verify' | 'playtest'; nonce: number } | null;
}

/**
 * 游戏 view (specs/current/openpixo-game-panel.md §4): Run / Stop, Verify and
 * Playtest in the toolbar; their guidance inline below it; the stage; the
 * last verify and playtest; tuning and logs in disclosures. While one of those
 * is open, a divider between the stage and the bottom area sets their heights
 * (game-split.ts; remembered per viewer). The playtest script
 * editor opens as a sheet over the view; Share, for web games, opens its dialog.
 *
 * Always mounted (hidden while another view or a stack item shows), so a
 * running game keeps its iframe, polling continues and starter requests are
 * consumed whichever view is showing. Without `controls` the toolbar is
 * empty and nothing is read from the game endpoints.
 */
export function GameView({
  projectId,
  projectName,
  hidden,
  controls,
  viewerOnly,
  probeHeld,
  refreshKey,
  onOpenEngineSettings,
  onOpenAccount,
  onOpenFileAtLine,
  onRefreshFiles,
}: {
  projectId: string;
  /** Seeds the title of a game's public link. */
  projectName?: string;
  /** True while another view, or an item on this view's stack, is showing. */
  hidden: boolean;
  controls?: GameViewControls;
  viewerOnly?: boolean;
  /** The project row is not on the daemon yet: read nothing. */
  probeHeld?: boolean;
  /** Re-probe tuning when the project's files change. */
  refreshKey?: number;
  onOpenEngineSettings?: () => void;
  onOpenAccount?: () => void;
  onOpenFileAtLine: (path: string, line: number) => void;
  onRefreshFiles: () => Promise<void>;
}) {
  const t = useT();
  const held = probeHeld === true;
  const runEnabled = Boolean(controls) && !held;
  const verifyEnabled = Boolean(controls?.verifyAvailable) && !held;
  const start = controls?.startRequest ?? null;
  const run = useGameRunController({ projectId, enabled: runEnabled, startRequest: start?.kind === 'run-game' ? start.nonce : 0 });
  const verify = useGameVerify({ projectId, enabled: verifyEnabled, startRequest: start?.kind === 'verify' ? start.nonce : 0 });
  const playtest = useGamePlaytest({ projectId, enabled: verifyEnabled });
  const [editorOpen, setEditorOpen] = useState(false);
  const shareAvailable = useShareAvailable(projectId, runEnabled && !viewerOnly, refreshKey ?? 0);
  const [shareOpen, setShareOpen] = useState(false);
  const now = useClock(verify.completedAt !== undefined || playtest.completedAt !== undefined);
  const hasTuning = useHasTuningParameters(projectId, held, refreshKey ?? 0);
  const [tuningOpen, setTuningOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [stageReload, setStageReload] = useState(0);
  // The divider exists while a bottom section is open; closed, the stage takes the room the rows leave.
  const splitOpen = (hasTuning && tuningOpen) || (Boolean(run.run.logTail) && logsOpen);
  const split = useGameSplit();

  const stage = gameStageContent({
    running: run.run.status === 'running',
    liveUrl: run.url,
    shot: newestShot(verify, playtest, t),
    engine: run.run.engine,
  });
  const busy = playtest.busy || verify.busy || run.installing || run.run.status === 'starting';
  const statusText = playtest.busy ? t('gamePlaytest.running') : verify.busy ? t('gameVerify.running') : run.statusLabel;

  const playtestItems: GameToolbarMenuItem[] = [
    ...GAME_PLAYTEST_PRESETS.map((info) => ({
      id: info.id,
      label: t(PLAYTEST_PRESET_COPY[info.id].name),
      hint: t('gamePlaytest.presetSeconds', { s: info.durationMs / 1000 }),
      onSelect: () => { void playtest.runPreset(info.id); },
    })),
    { id: 'edit', label: t('panel.game.editScript'), separated: true, onSelect: () => setEditorOpen(true) },
    { id: 'capture', label: t('gameVerify.capture'), disabled: verify.busy, onSelect: () => { void verify.verify(true); } },
  ];

  return (
    <div className={toolbar.view} hidden={hidden} data-testid="panel-game-view">
      <div className={toolbar.toolbar} role="toolbar" aria-label={t('panel.game.toolbar')}>
        {runEnabled ? <GameRunButton controller={run} /> : null}
        {verifyEnabled ? (
          <>
            <Button size="sm" variant="secondary" disabled={verify.busy} data-testid="game-verify"
              onClick={() => { void verify.verify(); }}>{t('gameVerify.verify')}</Button>
            <GameToolbarMenu label={t('panel.game.playtestMenu')} trigger={t('gamePlaytest.open')} disabled={playtest.busy}
              testId="game-playtest-menu" items={playtestItems}
              openSignal={start?.kind === 'playtest' ? start.nonce : 0} />
          </>
        ) : null}
        {shareAvailable ? <ShareButton onClick={() => setShareOpen(true)} /> : null}
        <span className={toolbar.spacer} />
        <span className={styles.status} role="status" aria-live="polite" data-testid="panel-game-status">
          {busy ? <LoaderCircle size={13} aria-hidden="true" className={styles.spinner} /> : null}
          <span className={styles.statusText}>{statusText}</span>
        </span>
        {run.url ? (
          <Button size="icon" variant="ghost" className={styles.iconButton} aria-label={t('gameRun.openBrowser')} title={t('gameRun.openBrowser')}
            data-testid="panel-game-open-browser" onClick={() => { void run.openBrowser(); }}>
            <Icon name="external-link" size={15} />
          </Button>
        ) : null}
      </div>
      <div ref={split.bodyRef} className={styles.body} style={split.style}>
        <div className={styles.top}>
          {runEnabled ? <GameRunNotice controller={run} onOpenSettings={onOpenEngineSettings} /> : null}
          {verifyEnabled ? <GameVerifyNotice verify={verify} onOpenSettings={onOpenEngineSettings} /> : null}
          {verifyEnabled ? <GamePlaytestNotice playtest={playtest} onOpenSettings={onOpenEngineSettings} /> : null}
          <GameStage content={stage} onRun={runEnabled ? run.start : undefined} runDisabled={run.installing || !!run.busy} reloadKey={stageReload} />
        </div>
        {splitOpen ? (
          <GameSplitHandle host={split.bodyRef} height={split.height} available={split.available} measure={split.measure}
            onCommit={split.commit} onReset={split.reset} />
        ) : null}
        <div className={styles.bottom} data-split={splitOpen ? 'true' : undefined} data-testid="panel-game-bottom">
          {verifyEnabled ? <GameVerifySummary verify={verify} now={now} /> : null}
          {verifyEnabled ? <GamePlaytestSummary playtest={playtest} now={now} /> : null}
          {hasTuning ? (
            <Disclosure label={t('gameTuning.tab')} testId="panel-game-tuning-toggle" open={tuningOpen} onToggle={() => setTuningOpen((value) => !value)}>
              {(open) => (
                <TuningPanel
                  projectId={projectId}
                  viewerOnly={viewerOnly}
                  active={open && !hidden}
                  onRefreshFiles={onRefreshFiles}
                  onOpenFile={onOpenFileAtLine}
                  onReloadGame={() => setStageReload((value) => value + 1)}
                />
              )}
            </Disclosure>
          ) : null}
          {run.run.logTail ? (
            <Disclosure label={t('panel.game.logs')} testId="panel-game-logs-toggle" open={logsOpen} onToggle={() => setLogsOpen((value) => !value)}>
              {() => (
                <div className={styles.logs}>
                  <p className={styles.logsTitle}>{t('gameRun.logs')}</p>
                  <pre>{run.run.logTail}</pre>
                </div>
              )}
            </Disclosure>
          ) : null}
        </div>
      </div>
      {verifyEnabled ? (
        <PanelSheet open={editorOpen && !hidden} title={t('gamePlaytest.title')} onClose={() => setEditorOpen(false)} testId="panel-playtest-sheet">
          <GamePlaytestEditor playtest={playtest} onStarted={() => setEditorOpen(false)} />
        </PanelSheet>
      ) : null}
      {shareAvailable ? (
        <ShareDialog projectId={projectId} projectName={projectName} open={shareOpen} onClose={() => setShareOpen(false)} onOpenAccount={onOpenAccount} />
      ) : null}
    </div>
  );
}

/** The stage's fallback picture: the newer of the last verify screenshot and the selected playtest frame. */
function newestShot(
  verify: ReturnType<typeof useGameVerify>,
  playtest: ReturnType<typeof useGamePlaytest>,
  t: ReturnType<typeof useT>,
): GameStageShot | null {
  const verifyRef = verify.result?.screenshots.at(-1)?.ref;
  const frames = playtest.result?.playtest.frames ?? [];
  const frameIndex = Math.min(playtest.selected, frames.length - 1);
  const frame = frames.length ? frames[frameIndex] : undefined;
  // A playtest only exists for this page's session; a stored verify result has no time, so it is older.
  const playtestNewer = frame && (!verifyRef || (playtest.completedAt ?? 0) >= (verify.completedAt ?? 0));
  if (frame && playtestNewer) return { src: playtest.artifactBase + frame.ref, alt: t('gamePlaytest.frame', { n: frameIndex + 1 }), source: 'playtest' };
  if (verifyRef) return { src: `${verify.base}/${verifyRef}`, alt: t('panel.game.lastScreenshot'), source: 'verify' };
  return null;
}

/** Re-renders every 30 s while a relative time is on screen. */
function useClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

/**
 * The bottom area's height: the viewer's remembered split (or the default),
 * held inside the body as it is now. The body's size is watched, so a smaller
 * window clamps the split without forgetting what the viewer chose.
 */
function useGameSplit() {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [stored, setStored] = useState<number | null>(() => readGameSplit());
  const [available, setAvailable] = useState(0);
  const measure = useCallback(() => bodyRef.current?.clientHeight ?? 0, []);
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    setAvailable(body.clientHeight);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setAvailable(body.clientHeight));
    observer.observe(body);
    return () => observer.disconnect();
  }, []);
  const commit = useCallback((next: number) => {
    setStored(next);
    writeGameSplit(next);
  }, []);
  const reset = useCallback(() => {
    setStored(null);
    writeGameSplit(null);
  }, []);
  const height = clampGameSplit(stored ?? GAME_SPLIT_DEFAULT, available);
  const style = { [GAME_SPLIT_PROPERTY]: `${height}px` } as CSSProperties;
  return { bodyRef, height, available, measure, commit, reset, style };
}

/** A bottom-of-view disclosure (调参, 日志): content mounts on first open and stays. */
function Disclosure({ label, testId, open, onToggle, children }: {
  label: string;
  testId: string;
  open: boolean;
  onToggle: () => void;
  children: (open: boolean) => ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  const id = useId();
  if (open && !mounted) setMounted(true);
  return (
    <section className={styles.disclosure}>
      <button
        type="button"
        className={styles.disclosureToggle}
        aria-expanded={open}
        aria-controls={id}
        data-testid={testId}
        onClick={onToggle}
      >
        <Icon name="chevron-right" size={14} className={styles.chevron} />
        {label}
      </button>
      <div id={id} className={`${styles.collapsible} accordion-collapsible${open ? ' open' : ''}`} aria-hidden={!open}>
        <div className="accordion-collapsible-inner">{mounted ? children(open) : null}</div>
      </div>
    </section>
  );
}

/**
 * Whether the engine reports tunable parameters. The disclosure is absent
 * otherwise (spec §4: "no instruction page"); a failed read counts as none.
 */
function useHasTuningParameters(projectId: string, held: boolean, refreshKey: number): boolean {
  const [state, setState] = useState<{ projectId: string; has: boolean }>({ projectId, has: false });
  useEffect(() => {
    if (held) return;
    const controller = new AbortController();
    listGameTuning(projectId, controller.signal).then(
      (result) => {
        const parameters = (result as { parameters?: unknown } | null | undefined)?.parameters;
        if (!controller.signal.aborted) setState({ projectId, has: Array.isArray(parameters) && parameters.length > 0 });
      },
      () => {
        if (!controller.signal.aborted) setState({ projectId, has: false });
      },
    );
    return () => controller.abort();
  }, [projectId, held, refreshKey]);
  return state.projectId === projectId && state.has;
}
