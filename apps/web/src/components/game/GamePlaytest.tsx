import { useEffect, useId, useRef, useState } from 'react';
import { Button, Input, Tag, Textarea } from '@openpixo/components';
import { isGamePlaytestSeed, parseGamePlaytestRequest, type GamePlaytestPresetId, type GamePlaytestResult } from '@openpixo/contracts';
import { useT } from '../../i18n';
import { GAME_PLAYTEST_PRESETS, PLAYTEST_INPUT_COPY, PLAYTEST_PRESET_COPY, gamePlaytestPreset, gamePlaytestPresetInfo,
  randomGamePlaytestSeed } from './playtest-presets';
import { GameFailure } from './GameFailure';
import { gameRequestError, readGameResponse } from './GameRun.errors';
import { GameSummaryRow } from './GameSummaryRow';
import styles from './GamePlaytest.module.css';

const STATUS_KEYS = { passed: 'gameVerify.status.passed', failed: 'gameVerify.status.failed', unavailable: 'gameVerify.status.unavailable' } as const;

/** Which preset (and seed) produced the script in the editor. Editing the script by hand clears it,
 * so the request never claims a provenance the daemon would reject or a report would misstate. */
type PlaytestSource = { preset: GamePlaytestPresetId; seed?: number };
interface PlaytestDraft { script: string; duration: string; source: PlaytestSource | null }

export type GamePlaytestController = ReturnType<typeof useGamePlaytest>;

/**
 * Playtest state for the 游戏 view (specs/current/openpixo-game-panel.md §4).
 * The editor (a sheet), the 试玩 ▾ presets and the report's replay all share
 * this draft, so the editor always shows what ran last. Same
 * `POST /game/playtest` request as the former dialog.
 */
export function useGamePlaytest({ projectId, enabled = true }: { projectId: string; enabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [script, setScript] = useState('[]'), [duration, setDuration] = useState('5');
  const [source, setSource] = useState<PlaytestSource | null>({ preset: 'observe' });
  const [seed, setSeed] = useState(() => randomGamePlaytestSeed()), [seedText, setSeedText] = useState(() => String(seed));
  const [copied, setCopied] = useState<'form' | 'result' | null>(null);
  const copiedTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);
  const [invalid, setInvalid] = useState(false);
  const [error, setError] = useState<ReturnType<typeof gameRequestError> | null>(null);
  const [state, setState] = useState<{ result: GamePlaytestResult; completedAt: number } | null>(null);
  const [selected, setSelected] = useState(0);
  const artifactBase = '/api/projects/' + encodeURIComponent(projectId) + '/game/verify/';
  const seeded = source ? gamePlaytestPresetInfo(source.preset).seeded : false;
  const seedValid = /^\d{1,10}$/.test(seedText) && isGamePlaytestSeed(Number(seedText));

  /** Expand a preset into the editor exactly as `pixo game playtest --preset` would. */
  const applyPreset = (preset: GamePlaytestPresetId, presetSeed = seed): PlaytestDraft => {
    const info = gamePlaytestPresetInfo(preset);
    const value = gamePlaytestPreset(preset, info.seeded ? { seed: presetSeed } : {});
    const draft: PlaytestDraft = { script: JSON.stringify(value.script, null, 2), duration: String(value.durationMs / 1000),
      source: info.seeded ? { preset, seed: presetSeed } : { preset } };
    if (info.seeded) { setSeed(presetSeed); setSeedText(String(presetSeed)); }
    setScript(draft.script); setDuration(draft.duration); setSource(draft.source); setInvalid(false);
    return draft;
  };
  const changeSeed = (text: string) => {
    setSeedText(text);
    if (!/^\d{1,10}$/.test(text) || !isGamePlaytestSeed(Number(text))) return;
    if (source && seeded) applyPreset(source.preset, Number(text)); else setSeed(Number(text));
  };
  const copySeed = async (value: number, where: 'form' | 'result') => {
    try {
      await navigator.clipboard.writeText(String(value));
      setCopied(where); window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(null), 1600);
    } catch { /* Clipboard permission denied: the seed stays visible to copy by hand. */ }
  };
  /** Validates the draft; false when it cannot be sent (the editor then explains why). */
  const run = async (draft: PlaytestDraft): Promise<boolean> => {
    if (!enabled || busy) return false;
    setInvalid(false); setError(null);
    let request;
    try {
      request = parseGamePlaytestRequest({ script: JSON.parse(draft.script), durationMs: Number(draft.duration) * 1000, ...draft.source });
    } catch { setInvalid(true); return false; }
    setBusy(true);
    void (async () => {
      try {
        const response = await fetch('/api/projects/' + encodeURIComponent(projectId) + '/game/playtest', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
        });
        const value = await readGameResponse<GamePlaytestResult>(response);
        if (!value.playtest) throw new Error();
        setState({ result: value, completedAt: Date.now() });
        // The first frame is often taken before the game's first paint; open on the final state.
        setSelected(Math.max(0, value.playtest.frames.length - 1));
      } catch (cause) { setError(gameRequestError(cause)); }
      finally { setBusy(false); }
    })();
    return true;
  };
  /** 试玩 ▾ preset: a seeded preset gets a fresh seed, recorded in the report for replay. */
  const runPreset = (preset: GamePlaytestPresetId) => run(applyPreset(preset, randomGamePlaytestSeed()));
  const runDraft = () => run({ script, duration, source });
  return {
    enabled, busy, script, setScript, duration, setDuration, source, setSource, seed, seedText, seeded, seedValid, copied,
    invalid, error, result: state?.result ?? null, completedAt: state?.completedAt, selected, setSelected, artifactBase,
    applyPreset, changeSeed, copySeed, run, runPreset, runDraft,
  };
}

