import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { localizeSkillName } from '../../i18n/content';
import { useI18n } from '../../i18n';
import type { SkillSummary } from '../../types';

const SkillNamesContext = createContext<ReadonlyMap<string, string>>(new Map());

/**
 * 技能的显示名。事件里只有 id,名字随界面语言走,所以由聊天面板从技能目录提供,
 * 不写进事件。目录里没有的(已删除的技能、面板外渲染)显示 id。
 */
export function SkillNamesProvider({ skills, children }: { skills: readonly SkillSummary[]; children: ReactNode }) {
  const { locale } = useI18n();
  const names = useMemo(
    () => new Map(skills.map((skill) => [skill.id, localizeSkillName(locale, skill)])),
    [locale, skills],
  );
  return <SkillNamesContext.Provider value={names}>{children}</SkillNamesContext.Provider>;
}

export function useSkillName(): (id: string) => string {
  const names = useContext(SkillNamesContext);
  return (id) => names.get(id) ?? id;
}
