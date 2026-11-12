import { describe, expect, it, vi } from 'vitest';

import { buildPersistedConfig, isAutosaveDraftOnlyChange, mergeAgentModelChoice, projectViewAuthorizationLifetimeKey, projectRouteSurfaceState, resolveDeepLinkedProject, resolveSettingsCloseConfig, shouldRouteToFirstRunOnboarding, shouldSyncMediaProvidersOnSave } from '../src/App';
import type { AppConfig, Project } from '../src/types';


describe('projectRouteSurfaceState', () => {
  it('only shows an unbounded loader while the initial project list is loading', () => {
    expect(projectRouteSurfaceState({
      projectsLoading: true,
      hasActiveProject: false,
      daemonLive: false,
    })).toBe('loading-projects');
  });

  it('makes an absent project terminal when the daemon is unavailable', () => {
    expect(projectRouteSurfaceState({
      projectsLoading: false,
      hasActiveProject: false,
      daemonLive: false,
    })).toBe('daemon-unavailable');
  });

  it('exposes bounded deep-link failures instead of leaving the route loading forever', () => {
    expect(projectRouteSurfaceState({
      projectsLoading: false,
      hasActiveProject: false,
      daemonLive: true,
      resolutionFailure: 'missing',
    })).toBe('missing');
    expect(projectRouteSurfaceState({
      projectsLoading: false,
      hasActiveProject: false,
      daemonLive: true,
      resolutionFailure: 'materialization-failed',
    })).toBe('materialization-failed');
  });

  it('renders a loaded project regardless of stale failure metadata', () => {
    expect(projectRouteSurfaceState({
      projectsLoading: false,
      hasActiveProject: true,
      daemonLive: true,
      resolutionFailure: 'missing',
    })).toBe('ready');
  });
});

const baseConfig: AppConfig = {
  mode: 'api',
  apiKey: 'sk-test',
  apiProtocol: 'anthropic',
  baseUrl: 'https://api.anthropic.com',
  model: 'claude-sonnet-4-5',
  apiProviderBaseUrl: 'https://api.anthropic.com',
  agentId: null,
  skillId: null,
};

describe('shouldRouteToFirstRunOnboarding', () => {
  it('never hijacks an explicit project deep link while daemon config is hydrating', () => {
    const unfinished = { ...baseConfig, onboardingCompleted: false };

    expect(shouldRouteToFirstRunOnboarding(unfinished, '/projects/project-a')).toBe(false);
    expect(shouldRouteToFirstRunOnboarding(unfinished, '/')).toBe(true);
  });
});

describe('mergeAgentModelChoice', () => {
  it('preserves serviceTier when an unrelated update omits the key', () => {
    expect(
      mergeAgentModelChoice(
        { model: 'gpt-5.5', reasoning: 'default', serviceTier: 'priority' },
        { reasoning: 'high' },
      ),
    ).toEqual({
      model: 'gpt-5.5',
      reasoning: 'high',
      reasoningByModel: { 'gpt-5.5': 'high' },
      serviceTier: 'priority',
    });
  });

  it('keeps effort per model: choosing a model restores what it last ran at, or its default', () => {
    const first = mergeAgentModelChoice({ model: 'sol' }, { model: 'sol', reasoning: 'high' });
    const second = mergeAgentModelChoice(first, { model: 'luna', serviceTier: undefined });
    expect(second.reasoning).toBeUndefined();
    const third = mergeAgentModelChoice(second, { model: 'luna', reasoning: 'low' });
    expect(third.reasoningByModel).toEqual({ sol: 'high', luna: 'low' });
    expect(mergeAgentModelChoice(third, { model: 'sol', serviceTier: undefined }).reasoning).toBe('high');
    expect(mergeAgentModelChoice(third, { model: 'luna', serviceTier: undefined }).reasoning).toBe('low');
  });

  it('removes serviceTier only when the update explicitly clears it', () => {
    const merged = mergeAgentModelChoice(
      { model: 'gpt-5.5', reasoning: 'default', serviceTier: 'priority' },
      { serviceTier: undefined },
    );

    expect(merged).toEqual({
      model: 'gpt-5.5',
      reasoning: 'default',
    });
    expect(Object.prototype.hasOwnProperty.call(merged, 'serviceTier')).toBe(false);
  });
});

describe('shouldSyncMediaProvidersOnSave', () => {
  it('keeps bootstrap-style empty media maps from syncing by default', () => {
    expect(shouldSyncMediaProvidersOnSave({})).toBe(false);
  });

  it('syncs an explicit empty media map when the user save should force a clear', () => {
    expect(shouldSyncMediaProvidersOnSave({}, { force: true })).toBe(true);
  });
});

