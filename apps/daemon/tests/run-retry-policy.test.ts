import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SAFE_RUN_RETRY_MAX_ATTEMPTS,
  MAX_PROVIDER_BUSY_RETRY_DELAY_MS,
  MAX_RETRY_BACKOFF_DELAY_MS,
  PROVIDER_BUSY_RETRY_BASE_DELAY_MS,
  PROVIDER_BUSY_RETRY_MAX_ATTEMPTS,
  RATE_LIMIT_RETRY_BASE_DELAY_MS,
  SAFE_RUN_RETRY_STRATEGY,
  NATIVE_SESSION_CONTINUE_STRATEGY,
  TRANSIENT_RETRY_BASE_DELAY_MS,
  computeRetryBackoffMs,
  decidePostToolResumeRecovery,
  decideSafeRunRetry,
  isProviderBusyFailure,
  providerBusyLogLine,
  type RunRetryPolicyInput,
} from '../src/run-retry-policy.js';

function decidePostToolResume(
  input: Partial<Parameters<typeof decidePostToolResumeRecovery>[0]> = {},
) {
  return decidePostToolResumeRecovery({
    result: 'failed',
    continuationAttemptCount: 0,
    totalRetryAttemptCount: 0,
    failure: {
      failure_category: 'timeout',
      failure_detail: 'inactivity_timeout',
      failure_stage: 'post_tool_resume',
      retryable: true,
    },
    sideEffects: { toolCallSeen: true },
    supportsNativeSessionContinue: true,
    hasNativeSession: true,
    ...input,
  });
}

function decide(input: Partial<RunRetryPolicyInput> = {}) {
  return decideSafeRunRetry({
    result: 'failed',
    attemptCount: 0,
    failure: {
      failure_category: 'upstream_unavailable',
      failure_detail: 'upstream_5xx',
      failure_stage: 'first_token_wait',
      retryable: true,
    },
    ...input,
  });
}

