import { Input } from '@openpixo/components';
import type { GameEnginePaths } from '@openpixo/contracts';
import { useT } from '../../i18n';
import styles from './GameEnginesSettings.module.css';

export function GameEnginesSettings({ value, onChange }: {
  value: GameEnginePaths;
  onChange: (paths: GameEnginePaths) => void;
}) {
  const t = useT();
  return <section className={styles.section}>
    <p>{t('gameEngine.settingsHint')}</p>
    {(['godot', 'unity', 'cocosCreator'] as const).map(id => <label className={styles.field} key={id}>
      <span>{t(id === 'godot' ? 'gameEngine.godotPath' : id === 'unity' ? 'gameEngine.unityPath' : 'gameEngine.cocosCreatorPath')}</span>
      <Input value={value[id] ?? ''} placeholder={t('gameEngine.pathPlaceholder')}
        onChange={event => onChange({ ...value, [id]: event.target.value })} spellCheck={false} />
    </label>)}
    <p>{t('gameEngine.settingsRefreshHint')}</p>
  </section>;
}
