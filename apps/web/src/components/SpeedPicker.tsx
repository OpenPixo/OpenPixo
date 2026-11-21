import { useT } from '../i18n';
import { ComposerMenuPicker } from './composer/ComposerMenuPicker';
import styles from './SpeedPicker.module.css';

/** What "no service tier" is called in the menu; the daemon passes nothing to the CLI for it. */
export const SPEED_STANDARD_ID = 'default';

export interface SpeedOption {
  id: string;
  label: string;
}

interface Props {
  /** The model's own tiers (Codex: `priority` is Fast). Regular is always offered first. */
  tiers: readonly SpeedOption[];
  /** The saved tier; anything not in `tiers` reads as Regular. */
  value: string | undefined;
  /** `undefined` means Regular: the saved tier is cleared. */
  onChange: (tier: string | undefined) => void;
}

function Bolt({ on }: { on: boolean }) {
  return (
    <svg className={styles.bolt} data-on={on} width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M6.9 1 2.5 6.8h3L4.9 11l4.6-6.1h-3.1L6.9 1Z" />
    </svg>
  );
}

/** The composer's speed chip: Regular or the model's faster tier, beside the reasoning meter. */
export function SpeedPicker({ tiers, value, onChange }: Props) {
  const t = useT();
  const selected = tiers.some((tier) => tier.id === value) ? value! : SPEED_STANDARD_ID;
  return (
    <ComposerMenuPicker
      label={t('avatar.speedLabel')}
      triggerPrefix={t('avatar.speedLabel')}
      hint={t('avatar.speedHint')}
      title={t('avatar.speedHint')}
      testId="inline-model-switcher-speed"
      value={selected}
      onChange={(id) => onChange(id === SPEED_STANDARD_ID ? undefined : id)}
      options={[
        { id: SPEED_STANDARD_ID, label: t('avatar.speedStandard'), leading: <Bolt on={false} /> },
        ...tiers.map((tier) => ({
          id: tier.id,
          label: tier.id === 'priority' ? t('avatar.speedFast') : tier.label,
          leading: <Bolt on />,
        })),
      ]}
    />
  );
}