describe('decideSafeRunRetry', () => {
  it('allows retryable transient upstream failures before side effects', () => {
    // random: () => 0 pins equal-jitter to its floor (delay/2) for an exact match.
    expect(decide({ random: () => 0 })).toEqual({
      shouldRetry: true,
      retryAttemptIndex: 1,
      retryMaxAttempts: DEFAULT_SAFE_RUN_RETRY_MAX_ATTEMPTS,
      retryStrategy: SAFE_RUN_RETRY_STRATEGY,
      retryReason: 'transient_failure',
      retryDelayMs: TRANSIENT_RETRY_BASE_DELAY_MS / 2,
    });
  });

  it('allows ordinary retryable 429 rate limits but suppresses hard quota', () => {
    expect(
      decide({
        failure: {
          failure_category: 'rate_limit',
          failure_detail: 'rate_limit_429',
          failure_stage: 'session_init',
          retryable: true,
        },
      }).shouldRetry,
    ).toBe(true);

    expect(
      decide({
        failure: {
          failure_category: 'rate_limit',
          failure_detail: 'hard_quota',
          failure_stage: 'session_init',
          retryable: false,
        },
      }),
    ).toMatchObject({
      shouldRetry: false,
      retrySuppressedReason: 'hard_quota',
    });
  });

  it('allows empty output and first-token timeout failures', () => {
    expect(
      decide({
        failure: {
          failure_category: 'empty_output',
          failure_detail: 'empty_output',
          failure_stage: 'first_token_wait',
          retryable: true,
        },
      }).shouldRetry,
    ).toBe(true);

    expect(
      decide({
        failure: {
          failure_category: 'timeout',
          failure_detail: 'inactivity_timeout',
          failure_stage: 'first_token_wait',
          retryable: true,
        },
      }).shouldRetry,
    ).toBe(true);
  });

  it('allows named transient process-exit details before side effects', () => {
    for (const failure_detail of [
      'agent_protocol_error',
      'session_resume_expired',
      'credential_refresh_contention',
      'stream_error',
      'fatal_rpc_error',
    ] as const) {
      expect(
        decide({
          failure: {
            failure_category: 'process_exit',
            failure_detail,
            failure_stage: 'child_close',
            retryable: true,
          },
        }),
      ).toMatchObject({
        shouldRetry: true,
        retryReason: 'transient_failure',
      });
    }
  });

  // A lost credential-refresh lock is raised before any request is sent, so
  // `session_init` is the only stage it can carry. `agent_protocol_error` is
  // suppressed at exactly that stage, so pin the distinction: were the entry to
  // inherit that stage rule it would be dead on arrival and never retry once.
  it('retries a credential refresh contention at session_init', () => {
    expect(
      decide({
        failure: {
          failure_category: 'process_exit',
          failure_detail: 'credential_refresh_contention',
          failure_stage: 'session_init',
          retryable: true,
        },
      }),
    ).toMatchObject({
      shouldRetry: true,
      retryReason: 'transient_failure',
    });

    expect(
      decide({
        failure: {
          failure_category: 'process_exit',
          failure_detail: 'agent_protocol_error',
          failure_stage: 'session_init',
          retryable: true,
        },
      }),
    ).toMatchObject({
      shouldRetry: false,
      retrySuppressedReason: 'unsafe_failure_stage',
    });
  });

  it('keeps upstream client errors out of the transient retry allowlist', () => {
    expect(
      decide({
        failure: {
          failure_category: 'upstream_unavailable',
          failure_detail: 'upstream_client_error',
          failure_stage: 'first_token_wait',
          retryable: true,
        },
      }),
    ).toMatchObject({
      shouldRetry: false,
      retrySuppressedReason: 'non_retryable_category',
    });
  });

  it.each([
    'request_too_large',
    'attachment_media_type_unsupported',
    'tool_schema_invalid',
    'prompt_tokenization_failed',
    'provider_resource_not_found',
  ] as const)('keeps %s out of the transient retry allowlist', (failure_detail) => {
    expect(
      decide({
        failure: {
          failure_category: failure_detail === 'request_too_large'
            ? 'prompt_too_large'
            : 'upstream_unavailable',
          failure_detail,
          failure_stage: 'prompt_send',
          retryable: true,
        },
      }),
    ).toMatchObject({
      shouldRetry: false,
      retrySuppressedReason: 'non_retryable_category',
    });
  });

  it('uses unsafe_failure_stage for transient categories after unsafe output phases', () => {
    expect(
      decide({
        failure: {
          failure_category: 'empty_output',
          failure_detail: 'empty_output',
          failure_stage: 'artifact_write',
          retryable: true,
        },
      }),
    ).toMatchObject({
      shouldRetry: false,
      retrySuppressedReason: 'unsafe_failure_stage',
    });

    expect(
      decide({
        failure: {
          failure_category: 'timeout',
          failure_detail: 'inactivity_timeout',
          failure_stage: 'child_close',
          retryable: true,
        },
      }),
    ).toMatchObject({
      shouldRetry: false,
      retrySuppressedReason: 'unsafe_failure_stage',
    });

    for (const failure_stage of ['tool_outstanding', 'post_tool_resume'] as const) {
      expect(
        decide({
          failure: {
            failure_category: 'timeout',
            failure_detail: 'inactivity_timeout',
            failure_stage,
            retryable: true,
          },
        }),
      ).toMatchObject({
        shouldRetry: false,
        retrySuppressedReason: 'unsafe_failure_stage',
      });
    }
  });

  it('does not retry successful or cancelled terminal results', () => {
    expect(decide({ result: 'success' })).toMatchObject({
      shouldRetry: false,
      retrySuppressedReason: 'not_failed',
    });
    expect(decide({ result: 'cancelled' })).toMatchObject({
      shouldRetry: false,
      retrySuppressedReason: 'not_failed',
    });
  });

  it('requires the classifier retryable signal', () => {
    expect(
      decide({
        failure: {
          failure_category: 'upstream_unavailable',
          failure_detail: 'upstream_5xx',
          failure_stage: 'first_token_wait',
          retryable: false,
        },
      }),
    ).toMatchObject({
      shouldRetry: false,
      retrySuppressedReason: 'not_retryable',
    });
  });

  it('suppresses missing classifier signals separately from non-retryable failures', () => {
    expect(
      decideSafeRunRetry({
        result: 'failed',
        attemptCount: 0,
      }),
    ).toMatchObject({
      shouldRetry: false,
      retrySuppressedReason: 'missing_failure_signal',
    });
  });

  it('suppresses non-transient categories even when the classifier marks them retryable', () => {
    for (const failure_category of [
      'auth',
      'prompt_too_large',
      'model_unavailable',
      'tool_error',
      'process_exit',
      'unknown',
    ] as const) {
      expect(
        decide({
          failure: {
            failure_category,
            failure_stage: 'tool_execution',
            retryable: true,
          },
        }),
      ).toMatchObject({
        shouldRetry: false,
        retrySuppressedReason: 'non_retryable_category',
      });
    }
  });

  it('allows at most one automatic same-run retry by default', () => {
    expect(decide({ attemptCount: 0 })).toMatchObject({
      shouldRetry: true,
      retryAttemptIndex: 1,
      retryMaxAttempts: DEFAULT_SAFE_RUN_RETRY_MAX_ATTEMPTS,
    });
    expect(decide({ attemptCount: 1 })).toMatchObject({
      shouldRetry: false,
      retryAttemptIndex: 2,
      retryMaxAttempts: DEFAULT_SAFE_RUN_RETRY_MAX_ATTEMPTS,
      retrySuppressedReason: 'attempt_limit_reached',
    });
  });

  it('stops at the configured attempt limit', () => {
    expect(decide({ attemptCount: 1, maxAttempts: 2 })).toMatchObject({
      shouldRetry: true,
      retryAttemptIndex: 2,
      retryMaxAttempts: 2,
    });
    expect(decide({ attemptCount: 2, maxAttempts: 2 })).toMatchObject({
      shouldRetry: false,
      retryAttemptIndex: 3,
      retryMaxAttempts: 2,
      retrySuppressedReason: 'attempt_limit_reached',
    });
  });

  it('suppresses retries when cancellation was requested', () => {
    expect(decide({ sideEffects: { cancelRequested: true } })).toMatchObject({
      shouldRetry: false,
      retrySuppressedReason: 'cancel_requested',
    });
  });

  it('never auto-retries a cpu_unsupported crash even when marked retryable', () => {
    // An AVX2-requiring binary on a CPU without AVX2 crashes deterministically;
    // the process_exit allowlist must keep cpu_unsupported out even if an
    // upstream retryable hint leaks in as true.
    expect(
      decide({
        failure: {
          failure_category: 'process_exit',
          failure_detail: 'cpu_unsupported',
          failure_stage: 'session_init',
          retryable: true,
        },
      }),
    ).toMatchObject({
      shouldRetry: false,
      retrySuppressedReason: 'non_retryable_category',
    });
  });

  it('never auto-retries process kills, crashes, or interruptions', () => {
    for (const failure_detail of [
      'signal_killed',
      'process_crashed',
      'interrupted',
    ] as const) {
      expect(
        decide({
          failure: {
            failure_category: 'process_exit',
            failure_detail,
            failure_stage: 'child_close',
            retryable: false,
          },
        }).shouldRetry,
      ).toBe(false);
    }
  });

  it('attaches an exponential backoff delay to retry decisions', () => {
    // rate_limit uses the larger base; equal jitter floor (random → 0) is base/2.
    const rateLimit = decide({
      failure: {
        failure_category: 'rate_limit',
        failure_detail: 'rate_limit_429',
        failure_stage: 'session_init',
        retryable: true,
      },
      random: () => 0,
    });
    expect(rateLimit).toMatchObject({
      shouldRetry: true,
      retryDelayMs: RATE_LIMIT_RETRY_BASE_DELAY_MS / 2,
    });

    // Other transient classes use the smaller base.
    expect(decide({ random: () => 0 })).toMatchObject({
      shouldRetry: true,
      retryDelayMs: TRANSIENT_RETRY_BASE_DELAY_MS / 2,
    });
  });
});

