import { describe, expect, it, vi } from 'vitest';

import { createWhatsNewService } from '../../src/services/whats-new.js';

describe('OpenPixo public network defaults', () => {
  it('never fetches upstream highlights on any channel without an explicit source', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const service = createWhatsNewService({ fetchImpl, env: {} });
    for (const channel of ['development', 'beta', 'prerelease', 'preview', 'stable']) {
      expect(await service.readWhatsNew(channel)).toMatchObject({ id: null, content: null, stale: false });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
