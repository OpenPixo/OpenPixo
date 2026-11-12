// @vitest-environment jsdom
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseRoute } from '../../src/router';


afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('OpenPixo navigation surfaces', () => {
  

  

  it('omits retired navigation targets', () => {
    for (const path of ['/design-systems', '/design-systems/create', '/brands/test', '/collab-demo', '/workspace-settings']) {
      expect(parseRoute(path)).toEqual({ kind: 'home', view: 'home' });
    }
  });
});
