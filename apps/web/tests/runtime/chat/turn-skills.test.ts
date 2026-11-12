import { describe, expect, it } from 'vitest';
import type { PersistedAgentEvent } from '@openpixo/contracts';
import { turnSkillIds } from '../../../src/runtime/chat/turn-skills';

const use = (id: string, name: string, input: unknown): PersistedAgentEvent => ({ kind: 'tool_use', id, name, input });
const result = (toolUseId: string, isError = false): PersistedAgentEvent => ({ kind: 'tool_result', toolUseId, content: '', isError });
const SKILL = '.pixo-skills/player-controller-2d-ea5011fbcc/SKILL.md';

describe('turnSkillIds', () => {
  it('is empty when the turn shows no evidence of a skill', () => {
    expect(turnSkillIds([])).toEqual([]);
    expect(turnSkillIds([use('1', 'Read', { file_path: 'src/main.ts' }), use('2', 'Bash', { command: 'pnpm build' })])).toEqual([]);
  });

  it('counts skills the host put into the prompt', () => {
    expect(turnSkillIds([{ kind: 'skills_loaded', skillIds: ['game-feel-juice', 'phaser-game-dev'] }])).toEqual(['game-feel-juice', 'phaser-game-dev']);
  });

  it('counts a skill read through a shell command, as Codex does', () => {
    expect(turnSkillIds([use('1', 'shell_command', { command: `Get-Content '${SKILL}'` }), result('1')])).toEqual(['player-controller-2d']);
  });

  it.each([
    ['Claude Code', 'Read', { file_path: `C:\\game\\.pixo-skills\\player-controller-2d-ea5011fbcc\\SKILL.md` }],
    ['OpenCode', 'read', { filePath: `/game/${SKILL}` }],
  ])('counts a skill read with the read tool of %s', (_runtime, name, input) => {
    expect(turnSkillIds([use('1', name, input), result('1')])).toEqual(['player-controller-2d']);
  });

  it('counts a read that is still running', () => {
    expect(turnSkillIds([use('1', 'Read', { file_path: SKILL })])).toEqual(['player-controller-2d']);
  });

  it('does not count a failed read, a side file or writing to the file', () => {
    expect(turnSkillIds([use('1', 'Read', { file_path: SKILL }), result('1', true)])).toEqual([]);
    expect(turnSkillIds([use('1', 'Read', { file_path: '.pixo-skills/player-controller-2d-ea5011fbcc/references/x.md' })])).toEqual([]);
    expect(turnSkillIds([use('1', 'Write', { file_path: SKILL, content: 'x' })])).toEqual([]);
  });

  it('lists each skill once, in the order it was used', () => {
    expect(turnSkillIds([
      { kind: 'skills_loaded', skillIds: ['phaser-game-dev'] },
      use('1', 'Read', { file_path: SKILL }),
      use('2', 'Read', { file_path: '.pixo-skills/phaser-game-dev-0123456789/SKILL.md' }),
      use('3', 'Read', { file_path: SKILL }),
    ])).toEqual(['phaser-game-dev', 'player-controller-2d']);
  });
});
