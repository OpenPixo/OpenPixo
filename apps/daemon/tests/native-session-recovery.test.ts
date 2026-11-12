import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  initialNativeSessionRecoveryMetadata,
  markNativeSessionAutoReseeded,
  markNativeSessionCaptured,
  redactNativeSessionHandle,
} from '../src/native-session-recovery.js';

describe('native session recovery metadata', () => {
  it('redacts raw native session handles while preserving a support correlation hash', () => {
    const rawSessionId = 'codex-thread-secret-123';
    const handle = redactNativeSessionHandle({
      agentId: 'codex',
      sessionId: rawSessionId,
    });

    expect(handle).toEqual({
      present: true,
      kind: 'cli-thread-id',
      display: null,
      sha256: createHash('sha256').update(rawSessionId, 'utf8').digest('hex'),
      redacted: true,
    });
    expect(JSON.stringify(handle)).not.toContain(rawSessionId);
  });

  it('marks retired saved agent ids as not applicable without a handle', () => {
    const metadata = initialNativeSessionRecoveryMetadata({
      agent: { id: 'hermes' },
      supportsSessionResume: false,
      isResuming: false,
      resumeSessionId: null,
      invalidationReason: null,
      updatedAt: 100,
    });

    expect(metadata).toMatchObject({
      agentId: 'hermes',
      state: 'not_applicable',
      acquisition: 'none',
      continuation: 'none',
      guardReason: 'unsupported',
      handle: { present: false, kind: 'opaque-id', display: null, sha256: null, redacted: false },
      updatedAt: 100,
    });
  });

  it('describes daemon-specified Claude sessions and native resume by id', () => {
    const rawSessionId = 'claude-private-session-id';
    const metadata = initialNativeSessionRecoveryMetadata({
      agent: { id: 'claude', resumesSessionViaCli: true },
      supportsSessionResume: true,
      isResuming: true,
      resumeSessionId: rawSessionId,
      invalidationReason: null,
      updatedAt: 300,
    });

    expect(metadata).toMatchObject({
      agentId: 'claude',
      state: 'resume_attempted',
      acquisition: 'daemon-specified',
      continuation: 'native-resume-by-id',
      handle: { present: true, kind: 'opaque-id', display: null, redacted: true },
    });
    expect(metadata.handle.sha256).toBe(createHash('sha256').update(rawSessionId, 'utf8').digest('hex'));
    expect(JSON.stringify(metadata)).not.toContain(rawSessionId);
  });

  it('classifies stream-captured CLI handles from runtime capabilities', () => {
    const rawSessionId = 'ses_opencode_capture_123';
    const initial = initialNativeSessionRecoveryMetadata({
      agent: { id: 'opencode', resumesSessionViaCli: true, capturesSessionIdFromStream: true },
      supportsSessionResume: true,
      isResuming: false,
      resumeSessionId: null,
      invalidationReason: null,
      updatedAt: 350,
    });
    const captured = markNativeSessionCaptured({
      previous: initial,
      agentId: 'opencode',
      sessionId: rawSessionId,
      resumed: false,
      updatedAt: 360,
    });

    expect(initial).toMatchObject({
      acquisition: 'stream-captured',
      continuation: 'native-resume-by-id',
      handle: { present: false, kind: 'cli-thread-id' },
    });
    expect(captured).toMatchObject({
      agentId: 'opencode',
      state: 'captured_not_resumed',
      handle: { present: true, kind: 'cli-thread-id', display: null, redacted: true },
    });
    expect(captured.handle.sha256).toBe(createHash('sha256').update(rawSessionId, 'utf8').digest('hex'));
    expect(JSON.stringify(captured)).not.toContain(rawSessionId);
  });

  it('distinguishes skipped, captured, resumed, and auto-reseeded states', () => {
    const skipped = initialNativeSessionRecoveryMetadata({
      agent: { id: 'codex', resumesSessionViaCli: true, capturesSessionIdFromStream: true },
      supportsSessionResume: true,
      isResuming: false,
      resumeSessionId: null,
      storedSessionId: 'stored-thread-id',
      invalidationReason: 'model_changed',
      updatedAt: 400,
    });
    const captured = markNativeSessionCaptured({
      previous: skipped,
      agentId: 'codex',
      sessionId: 'new-thread-id',
      resumed: false,
      updatedAt: 500,
    });
    const resumed = markNativeSessionCaptured({
      previous: captured,
      agentId: 'codex',
      sessionId: 'new-thread-id',
      resumed: true,
      updatedAt: 600,
    });
    const reseeded = markNativeSessionAutoReseeded({
      previous: resumed,
      agentId: 'codex',
      previousSessionId: 'new-thread-id',
      updatedAt: 700,
    });

    expect(skipped).toMatchObject({
      state: 'resume_skipped',
      guardReason: 'model_changed',
      handle: { present: true, kind: 'cli-thread-id', display: null, redacted: true },
    });
    expect(captured).toMatchObject({
      state: 'captured_not_resumed',
      guardReason: null,
      handle: { present: true, kind: 'cli-thread-id' },
    });
    expect(resumed).toMatchObject({ state: 'resumed' });
    expect(reseeded).toMatchObject({
      state: 'auto_reseeded',
      fallbackReason: 'resume_failed',
    });
    expect(JSON.stringify(reseeded)).not.toContain('new-thread-id');
    expect(JSON.stringify(skipped)).not.toContain('stored-thread-id');
  });
});
