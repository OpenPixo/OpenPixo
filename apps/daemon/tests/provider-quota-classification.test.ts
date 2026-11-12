import { describe, expect, it } from 'vitest';
import { classifyRunFailure } from '../src/run-failure-classification.js';

describe('external provider quota after cloud removal', () => {
  it.each([
    'Insufficient Balance',
    'insufficient wallet balance',
    'account balance too low',
    '余额不足',
    'Your workspace is out of credits. Add credits to continue.',
    'You exceeded your current quota (insufficient_quota)',
  ])('keeps %s a non-retryable provider quota failure', (text) => {
    expect(classifyRunFailure({
      result: 'failed',
      agentId: 'byok-opencode',
      status: { status: 'failed', error: text, errorCode: 'AGENT_EXECUTION_FAILED' },
      events: [{ event: 'error', data: { message: text } }],
    })).toMatchObject({
      failure_category: 'rate_limit',
      failure_detail: 'hard_quota',
      retryable: false,
      user_action: 'none',
    });
  });

  it('keeps a real throttle retryable', () => {
    expect(classifyRunFailure({
      result: 'failed',
      agentId: 'opencode',
      status: { status: 'failed', error: 'HTTP 429 Too Many Requests', errorCode: 'RATE_LIMITED' },
      events: [],
    })).toMatchObject({ failure_detail: 'rate_limit_429', retryable: true });
  });
});
