import type { PersistedAgentEvent } from '@openpixo/contracts';
import { hostActionOf, parentSkillOf, skillNamesIn } from './host-calls';
import { commandOf, fileOf, isCommandTool, toolKind } from './tool-kind';

/**
 * 这一轮用了哪些技能(纯函数),按先后去重。两种证据:
 *  · daemon 把正文直接放进 prompt 的(`skills_loaded`:用户选的、recipe 带的、触发词命中的);
 *  · agent 自己读了 `.pixo-skills/<技能>/SKILL.md` 的:命令工具看命令,Read 这类工具看路径。
 *    读了 `references/<子技能>.md` 的记作 `<技能>/<子技能>`,并替掉单列的父技能。
 *    读失败的不算。写这个文件也不算。
 *
 * 只是在清单里列着不算用过。没有证据就是空数组,界面不出这一行。
 * 只看持久化的事件,所以恢复的对话和直播时一样。
 */
export function turnSkillIds(events: readonly PersistedAgentEvent[]): string[] {
  const failed = new Set<string>();
  for (const event of events) {
    if (event.kind === 'tool_result' && event.isError) failed.add(event.toolUseId);
  }
  const ids = new Set<string>();
  for (const event of events) {
    if (event.kind === 'skills_loaded') {
      for (const id of event.skillIds) ids.add(id);
    } else if (event.kind === 'tool_use' && !failed.has(event.id)) {
      for (const id of skillsReadBy(event)) ids.add(id);
    }
  }
  return foldSubSkills([...ids]);
}

/**
 * 读了子技能,就不再单列它的父技能:「游戏 HUD › 血条」已经说了用的是游戏 HUD。
 * 同一个父技能的子技能排在一起,位置是父技能或它第一个子技能最早出现的地方。
 */
function foldSubSkills(ordered: readonly string[]): string[] {
  const children = new Map<string, string[]>();
  for (const id of ordered) {
    const parent = parentSkillOf(id);
    if (parent !== id) children.set(parent, [...(children.get(parent) ?? []), id]);
  }
  const out = new Set<string>();
  for (const id of ordered) {
    for (const entry of children.get(parentSkillOf(id)) ?? [id]) out.add(entry);
  }
  return [...out];
}

function skillsReadBy(event: Extract<PersistedAgentEvent, { kind: 'tool_use' }>): string[] {
  if (isCommandTool(event.name)) {
    const action = hostActionOf(commandOf(event.input));
    return action?.kind === 'skill' ? action.names : [];
  }
  if (toolKind(event.name, event.input) !== 'read') return [];
  const path = fileOf(event.input)?.path;
  return path ? skillNamesIn(path) : [];
}
