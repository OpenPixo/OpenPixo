import { describe, expect, it } from 'vitest';
import { readTelemetryEnvironment } from '../src/telemetry-environment.js';

describe('telemetry environment channels', () => {
  it('accepts an injected packaged runtime without relying on the host', () => {
    expect(readTelemetryEnvironment({}, true)).toBe('production');
  });
  it.each([
    [{}, 'development'],
    [{ NODE_ENV: 'development' }, 'development'],
    [{ NODE_ENV: 'test' }, 'test'],
    [{ NODE_ENV: 'production' }, 'production'],
    [{ PIXO_APP_VERSION: '1.2.3-beta.1' }, 'production'],
    [{ PIXO_APP_VERSION: '1.2.3-prerelease.1' }, 'production'],
    [{ PIXO_APP_VERSION: '1.2.3' }, 'production'],
    [{ PIXO_APP_VERSION: '1.2.3', NODE_ENV: 'test' }, 'test'],
    [{ PIXO_APP_VERSION: '1.2.3', NODE_ENV: 'development' }, 'development'],
    [{ PIXO_TELEMETRY_ENV: ' qa ', NODE_ENV: 'production' }, 'qa'],
    [{ PIXO_TELEMETRY_ENV: ' ', PIXO_ENV: 'test', POSTHOG_ENV: 'other' }, 'test'],
  ])('reports %j as %s', (env, expected) => {
    expect(readTelemetryEnvironment(env, false)).toBe(expected);
  });
});