describe('decidePostToolResumeRecovery', () => {
  it('allows one native-session continuation after a completed tool result stalls', () => {
    expect(decidePostToolResume()).toEqual({
      shouldRetry: true,
      retryAttemptIndex: 1,
      retryMaxAttempts: DEFAULT_SAFE_RUN_RETRY_MAX_ATTEMPTS,
      retryStrategy: NATIVE_SESSION_CONTINUE_STRATEGY,
      retryReason: 'post_tool_resume',
      retryDelayMs: 0,
    });
  });

  it('requires the exact post-tool timeout, a native session, and a committed tool call', () => {
    expect(decidePostToolResume({
      failure: {
        failure_category: 'timeout',
        failure_detail: 'inactivity_timeout',
        failure_stage: 'tool_outstanding',
        retryable: true,
      },
    })).toBeNull();
    expect(decidePostToolResume({ supportsNativeSessionContinue: false })).toBeNull();
    expect(decidePostToolResume({ hasNativeSession: false })).toBeNull();
    expect(decidePostToolResume({ sideEffects: { toolCallSeen: false } })).toBeNull();
  });

  it.each([
    'upstream_5xx',
    'stream_disconnected',
    'provider_high_demand',
    'provider_routing_error',
    'network_error',
  ] as const)(
    'continues the native session after a retryable post-tool %s failure',
    (failureDetail) => {
      expect(decidePostToolResume({
        failure: {
          failure_category: 'upstream_unavailable',
          failure_detail: failureDetail,
          failure_stage: 'post_tool_resume',
          retryable: true,
        },
      })).toMatchObject({
        shouldRetry: true,
        retryStrategy: NATIVE_SESSION_CONTINUE_STRATEGY,
        retryReason: 'post_tool_resume',
      });
    },
  );

  it('does not loop after the single continuation attempt', () => {
    expect(decidePostToolResume({ continuationAttemptCount: 1 })).toBeNull();
  });

  it('keeps the continuation budget independent from prior safe retries', () => {
    expect(decidePostToolResume({ totalRetryAttemptCount: 1 })).toMatchObject({
      shouldRetry: true,
      retryAttemptIndex: 2,
      retryMaxAttempts: 2,
      retryStrategy: NATIVE_SESSION_CONTINUE_STRATEGY,
    });
  });
});

