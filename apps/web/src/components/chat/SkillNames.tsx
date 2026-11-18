import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { localizeSkillName, localizeSubSkillName } from '../../i18n/content';
import { useI18n } from '../../i18n';
import { parentSkillOf } from '../../runtime/chat/host-calls';
import type { SkillSummary } from '../../types';

const SkillNamesContext = createContext<ReadonlyMap<string, string>>(new Map());

/**
 * 技能的显示名。事件里只有 id,名字随界面语言走,所以由聊天面板从技能目录提供,
 * 不写进事件。目录里没有的(已删除的技能、面板外渲染)显示 id。
 *
 * 子技能(`<技能>/<子技能>`,见 `runtime/chat/turn-skills.ts`)显示成「游戏 HUD › 血条」;
 * 目录没给它起名字的附带文件只显示父技能。
 */
export function SkillNamesProvider({ skills, children }: { skills: readonly SkillSummary[]; children: ReactNode }) {
  const { locale, t } = useI18n();
  const names = useMemo(() => {
    const out = new Map<string, string>();
    for (const skill of skills) {
      const skillName = localizeSkillName(locale, skill);
      out.set(skill.id, skillName);
      for (const subSkill of skill.subSkills ?? []) {
        out.set(`${skill.id}/${subSkill.id}`, t('chat.turnSkills.subSkill', {
          skill: skillName, subSkill: localizeSubSkillName(locale, subSkill),
        }));
      }
    }
    return out;
  }, [locale, skills, t]);
  return <SkillNamesContext.Provider value={names}>{children}</SkillNamesContext.Provider>;
}

export function useSkillName(): (id: string) => string {
  const names = useContext(SkillNamesContext);
  return (id) => names.get(id) ?? names.get(parentSkillOf(id)) ?? parentSkillOf(id);
}

/** 一串技能 id 的显示名,同名的只留一个(同一技能的两个无名附带文件都显示成父技能)。 */
export function useSkillNames(): (ids: readonly string[]) => string[] {
  const skillName = useSkillName();
  return (ids) => [...new Set(ids.map(skillName))];
}
