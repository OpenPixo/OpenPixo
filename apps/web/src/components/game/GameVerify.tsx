import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@openpixo/components';
import type { GameVerifyRequest, GameVerifyResult, GameVerifyStep } from '@openpixo/contracts';

import { useT } from '../../i18n';
import { notifyStarterFactsChanged } from '../project-start/events';
import styles from './GameVerify.module.css';
import { GameFailure } from './GameFailure';
import { gameRequestError, readGameResponse } from './GameRun.errors';
import { GameStepPill, GameSummaryRow, stepStatus } from './GameSummaryRow';

export function StepLog({ step, url, headers }: { step: GameVerifyStep; url: string; headers: Record<string, string> }) {
  const t = useT();
  const [log, setLog] = useState<string | null>(null);
  const [error, setError] = useState(false);
  return <details className={styles.step} onToggle={event => {
    if (!event.currentTarget.open || log !== null) return;
    void fetch(url, { headers }).then(async response => {
      if (!response.ok) throw new Error();
      setLog(await response.text());
    }).catch(() => setError(true));
  }}>
    <summary><strong>{t(`gameVerify.step.${step.name}`)}</strong><span>{t(`gameVerify.status.${stepStatus(step)}`)}</span></summary>
    <p>{t('gameVerify.stepDetails', { code: step.exitCode ?? '—', ms: step.durationMs })}{step.timedOut ? ` · ${t('gameVerify.timedOut')}` : ''}</p>
    {step.message && step.reasonCode !== 'SCREENSHOT_HOST_UNAVAILABLE' ? <GameFailure context="verify" failure={{ code: step.reasonCode, detail: step.message }} fallback={step.status === 'failed' ? 'gameVerify.stepFailedHint' : 'gameVerify.stepUnavailableHint'} /> : null}
    {step.argv.length ? <code className={styles.command}>{step.argv.join(' ')}</code> : null}
    <pre aria-label={t('gameVerify.log')}>{error ? t('gameVerify.loadFailed') : log ?? t('gameVerify.loading')}</pre>
  </details>;
}

export function Screenshot({ url, headers, index }: { url: string; headers: Record<string, string>; index: number }) {
  const t = useT();
  const [src, setSrc] = useState('');
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = '';
    void fetch(url, { headers, signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error();
      const blob = await response.blob();
      if (!controller.signal.aborted) { objectUrl = URL.createObjectURL(blob); setSrc(objectUrl); }
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [url, headers]);
  return src ? <a href={src} target="_blank" rel="noreferrer"><img src={src} alt={t('gameVerify.screenshot', { n: index + 1 })} /></a>
    : <p>{t(error ? 'gameVerify.loadFailed' : 'gameVerify.loading')}</p>;
}

export type GameVerifyController = ReturnType<typeof useGameVerify>;

/**
 * Verification for the 游戏 view (specs/current/openpixo-game-panel.md §4):
 * `POST /game/verify` as before, plus `GET /game/verify/latest` once so the
 * view can show the last result (and its screenshot) the CLI or an earlier
 * session recorded. `completedAt` is known only for results produced here:
 * the stored result carries no timestamp.
 */
export function useGameVerify({ projectId, enabled = true, startRequest = 0 }: {
  projectId: string; enabled?: boolean; startRequest?: number;
}) {
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<{ result: GameVerifyResult; completedAt?: number; fresh: boolean } | null>(null);
  const [error, setError] = useState<ReturnType<typeof gameRequestError> | null>(null);
  const consumedStartRequest = useRef(0);
  const ranRef = useRef(false);
  const headers = useMemo<Record<string, string>>(() => ({}), []);
  const base = `/api/projects/${encodeURIComponent(projectId)}/game/verify`;
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void fetch(`${base}/latest`, { signal: controller.signal })
      .then(response => readGameResponse<GameVerifyResult | null>(response))
      .then(latest => {
        if (controller.signal.aborted || ranRef.current || !latest || !Array.isArray(latest.steps)) return;
        setState({ result: { ...latest, screenshots: latest.screenshots ?? [], missingTools: latest.missingTools ?? [] }, fresh: false });
      })
      .catch(() => { /* No stored result to show; the view stays on its empty state. */ });
    return () => controller.abort();
  }, [base, enabled]);
  const verify = async (screenshot = false) => {
    if (!enabled) return;
    ranRef.current = true;
    setBusy(true); setError(null);
    try {
      const input: GameVerifyRequest = screenshot ? { steps: ['check', 'build', 'run'], screenshot: true } : {};
      const response = await fetch(base, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
      setState({ result: await readGameResponse<GameVerifyResult>(response), completedAt: Date.now(), fresh: true });
      notifyStarterFactsChanged(projectId);
    } catch (cause) { setError(gameRequestError(cause)); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    if (!startRequest || startRequest === consumedStartRequest.current || !enabled) return;
    consumedStartRequest.current = startRequest;
    if (!busy) void verify();
  });
  return { enabled, busy, error, result: state?.result ?? null, completedAt: state?.completedAt, fresh: state?.fresh ?? false, verify, base, headers };
}