function CopiedStatus({ playtest, where }: { playtest: GamePlaytestController; where: 'form' | 'result' }) {
  const t = useT();
  // Kept mounted so the confirmation can fade out instead of vanishing on unmount.
  return <span role="status" className={styles.copied + (playtest.copied === where ? ' ' + styles.copiedActive : '')}>
    {playtest.copied === where ? t('gamePlaytest.seedCopied') : ''}</span>;
}

/** The script editor, shown in a sheet from 试玩 ▾. `onStarted` fires once a valid run was sent. */
export function GamePlaytestEditor({ playtest, disabled, onStarted }: {
  playtest: GamePlaytestController; disabled?: boolean; onStarted?: () => void;
}) {
  const t = useT(), id = useId();
  const { busy, source, seeded, seedValid, seedText, seed } = playtest;
  return <div className={styles.editor}>
    <div className={styles.form}>
      <fieldset className={styles.picker} disabled={busy}>
        <legend className={styles.legend}>{t('gamePlaytest.presets')}</legend>
        <p className={styles.hint}>{t('gamePlaytest.presetsHint')}</p>
        <div className={styles.presetGrid}>
          {GAME_PLAYTEST_PRESETS.map(info => {
            const copy = PLAYTEST_PRESET_COPY[info.id], base = id + '-' + info.id;
            return <label key={info.id} className={styles.preset}>
              <input type="radio" name={id + '-preset'} className={styles.radio} checked={source?.preset === info.id}
                aria-labelledby={base + '-name'} aria-describedby={base + '-purpose'} onChange={() => playtest.applyPreset(info.id)} />
              <span id={base + '-name'} className={styles.presetName}>{t(copy.name)}</span>
              <span id={base + '-purpose'} className={styles.presetPurpose}>{t(copy.purpose)}</span>
              <span className={styles.presetMeta}>
                <Tag>{t(PLAYTEST_INPUT_COPY[info.input])}</Tag>
                <Tag>{t('gamePlaytest.presetSeconds', { s: info.durationMs / 1000 })}</Tag>
                {info.seeded ? <Tag>{t('gamePlaytest.seeded')}</Tag> : null}
              </span>
            </label>;
          })}
        </div>
      </fieldset>
      <div className={`${styles.seedDisclosure} accordion-collapsible${seeded ? ' open' : ''}`} aria-hidden={!seeded}>
        <div className="accordion-collapsible-inner">
          <div className={styles.seedRow}>
            <label htmlFor={id + '-seed'}>{t('gamePlaytest.seed')}
              <Input id={id + '-seed'} inputMode="numeric" value={seedText} disabled={busy || !seeded} spellCheck={false}
                aria-invalid={!seedValid} aria-describedby={id + '-seed-hint'} onChange={event => playtest.changeSeed(event.target.value)} />
            </label>
            <Button size="sm" variant="secondary" disabled={busy || !seeded}
              onClick={() => { if (source) playtest.applyPreset(source.preset, randomGamePlaytestSeed()); }}>{t('gamePlaytest.newSeed')}</Button>
            <Button size="sm" variant="secondary" disabled={!seeded || !seedValid} onClick={() => void playtest.copySeed(seed, 'form')}>{t('gamePlaytest.copySeed')}</Button>
            <CopiedStatus playtest={playtest} where="form" />
          </div>
          <p id={id + '-seed-hint'} className={styles.hint}>{seedValid ? t('gamePlaytest.seedHint') : t('gamePlaytest.seedInvalid')}</p>
        </div>
      </div>
      <details className={styles.advanced}>
        <summary>{t('gamePlaytest.advanced')}</summary>
        <label className={styles.script} htmlFor={id + '-script'}>{t('gamePlaytest.script')}
          <Textarea id={id + '-script'} value={playtest.script} rows={5} maxLength={32768} disabled={busy} spellCheck={false}
            aria-describedby={id + '-hint'} onChange={event => { playtest.setScript(event.target.value); playtest.setSource(null); }} />
        </label>
        <p id={id + '-hint'} className={styles.hint}>{t('gamePlaytest.scriptHint')}</p>
      </details>
      <label htmlFor={id + '-duration'}>{t('gamePlaytest.duration')}
        <Input id={id + '-duration'} type="number" min="0.1" max="30" step="0.1" value={playtest.duration} disabled={busy}
          onChange={event => playtest.setDuration(event.target.value)} />
      </label>
    </div>
    {playtest.invalid ? <p role="alert" className={styles.alert}>{t('gamePlaytest.invalid')}</p> : null}
    <div className={styles.footer}>
      <Button size="sm" variant="primary" disabled={busy || disabled || (seeded && !seedValid)}
        onClick={() => { void playtest.runDraft().then(sent => { if (sent) onStarted?.(); }); }}>{t('gamePlaytest.start')}</Button>
    </div>
  </div>;
}

