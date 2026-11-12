import { describe, expect, it } from 'vitest';
import { isTodoWriteToolName } from '../src/api/run-completeness.js';

/**
 * 「这是不是一次清单快照」**只能有一个判据**。
 *
 * 渲染和完成判据都必须认得大小写变化、MCP 前缀和历史会话里的工具名。
 */
describe('清单工具名判据', () => {
  it('认得各家的原生写法', () => {
    for (const name of ['TodoWrite', 'todowrite', 'todo_write', 'update_plan']) {
      expect(isTodoWriteToolName(name), name).toBe(true);
    }
  });

  it('认得历史会话中 title-case 的 `Todowrite`', () => {
    expect(isTodoWriteToolName('Todowrite')).toBe(true);
  });

  it('大小写一律不敏感 —— 判据不该依赖某一家怎么拼', () => {
    for (const name of ['TODOWRITE', 'Todo_Write', 'Update_Plan']) {
      expect(isTodoWriteToolName(name), name).toBe(true);
    }
  });

  it('MCP 注入的前缀名也认', () => {
    expect(isTodoWriteToolName('mcp__planner__todo_write')).toBe(true);
  });

  it('长得像但不是的,一个都不许认', () => {
    for (const name of ['Write', 'todowriter', 'write_todos_later', '', 'TodoRead']) {
      expect(isTodoWriteToolName(name), name).toBe(false);
    }
  });

  it('非字符串不炸', () => {
    for (const bad of [null, undefined, 42, {}]) {
      expect(isTodoWriteToolName(bad)).toBe(false);
    }
  });
});
