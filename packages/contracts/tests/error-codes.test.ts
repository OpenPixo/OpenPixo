import { describe, expect, it } from 'vitest';

import { API_ERROR_CODES, type ApiErrorCode } from '../src/errors';

describe('shared API error codes', () => {
  it('exposes local project lifecycle failure codes', () => {
    expect(API_ERROR_CODES).toEqual(expect.arrayContaining([
      'PROJECT_NOT_FOUND',
      'PROJECT_MATERIALIZATION_PENDING',
      'PROJECT_CREATE_PREPARATION_TIMEOUT',
    ]));
  });

  it('omits the retired team-workspace project-creation codes', () => {
    for (const code of ['WORKSPACE_CONTEXT_INCOMPLETE', 'WORKSPACE_PROJECT_PERMISSION_DENIED', 'WORKSPACE_AUTHORITY_UNAVAILABLE']) {
      expect(API_ERROR_CODES).not.toContain(code);
    }
  });

  it('exposes AGENT_RUNTIME_DEF_INVALID for runtime-def validation failures', () => {
    // Chat-run startup emits this code through the shared SSE/status error
    // envelopes when a checked-in runtime def is invalid. Keeping the
    // assertion in the contracts package ensures contract-only refactors
    // cannot drop the literal without this package's own test lane failing.
    expect(API_ERROR_CODES).toContain('AGENT_RUNTIME_DEF_INVALID');
  });

  it('keeps AGENT_RUNTIME_DEF_INVALID assignable to ApiErrorCode', () => {
    const code: ApiErrorCode = 'AGENT_RUNTIME_DEF_INVALID';
    expect(code).toBe('AGENT_RUNTIME_DEF_INVALID');
  });
});