// C19: a Codex run failed after ~20 minutes of work because the model provider
// answered "high demand"; one immediate retry hit the same wall. A busy
// provider clears in minutes, not milliseconds, so this one detail gets a
// larger budget and a backoff that spreads the attempts over a couple of
// minutes. Every other category keeps its single attempt.
describe('provider busy (provider_high_demand) retries', () => {
  const busyBeforeOutput = {
    failure_category: 'upstream_unavailable',
    failure_detail: 'provider_high_demand',
    failure_stage: 'first_token_wait',
    retryable: true,
  } as const;
  const busyAfterTools = {
    ...busyBeforeOutput,
    failure_stage: 'post_tool_resume',
  } as const;

  it('retries a busy provider more than once before the run fails', () => {
    for (let attemptCount = 0; attemptCount < PROVIDER_BUSY_RETRY_MAX_ATTEMPTS; attemptCount += 1) {
      expect(decide({ failure: busyBeforeOutput, attemptCount })).toMatchObject({
        shouldRetry: true,
        retryAttemptIndex: attemptCount + 1,
        retryMaxAttempts: PROVIDER_BUSY_RETRY_MAX_ATTEMPTS,
      });
    }
    expect(PROVIDER_BUSY_RETRY_MAX_ATTEMPTS).toBeGreaterThan(1);
    expect(
      decide({ failure: busyBeforeOutput, attemptCount: PROVIDER_BUSY_RETRY_MAX_ATTEMPTS }),
    ).toMatchObject({
      shouldRetry: false,
      retrySuppressedReason: 'attempt_limit_reached',
      retryMaxAttempts: PROVIDER_BUSY_RETRY_MAX_ATTEMPTS,
    });
  });

  it('keeps every other transient detail at a single attempt', () => {
    expect(decide({ attemptCount: 1 })).toMatchObject({
      shouldRetry: false,
      retrySuppressedReason: 'attempt_limit_reached',
      retryMaxAttempts: DEFAULT_SAFE_RUN_RETRY_MAX_ATTEMPTS,
    });
    expect(decidePostToolResume({ continuationAttemptCount: 1 })).toBeNull();
  });

  it('waits longer before each attempt, spreading them over a couple of minutes', () => {
    const ceilings = [] as number[];
    const floors = [] as number[];
    for (let attemptCount = 0; attemptCount < PROVIDER_BUSY_RETRY_MAX_ATTEMPTS; attemptCount += 1) {
      const high = decide({ failure: busyBeforeOutput, attemptCount, random: () => 1 });
      const low = decide({ failure: busyBeforeOutput, attemptCount, random: () => 0 });
      if (!high.shouldRetry || !low.shouldRetry) throw new Error('expected a retry');
      ceilings.push(high.retryDelayMs);
      floors.push(low.retryDelayMs);
    }
    for (let i = 1; i < ceilings.length; i += 1) {
      expect(ceilings[i]!).toBeGreaterThan(ceilings[i - 1]!);
    }
    expect(ceilings[0]).toBe(PROVIDER_BUSY_RETRY_BASE_DELAY_MS);
    expect(Math.max(...ceilings)).toBeLessThanOrEqual(MAX_PROVIDER_BUSY_RETRY_DELAY_MS);
    const shortestTotal = floors.reduce((sum, delay) => sum + delay, 0);
    const longestTotal = ceilings.reduce((sum, delay) => sum + delay, 0);
    expect(shortestTotal).toBeGreaterThanOrEqual(60_000);
    expect(longestTotal).toBeLessThanOrEqual(180_000);
  });

  it('continues the native session after tools more than once, with the same backoff', () => {
    const delays = [] as number[];
    for (
      let continuationAttemptCount = 0;
      continuationAttemptCount < PROVIDER_BUSY_RETRY_MAX_ATTEMPTS;
      continuationAttemptCount += 1
    ) {
      const decision = decidePostToolResume({
        failure: busyAfterTools,
        continuationAttemptCount,
        totalRetryAttemptCount: continuationAttemptCount,
        random: () => 1,
      });
      expect(decision).toMatchObject({
        shouldRetry: true,
        retryAttemptIndex: continuationAttemptCount + 1,
        retryMaxAttempts: PROVIDER_BUSY_RETRY_MAX_ATTEMPTS,
        retryStrategy: NATIVE_SESSION_CONTINUE_STRATEGY,
      });
      delays.push(decision!.retryDelayMs);
    }
    expect(delays[0]).toBe(PROVIDER_BUSY_RETRY_BASE_DELAY_MS);
    for (let i = 1; i < delays.length; i += 1) {
      expect(delays[i]!).toBeGreaterThan(delays[i - 1]!);
    }
    expect(decidePostToolResume({
      failure: busyAfterTools,
      continuationAttemptCount: PROVIDER_BUSY_RETRY_MAX_ATTEMPTS,
      totalRetryAttemptCount: PROVIDER_BUSY_RETRY_MAX_ATTEMPTS,
    })).toBeNull();
  });

  it('keeps an immediate continuation for other post-tool failures', () => {
    expect(decidePostToolResume({ random: () => 1 })).toMatchObject({ retryDelayMs: 0 });
  });

  it('recognises only the busy-provider detail', () => {
    expect(isProviderBusyFailure(busyBeforeOutput)).toBe(true);
    expect(isProviderBusyFailure({ ...busyBeforeOutput, failure_detail: 'upstream_5xx' })).toBe(false);
    expect(isProviderBusyFailure(undefined)).toBe(false);
  });
});

