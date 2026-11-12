import { useEffect, useId, useRef, useState } from 'react';
import { Select } from '@openpixo/components';
import { RUNTIME_CAPABILITY_MATRIX, type AgentApprovalMode, type AppConfigPrefs } from '@openpixo/contracts';
import { useT } from '../../i18n';
import { chatSeam } from '../chat/ChatRoot';
import { Icon } from '../Icon';
import { ComposerMenuPicker } from './ComposerMenuPicker';
import styles from './ApprovalModePicker.module.css';

const CONFIG_CHANGED_EVENT = 'pixo:app-config-changed';

interface Props {
  agentId: string | null | undefined;
  unsupported?: boolean;
  mode?: AgentApprovalMode;
  onChange?: (mode: AgentApprovalMode) => void;
  variant?: 'toolbar' | 'settings';
}

async function readConfig(): Promise<AppConfigPrefs> {
  const response = await fetch('/api/app-config', { cache: 'no-store' });
  if (!response.ok) throw new Error(`App config ${response.status}`);
  const data = await response.json() as { config?: AppConfigPrefs };
  if (!data.config || typeof data.config !== 'object') throw new Error('Invalid app config');
  return data.config;
}

export function ApprovalModePicker(props: Props) {
  return props.agentId ? <RuntimeApprovalModePicker key={props.agentId} {...props} agentId={props.agentId} /> : null;
}

function RuntimeApprovalModePicker({ agentId, unsupported, mode: initialMode = 'in-app', onChange, variant = 'toolbar' }: Props & { agentId: string }) {
  const t = useT();
  const id = useId();
  const known = RUNTIME_CAPABILITY_MATRIX[agentId as keyof typeof RUNTIME_CAPABILITY_MATRIX];
  const unavailable = unsupported || known?.approvals.state === 'unsupported';
  const [mode, setMode] = useState<AgentApprovalMode>(initialMode);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<'load' | 'save' | null>(null);
  const savingRef = useRef(false);
  const revision = useRef(0);
  const alive = useRef(true);
  const changeRef = useRef(onChange);
  const initialModeRef = useRef(initialMode);
  changeRef.current = onChange;
  initialModeRef.current = initialMode;

  useEffect(() => {
    if (variant !== 'settings') return;
    revision.current += 1;
    setMode(initialMode);
    setLoaded(true);
  }, [initialMode, variant]);

  useEffect(() => {
    alive.current = true;
    async function refresh() {
      if (savingRef.current || unavailable) return;
      const request = ++revision.current;
      try {
        const config = await readConfig();
        if (!alive.current || request !== revision.current || savingRef.current) return;
        const next = config.agentApprovalModes?.[agentId] ?? 'in-app';
        setMode(next);
        setLoaded(true);
        setError(null);
        if (next !== initialModeRef.current) changeRef.current?.(next);
      } catch {
        if (alive.current && request === revision.current && !savingRef.current) setError('load');
      }
    }
    void refresh();
    window.addEventListener(CONFIG_CHANGED_EVENT, refresh);
    if (variant === 'toolbar') window.addEventListener('focus', refresh);
    return () => {
      alive.current = false;
      revision.current += 1;
      window.removeEventListener(CONFIG_CHANGED_EVENT, refresh);
      if (variant === 'toolbar') window.removeEventListener('focus', refresh);
    };
  }, [agentId, unavailable, variant]);

  async function save(next: AgentApprovalMode) {
    if (savingRef.current || unavailable || !loaded) return;
    if (variant === 'settings') {
      // Keep the dialog's synchronous draft handoff and existing autosave.
      revision.current += 1;
      setMode(next);
      setError(null);
      changeRef.current?.(next);
      return;
    }
    savingRef.current = true;
    revision.current += 1;
    setSaving(true);
    setError(null);
    try {
      // Read the latest map so changing one runtime preserves the others.
      const config = await readConfig();
      const response = await fetch('/api/app-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentApprovalModes: { ...config.agentApprovalModes, [agentId]: next } }),
      });
      if (!response.ok) throw new Error(`App config ${response.status}`);
      if (alive.current) {
        setMode(next);
        changeRef.current?.(next);
      }
      window.dispatchEvent(new Event(CONFIG_CHANGED_EVENT));
    } catch {
      if (alive.current) setError('save');
    } finally {
      savingRef.current = false;
      if (alive.current) setSaving(false);
    }
  }

  const modeHint = mode === 'skip'
    ? `${t('composer.approvals.autoHint')} ${t('settings.approvalMode.skipWarning')}`
    : t('settings.approvalMode.inAppHint');
  const hint = unavailable ? t('settings.approvalMode.unsupported')
    : `${t('composer.approvals.nextTurn')} ${modeHint}`;
  const errorNote = error
    ? <span id={`${id}-error`} role="alert" className={styles.error}>{t(error === 'load' ? 'composer.approvals.loadFailed' : 'composer.approvals.saveFailed')}</span>
    : null;
  if (variant === 'toolbar') {
    // In the composer: the same chip-and-menu as reasoning effort, each choice
    // saying what it does, instead of a native select.
    return (
      <div {...chatSeam(styles.root)} title={hint} data-testid="approval-mode-picker">
        <ComposerMenuPicker
          label={t('composer.approvals.label')}
          hint={t('composer.approvals.nextTurn')}
          testId="approval-mode-chip"
          value={unavailable ? undefined : mode}
          onChange={(next) => void save(next === 'skip' ? 'skip' : 'in-app')}
          disabled={unavailable || !loaded || saving}
          busy={saving || (!unavailable && !loaded)}
          triggerLabel={unavailable ? t('composer.approvals.unavailable') : undefined}
          options={[
            {
              id: 'in-app',
              label: t('composer.approvals.ask'),
              description: t('settings.approvalMode.inAppHint'),
              leading: <Icon name="help-circle" size={14} />,
            },
            {
              id: 'skip',
              label: t('composer.approvals.auto'),
              description: t('settings.approvalMode.skipWarning'),
              leading: <Icon name="play" size={14} />,
            },
          ]}
        />
        {errorNote}
      </div>
    );
  }
  return (
    <div {...chatSeam(styles.settings)} title={hint} data-testid="approval-mode-picker">
      <label htmlFor={id}>{t('composer.approvals.label')}</label>
      <Select
        id={id}
        className={styles.select}
        aria-label={t('composer.approvals.label')}
        aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`}
        aria-busy={saving || (!unavailable && !loaded)}
        disabled={unavailable || !loaded || saving}
        value={unavailable ? 'unsupported' : mode}
        onChange={(event) => void save(event.target.value === 'skip' ? 'skip' : 'in-app')}
      >
        {unavailable ? <option value="unsupported">{t('composer.approvals.unavailable')}</option> : <>
          <option value="in-app">{t('composer.approvals.ask')}</option>
          <option value="skip">{t('composer.approvals.auto')}</option>
        </>}
      </Select>
      <span id={`${id}-hint`} role="note" className={styles.hint}>{hint}</span>
      {errorNote}
    </div>
  );
}
