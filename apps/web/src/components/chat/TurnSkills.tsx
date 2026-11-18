import { useT } from '../../i18n';
import { Icon } from '../Icon';
import { useSkillNames } from './SkillNames';
import styles from './TurnSkills.module.css';

/** 「这一轮用了 ××、××」。执行记录一轮跑完就收起,所以它在壳外;没用技能时不出现。 */
export function TurnSkills({ skillIds }: { skillIds: readonly string[] }) {
  const t = useT();
  const skillNames = useSkillNames();
  if (skillIds.length === 0) return null;
  return (
    <div className={styles.line} data-testid="turn-skills">
      <Icon name="sparkles" size={13} className={styles.icon} />
      <span>{t('chat.turnSkills.used')}</span>
      <span className={styles.names}>
        {skillNames(skillIds).join(t('chat.record.listJoin'))}
      </span>
    </div>
  );
}