describe('providerBusyLogLine', () => {
  const failure = {
    failure_category: 'upstream_unavailable',
    failure_detail: 'provider_high_demand',
    failure_stage: 'post_tool_resume',
    retryable: true,
  } as const;

  it('names the run, the cause and the attempt when it retries', () => {
    expect(providerBusyLogLine({
      runId: 'run-123',
      outcome: 'retrying',
      failure,
      attempt: 2,
      maxAttempts: 4,
      delayMs: 20_000,
    })).toBe(
      '[runs] model provider busy; retrying run=run-123 attempt=2/4 in=20s'
        + ' category=upstream_unavailable detail=provider_high_demand stage=post_tool_resume',
    );
  });

  it('names the run, the cause and the attempts used when it fails', () => {
    expect(providerBusyLogLine({
      runId: 'run-123',
      outcome: 'failed',
      failure,
      attempt: 4,
      maxAttempts: 4,
      resumable: true,
    })).toBe(
      '[runs] model provider busy; run failed run=run-123 attempts=4/4'
        + ' category=upstream_unavailable detail=provider_high_demand stage=post_tool_resume resumable=true',
    );
  });

  it('says nothing for other failures', () => {
    expect(providerBusyLogLine({
      runId: 'run-123',
      outcome: 'failed',
      failure: { ...failure, failure_detail: 'upstream_5xx' },
      attempt: 1,
      maxAttempts: 1,
    })).toBeNull();
  });
});

describe('computeRetryBackoffMs', () => {
  it('grows exponentially by attempt index and applies equal jitter', () => {
    // random → 0 is the floor (delay/2), random → 1 is the ceiling (full delay).
    expect(computeRetryBackoffMs(1, 'rate_limit', () => 0)).toBe(
      RATE_LIMIT_RETRY_BASE_DELAY_MS / 2,
    );
    expect(computeRetryBackoffMs(1, 'rate_limit', () => 1)).toBe(
      RATE_LIMIT_RETRY_BASE_DELAY_MS,
    );
    // Attempt 2 doubles the base before jitter.
    expect(computeRetryBackoffMs(2, 'rate_limit', () => 1)).toBe(
      RATE_LIMIT_RETRY_BASE_DELAY_MS * 2,
    );
  });

  it('caps the backoff at the configured ceiling', () => {
    expect(computeRetryBackoffMs(99, 'rate_limit', () => 1)).toBe(
      MAX_RETRY_BACKOFF_DELAY_MS,
    );
  });

  it('keeps jitter within [delay/2, delay] for any random sample', () => {
    for (const sample of [0, 0.25, 0.5, 0.75, 1]) {
      const delay = computeRetryBackoffMs(2, 'upstream_unavailable', () => sample);
      const capped = Math.min(
        TRANSIENT_RETRY_BASE_DELAY_MS * 2,
        MAX_RETRY_BACKOFF_DELAY_MS,
      );
      expect(delay).toBeGreaterThanOrEqual(capped / 2);
      expect(delay).toBeLessThanOrEqual(capped);
    }
  });
});
