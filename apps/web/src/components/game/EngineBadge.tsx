import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from '@openpixo/components';
import type { EngineProfile, EngineProfileResponse } from '@openpixo/contracts';
import { useT } from '../../i18n';
import { ENGINE_NAMES } from './engine-names';

import styles from './EngineBadge.module.css';

export function EngineBadge({ projectId,  onOpenSettings }: {
  projectId: string;

  onOpenSettings: () => void;
}) {
  const t = useT();
  const [profile, setProfile] = useState<EngineProfile | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const generation = useRef(0);
  const load = useCallback(async (refresh: boolean, signal?: AbortSignal) => {
    const request = ++generation.current;
    setBusy(true);
    setError(false);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/engine${refresh ? '/refresh' : ''}`, {
        method: refresh ? 'POST' : 'GET', signal,
        headers: {},
      });
      if (!response.ok) throw new Error('Engine detection failed');
      const data = await response.json() as EngineProfileResponse;
      if (request === generation.current && !signal?.aborted) setProfile(data.profile);
    } catch {
      if (request === generation.current && !signal?.aborted) setError(true);
    } finally {
      if (request === generation.current && !signal?.aborted) setBusy(false);
    }
  }, [projectId]);
  useEffect(() => {
    const controller = new AbortController();
    setProfile(null);
    void load(false, controller.signal);
    return () => { controller.abort(); generation.current++; };
  }, [load]);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  const label = profile
    ? `${ENGINE_NAMES[profile.engine] || t('gameEngine.unknown')}${profile.engineVersion ? ` ${profile.engineVersion}` : ''} · ${t(`gameEngine.confidence.${profile.confidence}`)}`
    : t(error ? 'gameEngine.error' : 'gameEngine.detecting');
  // The header chip names the engine only; the detection confidence is in the
  // tooltip and the dialog title (specs/current/openpixo-ui-cleanup.md §3).
  const chipLabel = profile
    ? `${ENGINE_NAMES[profile.engine] || t('gameEngine.unknown')}${profile.engineVersion ? ` ${profile.engineVersion}` : ''}`
    : label;
  // Not recognised yet (an empty project, usually): the chip would only say so, and
  // engine settings stay in the panel's ⋯ menu.
  if (profile?.engine === 'unknown' || (!profile && !error)) return null;
  return <>
    <Button ref={trigger} size="sm" variant="ghost" className={`${styles.badge} pixo-tooltip`} aria-label={label}
      data-tooltip={label} data-tooltip-placement="bottom" data-engine-chip=""
      aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>{chipLabel}</Button>
    {open ? <Dialog ariaLabel={t('gameEngine.title')} onClose={close} closeOnEscape className={styles.dialog}>
      <DialogHeader><DialogTitle>{label}</DialogTitle></DialogHeader>
      <DialogBody>
        {error ? <p role="alert">{t('gameEngine.error')}</p> : null}
        {profile ? <>
          <h3>{t('gameEngine.evidence')}</h3>
          {profile.evidence.length ? <ul>{profile.evidence.map(file => <li key={file}><code>{file}</code></li>)}</ul>
            : <p>{t('gameEngine.noEvidence')}</p>}
          <h3>{t('gameEngine.tools')}</h3>
          {profile.tools.length ? <ul>{profile.tools.map(tool => <li key={tool.id}>
            <code>{tool.id}</code> · {t(tool.resolved ? 'gameEngine.resolved' : 'gameEngine.missing')}
            {tool.source ? ` (${t(`gameEngine.source.${tool.source}`)})` : ''}
          </li>)}</ul> : <p>{t('gameEngine.noTools')}</p>}
        </> : null}
      </DialogBody>
      <DialogFooter className={styles.actions}>
        {profile?.tools.some(tool => !tool.resolved) ? <Button size="sm" onClick={() => { close(); onOpenSettings(); }}>
          {t('gameEngine.configure')}</Button> : null}
        <Button size="sm" disabled={busy} onClick={() => void load(true)}>{t(busy ? 'gameEngine.detecting' : 'gameEngine.refresh')}</Button>
        <Button size="sm" autoFocus onClick={close}>{t('gameEngine.close')}</Button>
      </DialogFooter>
    </Dialog> : null}
  </>;
}
