import { describe, expect, test } from 'vitest';

import { resolveVitestToolsDevEnv } from '@/vitest/suite';

describe('Vitest tools-dev runtime environment', () => {
  test('pins the fake Codex transport while preserving explicit overrides', () => {
    expect(resolveVitestToolsDevEnv()).toMatchObject({
      PIXO_CODEX_TRANSPORT: 'exec-json',
    });
    expect(resolveVitestToolsDevEnv({ PIXO_CODEX_TRANSPORT: 'app-server' })).toMatchObject({
      PIXO_CODEX_TRANSPORT: 'app-server',
    });
  });
});