/**
 * Inline under the toolbar: why verification could not finish or what to
 * install. Only for a request made in this view; a stored result explains
 * itself in its summary row.
 */
export function GameVerifyNotice({ verify, onOpenSettings }: { verify: GameVerifyController; onOpenSettings?: () => void }) {
  const t = useT();
  const { error, result, fresh, busy } = verify;
  if (busy) return null;
  const hostUnavailable = fresh && result?.steps.some(step => step.reasonCode === 'SCREENSHOT_HOST_UNAVAILABLE');
  const missing = fresh && result && result.missingTools.length > 0 ? result : null;
  if (!error && !hostUnavailable && !missing) return null;
  return <section className={styles.notice} data-tone={error ? 'danger' : undefined} data-testid="game-verify-notice" aria-label={t('gameVerify.title')}>
    {error ? <GameFailure context="verify" failure={error} fallback="gameVerify.failedRequest" alert /> : null}
    {hostUnavailable ? <div>
      <p>{t('gameVerify.screenshotHostUnavailable')}</p>
      {result?.steps.some(step => step.name === 'build' && step.status === 'passed') ? <p>{t('gameVerify.buildPassed')}</p> : null}
    </div> : null}
    {missing ? <div className={styles.missing}>
      <p>{t('gameVerify.missingTools', { tools: missing.missingTools.join(', ') })}</p>
      {missing.missingToolGuidance?.map(guidance => <div key={guidance.tool}>
        <p>{t('gameVerify.toolUnavailable', { name: guidance.name, tool: guidance.tool })}</p>
        {guidance.installUrl ? <a href={guidance.installUrl} target="_blank" rel="noreferrer">{t('gameVerify.downloadTool', { name: guidance.name })}</a> : null}
        <p className={styles.muted}>{t(guidance.configuration === 'engine-settings' ? 'gameVerify.enginePathHint' : 'gameVerify.pathHint')}</p>
      </div>)}
      {onOpenSettings && (!missing.missingToolGuidance?.length || missing.missingToolGuidance.some(guidance => guidance.configuration === 'engine-settings'))
        ? <Button size="sm" variant="secondary" onClick={onOpenSettings}>{t('gameEngine.configure')}</Button> : null}
    </div> : null}
  </section>;
}

/** 上次验证: step pills and time; expands to the step logs and screenshots. */
export function GameVerifySummary({ verify, disabled, now }: { verify: GameVerifyController; disabled?: boolean; now: number }) {
  const t = useT();
  const { result, busy, completedAt, fresh, base, headers } = verify;
  const [expanded, setExpanded] = useState(false);
  // A failed or incomplete check run here opens on its details.
  const shown = useRef<GameVerifyResult | null>(null);
  useEffect(() => {
    if (!result || shown.current === result) return;
    shown.current = result;
    if (fresh && result.status !== 'passed') setExpanded(true);
  }, [result, fresh]);
  if (!result) return null;
  return <GameSummaryRow
    label={t('panel.game.lastVerify')}
    status={result.status}
    completedAt={completedAt}
    now={now}
    expanded={expanded}
    onToggle={() => setExpanded(open => !open)}
    testId="game-verify-summary"
    busy={busy}
    meta={result.steps.map(step => <GameStepPill key={step.logRef} status={stepStatus(step)} label={t(`gameVerify.step.${step.name}`)} />)}
  >
    <div className={styles.body} aria-busy={busy}>
      {result.steps.map(step => <StepLog key={step.logRef} step={step} url={`${base}/${step.logRef}`} headers={headers} />)}
      {result.screenshots.length ? <div className={styles.screenshots}>{result.screenshots.map((shot, index) =>
        <Screenshot key={shot.ref} index={index} url={`${base}/${shot.ref}`} headers={headers} />)}</div> : null}
      <div className={styles.actions}>
        <Button size="sm" variant="secondary" disabled={busy || disabled} onClick={() => void verify.verify()}>{t('gameVerify.verify')}</Button>
        <Button size="sm" variant="secondary" disabled={busy || disabled} onClick={() => void verify.verify(true)}>{t('gameVerify.capture')}</Button>
      </div>
    </div>
  </GameSummaryRow>;
}
