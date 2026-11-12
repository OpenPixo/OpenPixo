import { useEffect, useId, useRef, useState } from 'react';
import { Button, Input, VisuallyHidden } from '@openpixo/components';
import type { GameTuningParameter, GameTuningValue } from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import { Icon } from '../Icon';
import styles from './TuningPanel.module.css';

function completeNumericColor(value: string): boolean {
  const match = /^Color\s*\((.*)\)$/.exec(value.trim());
  if (!match) return false;
  const parts = match[1]!.split(',').map(part => part.trim());
  return (parts.length === 3 || parts.length === 4) && parts.every(part => part !== '' && Number.isFinite(Number(part.replaceAll('_', ''))));
}

/**
 * One tunable parameter on one line: the label (truncated, full text and
 * description in its tooltip), the control, then small icon actions. The
 * default value lives in the reset button's name and tooltip, a scene
 * override in its badge's, the source location in the open-in-code link's.
 */
export function TuningParameter({ parameter: p, projectId, disabled, onChange, onOpenFile }: {
  parameter: GameTuningParameter;
  projectId: string;
  disabled: boolean;
  onChange: (value: GameTuningValue) => void;
  onOpenFile: (path: string, line: number) => void;
}) {
  const { locale, t } = useI18n(); const id = useId();
  const label = p.label_i18n?.[locale]?.trim() || p.label;
  const [draft, setDraft] = useState(String(p.value));
  const editing = useRef(false);
  useEffect(() => { if (!editing.current) setDraft(String(p.value)); }, [p.value]);
  const numeric = p.type === 'int' || p.type === 'float';
  const baseline = typeof p.defaultValue === 'number' ? p.defaultValue : 1;
  const magnitude = Math.abs(baseline) || 1;
  const min = p.min ?? (baseline < 0 ? -magnitude * 3 : 0);
  const max = p.max ?? (baseline < 0 ? 0 : magnitude * 3);
  const step = p.step ?? (p.type === 'int' ? 1 : 0.01);
  const rgba = String(p.value).replace(/^#/, '').padEnd(8, 'f');
  function numberValue(raw: string): void {
    if (!raw.trim()) return;
    const value = Number(raw);
    if (!Number.isFinite(value) || (p.type === 'int' && !Number.isSafeInteger(value))) return;
    if ((p.min !== undefined && !p.allowLess && value < p.min) || (p.max !== undefined && !p.allowGreater && value > p.max)) return;
    onChange(value);
  }
  const source = `${p.filePath}:${p.line}`;
  const descriptionId = p.description ? `${id}-description` : undefined;
  const resetLabel = t('gameTuning.resetTo', { value: String(p.defaultValue) });
  const openLabel = `${t('gameTuning.openCode')} · ${source}`;
  const sceneLabel = p.source === 'godot-scene' ? `${t('gameTuning.scene')} · ${p.nodePath}` : null;
  return <div className={styles.row} data-type={p.type}>
    <label htmlFor={id} className={styles.label} title={p.description ? `${label}\n${p.description}` : label}>{label}</label>
    <div className={styles.control}>
      {p.description ? <VisuallyHidden id={descriptionId}>{p.description}</VisuallyHidden> : null}
      {numeric ? <>
        <Input className={styles.slider} type="range" aria-label={label} aria-describedby={descriptionId}
          min={min} max={max} step={step} value={Number(p.value)} disabled={disabled} onChange={event => numberValue(event.target.value)} />
        <Input id={id} className={styles.number} type="number" aria-label={label} aria-describedby={descriptionId}
          min={p.allowLess ? undefined : p.min} max={p.allowGreater ? undefined : p.max}
          step={step} value={draft} disabled={disabled} onFocus={() => { editing.current = true; }}
          onChange={event => { setDraft(event.target.value); numberValue(event.target.value); }}
          onBlur={() => { editing.current = false; setDraft(String(p.value)); }} />
      </> : p.type === 'bool' ? <Input id={id} className={styles.toggle} type="checkbox" aria-label={label} aria-describedby={descriptionId}
        checked={Boolean(p.value)} disabled={disabled} onChange={event => onChange(event.target.checked)} />
        : p.type === 'color' && !/^#[\da-fA-F]{6}(?:[\da-fA-F]{2})?$/.test(String(p.value)) ? <Input id={id} className={styles.text}
          aria-label={label} aria-describedby={descriptionId} value={draft} disabled={disabled} onFocus={() => { editing.current = true; }}
          onChange={event => { setDraft(event.target.value); if (completeNumericColor(event.target.value)) onChange(event.target.value); }}
          onBlur={() => { editing.current = false; setDraft(String(p.value)); }} />
        : p.type === 'color' ? <>
          <Input id={id} type="color" className={styles.color} aria-label={label} aria-describedby={descriptionId}
            value={`#${rgba.slice(0, 6)}`} disabled={disabled} onChange={event => onChange(`${event.target.value}${rgba.slice(6, 8)}`)} />
          <label className={styles.alpha} title={t('gameTuning.alpha')}>
            <span className={styles.alphaLabel}>{t('gameTuning.alpha')}</span>
            <Input className={styles.number} type="number" min={0} max={255} step={1} aria-label={`${label} ${t('gameTuning.alpha')}`}
              value={Number.parseInt(rgba.slice(6, 8), 16)} disabled={disabled} onChange={event => {
                const alpha = Number(event.target.value);
                if (event.target.value && Number.isInteger(alpha) && alpha >= 0 && alpha <= 255) onChange(`#${rgba.slice(0, 6)}${alpha.toString(16).padStart(2, '0')}`);
              }} />
          </label>
          <output className={styles.live} aria-label={`${label} ${t('gameTuning.current')}`}>{String(p.value)}</output>
        </> : <Input id={id} className={styles.text} aria-label={label} aria-describedby={descriptionId}
          value={String(p.value)} disabled={disabled} onChange={event => onChange(event.target.value)} />}
    </div>
    <div className={styles.actions}>
      {sceneLabel ? <span className={styles.badge} role="img" aria-label={sceneLabel} title={sceneLabel}>
        <Icon name="layers-filled" size={13} />
      </span> : null}
      <Button size="icon" variant="ghost" className={styles.iconAction} aria-label={resetLabel} title={resetLabel}
        disabled={disabled || p.value === p.defaultValue} onClick={() => onChange(p.defaultValue)}>
        <Icon name="undo" size={14} />
      </Button>
      <a className={styles.iconAction} href={`/projects/${encodeURIComponent(projectId)}?file=${encodeURIComponent(p.filePath)}#L${p.line}`}
        aria-label={openLabel} title={openLabel}
        onClick={event => { event.preventDefault(); onOpenFile(p.filePath, p.line); }}>
        <Icon name="file-code" size={14} />
      </a>
    </div>
  </div>;
}
