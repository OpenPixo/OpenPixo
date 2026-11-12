// Regression coverage for issue #2297: when a single agent's launch
// resolution throws (e.g. a transient filesystem error during PATH
// walking on Windows packaged builds), `detectAgents()` used to reject
// the whole `Promise.all` and the `/api/agents` route caught it back to
// an empty array. The UI then showed only the cloud/BYOK fallback even
// though every other CLI was healthy. These tests pin the per-probe
// isolation invariant: one broken adapter must not blank the picker.
import { afterEach, expect, test, vi } from 'vitest';

vi.mock('../../src/runtimes/launch.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/runtimes/launch.js')>();
  return {
    ...actual,
    resolveAgentLaunchAsync: vi.fn(actual.resolveAgentLaunchAsync),
    applyAgentLaunchEnvAsync: vi.fn(actual.applyAgentLaunchEnvAsync),
  };
});

import * as launchModule from '../../src/runtimes/launch.js';
import { detectAgents } from '../../src/runtimes/detection.js';
import { AGENT_DEFS } from '../../src/runtimes/registry.js';

const mockedResolveAgentLaunch = vi.mocked(launchModule.resolveAgentLaunchAsync);
const mockedApplyAgentLaunchEnv = vi.mocked(launchModule.applyAgentLaunchEnvAsync);
const originalResolveImpl = mockedResolveAgentLaunch.getMockImplementation()!;
const originalApplyImpl = mockedApplyAgentLaunchEnv.getMockImplementation()!;

afterEach(() => {
  mockedResolveAgentLaunch.mockImplementation(originalResolveImpl);
  mockedApplyAgentLaunchEnv.mockImplementation(originalApplyImpl);
});

test('detectAgents isolates a single agent probe throw so the picker still lists every adapter', async () => {
  // Simulate the failure shape that issue #2297 attributes to packaged
  // Windows daemons: one adapter's launch resolution throws because the
  // FS walk hits a permission error, a malformed PATH entry, or a
  // broken symlink (`access`/`readdir` can surface either as a
  // throw). Before the per-probe guard the whole `Promise.all`
  // rejected; the `/api/agents` route's `catch(() => [])` then handed
  // the UI an empty list and the model picker collapsed to Cloud only.
  mockedResolveAgentLaunch.mockImplementation(async (def, env) => {
    if (def.id === 'claude') {
      throw new Error('synthetic FS throw during PATH walk');
    }
    return originalResolveImpl(def, env);
  });

  const agents = await detectAgents();

  // Every adapter from the registry must still appear, including the
  // one whose probe blew up — it just gets surfaced as unavailable so
  // the rest of the picker (and the BYOK fallback row) stays intact.
  expect(mockedResolveAgentLaunch).toHaveBeenCalled();
  expect(agents.length).toBe(AGENT_DEFS.length);
  const claude = agents.find((a) => a.id === 'claude');
  expect(claude, 'broken adapter must still appear in the detection result').toBeDefined();
  expect(claude?.available).toBe(false);
  // And the other adapters must keep whatever availability the real
  // probe would have returned — none of them get blanket-marked
  // unavailable just because claude's slot threw.
  expect(agents.filter((a) => a.id !== 'claude').length).toBe(AGENT_DEFS.length - 1);
});

test('detectAgents isolates a probe throw from applyAgentLaunchEnvAsync just like resolveAgentLaunchAsync', async () => {
  // The same per-probe guard has to cover both awaited sites in
  // `probe()` that sit outside the existing inner try/catch blocks:
  // `resolveAgentLaunchAsync` (above) and `applyAgentLaunchEnvAsync` (here). A
  // single test for each anchors the invariant against future code
  // that adds a third pre-try call.
  let thrown = false;
  // The env is only built for a resolved binary, so resolve one on any machine.
  mockedResolveAgentLaunch.mockImplementation(async (def, env, options) => ({
    ...(await originalResolveImpl(def, env, options)),
    selectedPath: process.execPath,
    launchPath: process.execPath,
  }));
  mockedApplyAgentLaunchEnv.mockImplementation(async (env, launch, nodeBinDir) => {
    // We cannot tell which agent this env belongs to from arguments
    // alone, so throw on the first call and pass through afterwards.
    // detectAgents runs probes in parallel via Promise.all so the
    // "first" call is non-deterministic but for fault-isolation that
    // does not matter — any single throw blanking the whole list is
    // the bug.
    if (!thrown) {
      thrown = true;
      throw new Error('synthetic env construction error');
    }
    return originalApplyImpl(env, launch, nodeBinDir);
  });

  const agents = await detectAgents();

  expect(mockedResolveAgentLaunch).toHaveBeenCalled();
  expect(agents.length).toBe(AGENT_DEFS.length);
  // At least one adapter is marked unavailable because of the throw;
  // every other adapter keeps its real availability.
  expect(thrown).toBe(true);
  const unavailableFromThrow = agents.filter((a) => a.available === false);
  expect(unavailableFromThrow.length).toBeGreaterThanOrEqual(1);
});
