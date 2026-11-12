import type { PersistedAgentEvent } from '@openpixo/contracts';
import { hostActionOf, skillNamesIn } from './host-calls';
import { commandOf, fileOf, isCommandTool, toolKind } from './tool-kind';

/**
 * 这一轮用了哪些技能(纯函数),按先后去重。两种证据:
 *  · daemon 把正文直接放进 prompt 的(`skills_loaded`:用户选的、recipe 带的、触发词命中的);
 *  · agent 自己读了 `.pixo-skills/<技能>/SKILL.md` 的:命令工具看命令,Read 这类工具看路径。
 *    读失败的不算。写这个文件也不算。
 *
 * 只是在清单里列着不算用过。没有证据就是空数组,界面不出这一行。
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
  return [...ids];
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
