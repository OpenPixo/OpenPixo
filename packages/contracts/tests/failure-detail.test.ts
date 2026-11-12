import { describe, expect, it } from 'vitest';
import {
  normalizeClientRequestId,
  normalizeUpstreamCode,
  parseApiFailureDetail,
} from '../src/api/failure-detail.js';

describe('parseApiFailureDetail', () => {
  it('keeps known tokens and bounded numbers', () => {
    expect(parseApiFailureDetail({
      stage: 'provider', reason: 'provider_unreachable', upstreamStatus: 503, upstreamCode: 'provider_unavailable',
    })).toEqual({ stage: 'provider', reason: 'provider_unreachable', upstreamStatus: 503, upstreamCode: 'provider_unavailable' });
  });

  it('keeps local file failures without copying free text', () => {
    expect(parseApiFailureDetail({ stage: 'file_plan', reason: 'local_file', message: 'private text' }))
      .toEqual({ stage: 'file_plan', reason: 'local_file' });
  });

  it.each(['session_setup', 'session_cleanup', 'invalid_receipt', 'upstream_http'])('rejects retired share failure reason %s', reason => {
    expect(parseApiFailureDetail({ stage: 'provider', reason })).toBeUndefined();
  });

  it.each(['push', 'snapshot', 'persist', 'redact'])('rejects retired publication stage %s', stage => {
    expect(parseApiFailureDetail({ stage, reason: 'internal' })).toBeUndefined();
  });

  it('rejects unknown stages or reasons', () => {
    expect(parseApiFailureDetail({ stage: 'provider', reason: 'see the logs' })).toBeUndefined();
    expect(parseApiFailureDetail({ stage: 'upload', reason: 'internal' })).toBeUndefined();
    expect(parseApiFailureDetail('push')).toBeUndefined();
    expect(parseApiFailureDetail([])).toBeUndefined();
  });

  it('drops optional fields that are not token-shaped', () => {
    expect(parseApiFailureDetail({
      stage: 'provider', reason: 'provider_rejected', upstreamStatus: 42, upstreamCode: 'has space',
    })).toEqual({ stage: 'provider', reason: 'provider_rejected' });
  });
});

describe('token normalizers', () => {
  it('accepts numeric provider codes as strings', () => {
    expect(normalizeUpstreamCode(6003)).toBe('6003');
    expect(normalizeUpstreamCode('https://x/y')).toBeUndefined();
  });

  it('accepts only token-shaped request ids', () => {
    expect(normalizeClientRequestId('4b1c2d3e-aaaa-bbbb-cccc-000000000001')).toBe('4b1c2d3e-aaaa-bbbb-cccc-000000000001');
    expect(normalizeClientRequestId('short')).toBeUndefined();
    expect(normalizeClientRequestId('has spaces in it')).toBeUndefined();
  });
});