/** Inline under the toolbar: a playtest request that could not finish, or what is missing. */
export function GamePlaytestNotice({ playtest, onOpenSettings }: { playtest: GamePlaytestController; onOpenSettings?: () => void }) {
  const t = useT();
  const { error, result, busy } = playtest;
  if (busy) return null;
  const report = result?.playtest;
  const missing = result && result.missingTools.length ? result : null;
  if (!error && !report?.reasonCode && !missing) return null;
  return <section className={styles.notice} data-tone={error ? 'danger' : undefined} data-testid="game-playtest-notice" aria-label={t('gamePlaytest.title')}>
    {error ? <GameFailure context="playtest" failure={error} fallback="gamePlaytest.requestFailed" alert /> : null}
    {result && report?.reasonCode ? <GameFailure context="playtest" failure={{ code: report.reasonCode,
      detail: result.steps.map(step => step.message).filter(Boolean).join('\n') }} fallback="gamePlaytest.requestFailed" /> : null}
    {missing ? <div className={styles.missing}>
      <p>{t('gameVerify.missingTools', { tools: missing.missingTools.join(', ') })}</p>
      {missing.missingToolGuidance?.map(tool => <p key={tool.tool}>
        {t('gameVerify.toolUnavailable', { name: tool.name, tool: tool.tool })}{' '}
        {tool.installUrl ? <a href={tool.installUrl} target="_blank" rel="noreferrer">{t('gameVerify.downloadTool', { name: tool.name })}</a> : null}
      </p>)}
      {onOpenSettings ? <Button size="sm" variant="secondary" onClick={onOpenSettings}>{t('gameEngine.configure')}</Button> : null}
    </div> : null}
  </section>;
}