describe('buildPersistedConfig', () => {
  it('preserves onboarding completion when a stale autosave snapshot says false', () => {
    expect(
      buildPersistedConfig(
        { ...baseConfig, onboardingCompleted: false },
        { ...baseConfig, onboardingCompleted: true },
      ),
    ).toMatchObject({ onboardingCompleted: true });
  });

  it('preserves a current privacy decision when settings autosaves a stale pre-consent snapshot', () => {
    expect(
      buildPersistedConfig(
        {
          ...baseConfig,
          apiProtocol: 'google',
          privacyDecisionAt: null,
          telemetry: { metrics: true, },
        },
        {
          ...baseConfig,
          installationId: 'inst-current',
          privacyDecisionAt: 12345,
          telemetry: { metrics: false, },
        },
      ),
    ).toMatchObject({
      apiProtocol: 'google',
      installationId: 'inst-current',
      privacyDecisionAt: 12345,
      telemetry: { metrics: false, },
    });
  });
});

describe('isAutosaveDraftOnlyChange', () => {
  const savedConfig: AppConfig = {
    ...baseConfig,
  };

  it('flags a real change (non-draft field) as persist-worthy', () => {
    const flipped: AppConfig = { ...savedConfig, model: 'claude-opus-4-7' };
    expect(isAutosaveDraftOnlyChange(flipped, savedConfig)).toBe(false);
  });

  it('returns true for an identical snapshot (no-op autosave tick)', () => {
    expect(isAutosaveDraftOnlyChange(savedConfig, savedConfig)).toBe(true);
  });
});

describe('resolveSettingsCloseConfig', () => {
  it('marks onboarding complete without discarding the latest persisted draft', () => {
    expect(
      resolveSettingsCloseConfig(
        {
          ...baseConfig,
          onboardingCompleted: false,
          customInstructions: 'stale instructions',
        },
        {
          ...baseConfig,
          onboardingCompleted: false,
          customInstructions: 'fresh instructions',
        },
      ),
    ).toMatchObject({
      onboardingCompleted: true,
      customInstructions: 'fresh instructions',
    });
  });
});

// Regression coverage for the deep-link bootstrap effect's team-share race
// (App.tsx's "Deep-linked route to a project we don't have yet" effect). A
// team member's FIRST open of a project the owner just shared with them
// arrives as a deep link before the daemon has materialized any local sqlite
// row for that project. The effect used to treat a single immediate miss as
// "this project doesn't exist" and navigate the member straight back to Home
// mid-sync — even when the hub-backed `/api/workspace/projects/team` catalog
// already confirmed the project belongs to their team. These tests exercise
// the extracted decision function directly (no React, no timers) so the
// retry/backoff and the found vs. still-materializing vs. not-found
// classification stay pinned without a flaky fake-timer + RTL harness.
describe('resolveDeepLinkedProject', () => {
  const sharedProject: Project = {
    id: 'shared-1',
    name: 'Owner Shared Project',
    skillId: null,
    createdAt: 1778244000000,
    updatedAt: 1778244000000,
  };
  const noopDelay = async () => {};

  it('resolves as found immediately when the local project already exists', async () => {
    const getProject = vi.fn(async () => sharedProject);
    const pullTeamSharedProjectIfAvailable = vi.fn(async () => ({ catalogAvailable: true, isTeamShared: false, pulled: false }));

    const resolution = await resolveDeepLinkedProject('shared-1', {
      getProject,

      delay: noopDelay,
    });

    expect(resolution).toEqual({ kind: 'found', project: sharedProject });
    expect(getProject).toHaveBeenCalledTimes(1);
    expect(pullTeamSharedProjectIfAvailable).not.toHaveBeenCalled();
  });

  it('resolves as found once local materialization catches up mid-retry', async () => {
    const getProject = vi
      .fn<(id: string) => Promise<Project | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(sharedProject);
    const pullTeamSharedProjectIfAvailable = vi.fn(async () => ({ catalogAvailable: true, isTeamShared: true, pulled: true }));

    const resolution = await resolveDeepLinkedProject('shared-1', {
      getProject,

      delay: noopDelay,
      retryAttempts: 4,
    });

    expect(resolution).toEqual({ kind: 'found', project: sharedProject });
    // 1st attempt: getProject miss + pull's post-pull re-check miss (2 calls).
    // 2nd attempt: getProject hit (3rd call) — no pull needed once found.
    expect(getProject).toHaveBeenCalledTimes(3);
  });

  // The safety net: a project genuinely absent from the team catalog (never
  // shared, revoked, or a real typo'd/unauthorized id) must still resolve as
  // not-found so the caller's existing list-based fallback and
  // navigate-home behavior keeps firing exactly as before this fix.


  it('stops retrying once the caller reports cancellation', async () => {
    let calls = 0;
    const getProject = vi.fn(async () => {
      calls += 1;
      return null;
    });
    const pullTeamSharedProjectIfAvailable = vi.fn(async () => ({ catalogAvailable: true, isTeamShared: true, pulled: false }));

    const resolution = await resolveDeepLinkedProject('shared-1', {
      getProject,

      delay: noopDelay,
      retryAttempts: 10,
      // Cancel right after the very first getProject call, as an unmount mid
      // retry would — the loop must not keep spinning through every attempt.
      isCancelled: () => calls >= 1,
    });

    expect(resolution).toEqual({ kind: 'still-materializing' });
    expect(getProject).toHaveBeenCalledTimes(1);
    expect(pullTeamSharedProjectIfAvailable).not.toHaveBeenCalled();
  });


});
