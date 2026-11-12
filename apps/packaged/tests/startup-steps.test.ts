import { describe, expect, it } from 'vitest';

import { startupStepsSummary, type StartupStep } from '../src/startup-steps.js';

describe('startup steps summary', () => {
  it('lists steps in the order they happened with their time since process start', () => {
    const steps: StartupStep[] = [['main_entry', 2100], ['electron_ready', 3400], ['daemon_spawned', 4100]];
    expect(Object.entries(startupStepsSummary(steps))).toEqual(steps);
  });

  it('keeps the first time of a step that repeats, such as a web sidecar respawn', () => {
    expect(startupStepsSummary([['web_spawned', 5000], ['web_spawned', 90000]])).toEqual({ web_spawned: 5000 });
  });
});
