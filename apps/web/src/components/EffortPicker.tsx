import { useT } from '../i18n';
import { ComposerMenuPicker } from './composer/ComposerMenuPicker';
import { effortOptionLabel } from './modelOptions';
import styles from './EffortPicker.module.css';

export interface EffortOption {
  id: string;
  label: string;
}

interface Props {
  options: readonly EffortOption[];
  value: string | undefined;
  onChange: (id: string) => void;
}

const METER_BARS = 4;
/** How many of the meter's bars a known level fills. */
const KNOWN_LEVELS: Record<string, number> = {
  none: 0, minimal: 1, low: 1, medium: 2, high: 3, xhigh: 4, max: 4,
};

/**
 * Bars a level fills. Known ids use the shared scale; a runtime's own variant
 * names are spread over the meter by their place in the list, so the meter
 * still climbs from the first option to the last. `default` leaves the CLI to
 * decide and fills nothing.
 */
export function effortLevel(options: readonly EffortOption[], id: string | undefined): number {
  if (!id || id === 'default') return 0;
  const known = KNOWN_LEVELS[id];
  if (known !== undefined) return known;
  const ranked = options.filter((option) => option.id !== 'default');
  const index = ranked.findIndex((option) => option.id === id);
  if (index < 0) return 0;
  return ranked.length <= 1 ? METER_BARS : Math.max(1, Math.round(((index + 1) / ranked.length) * METER_BARS));
}

function EffortMeter({ level }: { level: number }) {
  return (
    <span className={styles.meter}>
      {Array.from({ length: METER_BARS }, (_, index) => (
        <span key={index} className={styles.bar} data-on={index < level} />
      ))}
    </span>
  );
}

/** The composer's reasoning control: a meter chip and a short level menu. */
export function EffortPicker({ options, value, onChange }: Props) {
  const t = useT();
  return (
    <ComposerMenuPicker
      label={t('homeModel.reasoning')}
      hint={t('homeModel.reasoningHint')}
      title={t('homeModel.reasoningHint')}
      testId="inline-model-switcher-reasoning"
      value={value}
      onChange={onChange}
      options={options.map((option) => ({
        id: option.id,
        label: effortOptionLabel(option, t),
        leading: <EffortMeter level={effortLevel(options, option.id)} />,
      }))}
    />
  );
}
