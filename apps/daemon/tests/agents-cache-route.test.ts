import type { Express, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DetectedAgent } from '../src/runtimes/types.js';
import { registerStaticResourceRoutes } from '../src/routes/static-resource.js';

const mocks = vi.hoisted(() => ({
  readAppConfig: vi.fn(),
  detectAgents: vi.fn(),
  detectAgentsStream: vi.fn(),
  getDetectedAgents: vi.fn(),
  getDetectedAgentsStream: vi.fn(),
}));

vi.mock('../src/app-config.js', () => ({ readAppConfig: mocks.readAppConfig }));
vi.mock('../src/agents.js', () => ({
  detectAgents: mocks.detectAgents,
  detectAgentsStream: mocks.detectAgentsStream,
  getDetectedAgents: mocks.getDetectedAgents,
  getDetectedAgentsStream: mocks.getDetectedAgentsStream,
}));
vi.mock('../src/routes/agent-capabilities.js', () => ({ registerAgentCapabilityRoutes: vi.fn() }));

const agents: DetectedAgent[] = ['codex', 'claude'].map((id) => ({
  id,
  name: id,
  bin: id,
  versionArgs: ['--version'],
  streamFormat: 'test',
  available: true,
  models: [{ id: `${id}-model`, label: `${id} model` }],
  modelsSource: 'live',
}));

function harness() {
  type Handler = (req: Request, res: Response) => Promise<void>;
  const handlers = new Map<string, Handler>();
  const app = {
    get: (route: string, handler: Handler) => handlers.set(route, handler),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  };
  registerStaticResourceRoutes(app as unknown as Express, {
    db: {},
    paths: { RUNTIME_DATA_DIR: 'unused-isolated-data-root' },
    resources: {},
    http: {},
  } as unknown as Parameters<typeof registerStaticResourceRoutes>[1]);

  async function request(query: Record<string, string> = {}) {
    const res = {
      json: vi.fn(),
      status: vi.fn(() => res),
      writeHead: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
    };
    const req = { query, on: vi.fn() };
    await handlers.get('/api/agents')!(req as unknown as Request, res as unknown as Response);
    return res;
  }
  return { request };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readAppConfig.mockResolvedValue({
    agentCliEnv: {
      codex: { CODEX_BIN: 'configured-codex', CODEX_HOME: 'configured-home' },
      claude: { CLAUDE_BIN: 'configured-claude' },
    },
  });
  mocks.getDetectedAgents.mockResolvedValue(agents);
  mocks.detectAgents.mockResolvedValue(agents);
  const stream = async function* () { yield* agents; };
  mocks.getDetectedAgentsStream.mockImplementation(stream);
  mocks.detectAgentsStream.mockImplementation(stream);
});

describe('GET /api/agents detection cache routing', () => {
  it('uses cached detection for ordinary JSON requests and forwards configured CLI inputs', async () => {
    const h = harness();
    const res = await h.request();
    await h.request();

    expect(mocks.getDetectedAgents).toHaveBeenCalledTimes(2);
    expect(mocks.detectAgents).not.toHaveBeenCalled();
    const config = await mocks.readAppConfig.mock.results[0]!.value;
    expect(mocks.getDetectedAgents.mock.calls[0]![0]).toBe(config.agentCliEnv);
    expect(mocks.readAppConfig).toHaveBeenCalledWith('unused-isolated-data-root');
    expect(res.json).toHaveBeenCalledWith({ agents });
  });

  it.each(['1', 'true'])('streams cached entries and a terminal done event for stream=%s', async (stream) => {
    const res = await harness().request({ stream });

    expect(mocks.getDetectedAgentsStream).toHaveBeenCalledOnce();
    expect(mocks.detectAgentsStream).not.toHaveBeenCalled();
    const config = await mocks.readAppConfig.mock.results[0]!.value;
    expect(mocks.getDetectedAgentsStream.mock.calls[0]![0]).toBe(config.agentCliEnv);
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
    }));
    expect(res.write.mock.calls.map(([chunk]) => chunk)).toEqual([
      ...agents.map((agent) => `event: agent\ndata: ${JSON.stringify(agent)}\n\n`),
      'event: done\ndata: {}\n\n',
    ]);
    expect(res.end).toHaveBeenCalledOnce();
  });

  it.each(['1', 'true'])('forces fresh JSON detection for refresh=%s', async (refresh) => {
    const res = await harness().request({ refresh });

    expect(mocks.detectAgents).toHaveBeenCalledOnce();
    expect(mocks.getDetectedAgents).not.toHaveBeenCalled();
    const config = await mocks.readAppConfig.mock.results[0]!.value;
    expect(mocks.detectAgents.mock.calls[0]![0]).toBe(config.agentCliEnv);
    expect(res.json).toHaveBeenCalledWith({ agents });
  });

  it.each(['1', 'true'])('forces fresh streaming detection for refresh=%s', async (refresh) => {
    const res = await harness().request({ stream: '1', refresh });

    expect(mocks.detectAgentsStream).toHaveBeenCalledOnce();
    expect(mocks.getDetectedAgentsStream).not.toHaveBeenCalled();
    const config = await mocks.readAppConfig.mock.results[0]!.value;
    expect(mocks.detectAgentsStream.mock.calls[0]![0]).toBe(config.agentCliEnv);
    expect(res.write.mock.calls.map(([chunk]) => chunk)).toEqual([
      ...agents.map((agent) => `event: agent\ndata: ${JSON.stringify(agent)}\n\n`),
      'event: done\ndata: {}\n\n',
    ]);
    expect(res.end).toHaveBeenCalledOnce();
  });

  it('keeps omitted CLI configuration valid for cached detection', async () => {
    mocks.readAppConfig.mockResolvedValue({});
    await harness().request();

    expect(mocks.getDetectedAgents).toHaveBeenCalledWith({});
  });
});
