import { CHARACTER_GEAR_TYPES, type CharacterGearType } from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import { GEAR_TYPES } from './character-text';
import styles from './Characters.module.css';

/** What kinds of weapons, and whether capes or shields. Nothing picked leaves it to the words. */
export function GearTypes({ value, disabled, onChange }: { value: readonly CharacterGearType[]; disabled: boolean; onChange: (types: CharacterGearType[]) => void }) {
  const { t } = useI18n();
  const flip = (type: CharacterGearType): void => onChange(CHARACTER_GEAR_TYPES.filter(x => x === type ? !value.includes(x) : value.includes(x)));
  return <div className={styles.types} role="group" aria-label={t('characters.types')}>
    <span>{t('characters.types')}</span>
    <button type="button" className={value.length ? styles.chip : styles.chipOn} aria-pressed={!value.length} disabled={disabled} onClick={() => onChange([])}>{t('characters.style.auto')}</button>
    {CHARACTER_GEAR_TYPES.map(type => <button key={type} type="button" className={value.includes(type) ? styles.chipOn : styles.chip} aria-pressed={value.includes(type)} disabled={disabled} onClick={() => flip(type)} data-testid={`gear-type-${type}`}>{t(GEAR_TYPES[type])}</button>)}
  </div>;
}
