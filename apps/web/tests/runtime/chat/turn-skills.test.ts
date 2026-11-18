import { describe, expect, it } from 'vitest';
import type { PersistedAgentEvent } from '@openpixo/contracts';
import { turnSkillIds } from '../../../src/runtime/chat/turn-skills';
import { IN_FLIGHT_TOOL_INPUT_MARKER } from '../../../src/runtime/tool-events';

const use = (id: string, name: string, input: unknown): PersistedAgentEvent => ({ kind: 'tool_use', id, name, input });
const result = (toolUseId: string, isError = false): PersistedAgentEvent => ({ kind: 'tool_result', toolUseId, content: '', isError });
const SKILL = '.pixo-skills/player-controller-2d-ea5011fbcc/SKILL.md';
const SUB = '.pixo-skills/game-ui-hud-0123456789/references/health-bars.md';

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

  it('does not count a failed read, an asset or writing to the file', () => {
    expect(turnSkillIds([use('1', 'Read', { file_path: SKILL }), result('1', true)])).toEqual([]);
    expect(turnSkillIds([use('1', 'Read', { file_path: '.pixo-skills/player-controller-2d-ea5011fbcc/assets/x.png' })])).toEqual([]);
    expect(turnSkillIds([use('1', 'Write', { file_path: SKILL, content: 'x' })])).toEqual([]);
    expect(turnSkillIds([use('1', 'Write', { file_path: SUB, content: 'x' })])).toEqual([]);
  });

  it('counts a sub-skill read as that sub-skill, in place of its parent', () => {
    expect(turnSkillIds([use('1', 'Read', { file_path: SUB }), result('1')])).toEqual(['game-ui-hud/health-bars']);
    expect(turnSkillIds([
      use('1', 'Read', { file_path: '.pixo-skills/game-ui-hud-0123456789/SKILL.md' }),
      use('2', 'Read', { file_path: SKILL }),
      use('3', 'Read', { file_path: SUB }),
      use('4', 'Read', { file_path: '.pixo-skills/game-ui-hud-0123456789/references/minimap-world-map.md' }),
    ])).toEqual(['game-ui-hud/health-bars', 'game-ui-hud/minimap-world-map', 'player-controller-2d']);
    expect(turnSkillIds([use('1', 'shell_command', { command: `Get-Content '${SUB}'` }), result('1')])).toEqual(['game-ui-hud/health-bars']);
  });

  it('gives a restored conversation the same skills as the live one', () => {
    // Live: the early in-flight form of the read, then the real call. Restored: the events as stored.
    const live: PersistedAgentEvent[] = [
      use('1', 'Read', { file_path: SUB, [IN_FLIGHT_TOOL_INPUT_MARKER]: true }),
      use('1', 'Read', { file_path: SUB }),
      result('1'),
    ];
    const restored = JSON.parse(JSON.stringify(live.slice(1))) as PersistedAgentEvent[];
    expect(turnSkillIds(live)).toEqual(['game-ui-hud/health-bars']);
    expect(turnSkillIds(restored)).toEqual(turnSkillIds(live));
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
