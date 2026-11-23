import { describe, expect, it } from 'vitest';
import type { FirstRunGuidePrefs, ProjectMetadata } from '@openpixo/contracts';
import { firstRunHint, guideAgent, guideAsk } from '../../../src/components/first-run/guide-state';
import type { AgentInfo, AppConfig, ChatMessage } from '../../../src/types';

const reply = (content: string, runStatus: ChatMessage['runStatus'] = 'succeeded') => ({ role: 'assistant' as const, content, runStatus });
const ask = { role: 'user' as const, content: 'double jump', runStatus: undefined };

describe('the request to the AI', () => {
  it('follows the run: waiting, working, then how it ended', () => {
    expect(guideAsk([], false)).toBe('todo');
    expect(guideAsk([ask], true)).toBe('working');
    expect(guideAsk([ask, reply('done')], false)).toBe('done');
    expect(guideAsk([ask, reply('', 'failed')], false)).toBe('failed');
    expect(guideAsk([ask, reply('half', 'canceled')], false)).toBe('failed');
    // A second try that worked is what counts.
    expect(guideAsk([ask, reply('', 'failed'), ask, reply('done')], false)).toBe('done');
  });
});

const config = { mode: 'daemon', agentId: null, apiKey: '', baseUrl: '', model: '' } as unknown as AppConfig;
const agent = (id: string, extra: Partial<AgentInfo> = {}) => ({ id, name: id, available: true, ...extra }) as AgentInfo;
const cloud = (available: number | null, signedIn = true) => ({ signedIn, credits: available === null ? null : { available, subscription: null } });
const facts = (over: Partial<Parameters<typeof guideAgent>[0]> = {}) => guideAgent({
  loading: false, cloudAvailable: true, cloud: cloud(0), agents: [agent('openpixo-agent')], config, ...over,
});

describe('who answers', () => {
  it('says what is missing, in the order that fixes it', () => {
    expect(facts({ cloud: cloud(null, false) })).toBe('needs-sign-in');
    expect(facts()).toBe('needs-credits');
    expect(facts({ cloud: cloud(600) })).toBe('credits');
    // Credits but no agent to spend them is a broken install; a build without accounts has only own tools.
    expect(facts({ cloud: cloud(600), agents: [] })).toBe('needs-setup');
    expect(facts({ cloudAvailable: false, cloud: cloud(null, false), agents: [] })).toBe('needs-setup');
  });

  it('uses the user’s own AI without asking for credits, and waits for facts before refusing', () => {
    expect(facts({ agents: [agent('codex')] })).toBe('own');
    expect(facts({ agents: [agent('codex', { authStatus: 'missing' })] })).toBe('needs-credits');
    expect(facts({ config: { ...config, mode: 'api', apiKey: 'k', baseUrl: 'https://x', model: 'm' } as AppConfig })).toBe('own');
    expect(facts({ loading: true })).toBe('loading');
  });
});

describe('one-time hints', () => {
  const guide: FirstRunGuidePrefs = { status: 'done', step: 'make' };
  const planning = { gamePlan: { status: 'planning', startedAt: 1 } } as Partial<ProjectMetadata>;
  const approved = { gamePlan: { status: 'approved', startedAt: 1 }, engineProfile: { engine: 'phaser' } } as Partial<ProjectMetadata>;
  const hint = (metadata: Partial<ProjectMetadata>, messages: ReturnType<typeof reply>[], over: Partial<Parameters<typeof firstRunHint>[0]> = {}) =>
    firstRunHint({ guide, metadata: metadata as ProjectMetadata, messages, running: false, ...over });
  const stage = reply('阶段 1 / 共 4：能跑能跳\n\n点运行试试。');
  const art = reply('要画这些：\n<art-request credits="12">\n- 主角\n- 背景\n</art-request>');

  it('shows each where it helps', () => {
    expect(hint(planning, [reply('第 1 步 / 共 5 步：玩法')])).toBe('plan');
    expect(hint(approved, [art])).toBe('art');
    expect(hint(approved, [stage])).toBe('stage');
  });

  it('mentions sharing only for a web game that has run, after the first stage', () => {
    const ran = { ...approved, gameRunSucceededAt: 5 };
    const seen = { ...guide, hintsSeen: ['stage' as const] };
    expect(hint(ran, [reply('好了')], { guide: seen })).toBe('share');
    expect(hint(ran, [reply('好了')])).toBeNull();
    expect(hint(approved, [reply('好了')], { guide: seen })).toBeNull();
    expect(hint({ ...ran, engineProfile: { engine: 'godot' } } as Partial<ProjectMetadata>, [reply('好了')], { guide: seen })).toBeNull();
  });

  it('stays away from everyone else', () => {
    const messages = [reply('第 1 步 / 共 5 步：玩法')];
    // Never offered (an existing user), already closed, a run in flight, the sample itself.
    expect(hint(planning, messages, { guide: null })).toBeNull();
    expect(hint(planning, messages, { guide: undefined })).toBeNull();
    expect(hint(planning, messages, { guide: { ...guide, hintsSeen: ['plan'] } })).toBeNull();
    expect(hint(planning, messages, { running: true })).toBeNull();
    expect(hint({ ...planning, templateId: 'phaser3-sample-platformer' }, messages)).toBeNull();
    expect(hint(planning, [])).toBeNull();
  });
});