/** 上次试玩: preset · seed · outcome · frames; expands to the frames, fps and console. */
export function GamePlaytestSummary({ playtest, disabled, now }: { playtest: GamePlaytestController; disabled?: boolean; now: number }) {
  const t = useT();
  const { result, busy, selected, artifactBase } = playtest;
  const [expanded, setExpanded] = useState(false);
  const shown = useRef<GamePlaytestResult | null>(null);
  useEffect(() => {
    if (!result || shown.current === result) return;
    shown.current = result;
    setExpanded(true);
  }, [result]);
  const report = result?.playtest;
  if (!result || !report) return null;
  const frame = report.frames[selected];
  const reportSeed = report.preset !== undefined && report.seed !== undefined ? { preset: report.preset, seed: report.seed } : null;
  const meta = [
    report.preset ? t(PLAYTEST_PRESET_COPY[report.preset].name) : null,
    report.seed !== undefined ? t('gamePlaytest.resultSeed', { seed: report.seed }) : null,
    t('panel.game.frameCount', { n: report.frames.length }),
  ].filter(Boolean).join(' · ');
  return <GameSummaryRow label={t('panel.game.lastPlaytest')} status={result.status} meta={<span className={styles.metaText}>{meta}</span>}
    completedAt={playtest.completedAt} now={now} expanded={expanded} busy={busy} onToggle={() => setExpanded(open => !open)} testId="game-playtest-summary">
    <section className={styles.result} aria-busy={busy}>
      <p role="status"><strong>{t(STATUS_KEYS[result.status])}</strong>
        {' · '}{t('gamePlaytest.durationResult', { ms: Math.round(report.durationMs) })}</p>
      {report.preset ? <div className={styles.provenance}>
        <span>{t('gamePlaytest.resultPreset', { name: t(PLAYTEST_PRESET_COPY[report.preset].name) })}</span>
        {reportSeed ? <>
          <code className={styles.seedValue}>{t('gamePlaytest.resultSeed', { seed: reportSeed.seed })}</code>
          <Button size="sm" variant="secondary" onClick={() => void playtest.copySeed(reportSeed.seed, 'result')}>{t('gamePlaytest.copySeed')}</Button>
          <CopiedStatus playtest={playtest} where="result" />
          <Button size="sm" variant="secondary" disabled={busy || disabled}
            onClick={() => void playtest.run(playtest.applyPreset(reportSeed.preset, reportSeed.seed))}>{t('gamePlaytest.replaySeed')}</Button>
        </> : null}
      </div> : null}
      {result.status === 'failed' ? <p>{t('gamePlaytest.failedHint')}</p> : null}
      <p>{t('gamePlaytest.consoleSummary', { errors: report.console.filter(message => message.level === 'error').length,
        warnings: report.console.filter(message => message.level === 'warning').length })}</p>
      {report.frames.length ? <>
        <h3>{t('gamePlaytest.frames', { n: report.frames.length })}</h3>
        {frame ? <a href={artifactBase + frame.ref} target="_blank" rel="noreferrer">
          <img className={styles.preview} src={artifactBase + frame.ref} alt={t('gamePlaytest.frame', { n: selected + 1 })} />
        </a> : null}
        <div className={styles.frames} role="group" aria-label={t('gamePlaytest.filmstrip')}>{report.frames.map((shot, i) => <Button key={shot.ref} size="sm" variant="secondary"
          className={styles.thumb} aria-pressed={selected === i} onClick={() => playtest.setSelected(i)}>
          <img src={artifactBase + shot.ref} alt={t('gamePlaytest.frame', { n: i + 1 })} />
          <span>{shot.label ?? Math.round(shot.atMs) + ' ms'}</span>
        </Button>)}</div>
      </> : null}
      {report.fps ? <p>{t('gamePlaytest.fps', { avg: report.fps.avg.toFixed(1), min: report.fps.min.toFixed(1), n: report.fps.samples })}</p>
        : report.completed ? <p>{t('gamePlaytest.fpsUnavailable')}</p> : null}
      {report.frames.length && !report.inputSupported ? <p>{t('gamePlaytest.movieHint')}</p> : null}
      <h3>{t('gamePlaytest.errors')}</h3>
      {report.pageErrors.length ? <pre className={styles.log}>{report.pageErrors.join('\n')}</pre> : <p>{t('gamePlaytest.noErrors')}</p>}
      <h3>{t('gamePlaytest.console')}</h3>
      <pre className={styles.log}>{report.console.map(message => message.level + ': ' + message.text).join('\n') || t('gamePlaytest.noConsole')}</pre>
      {result.steps.filter(step => step.logRef).map(step => <a key={step.logRef} href={artifactBase + step.logRef} target="_blank" rel="noreferrer">{t('gameVerify.log')}</a>)}
    </section>
  </GameSummaryRow>;
}
