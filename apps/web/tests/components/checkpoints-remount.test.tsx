// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useProjectCheckpoints } from '../../src/components/checkpoints/useProjectCheckpoints';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

// Switching conversations remounts every message. Each one must draw with the
// project's last checkpoint list in its first render; drawing once without it
// and again when the list arrives moves the conversation under the reader.
it('starts a remounted reader from the project\'s last answered list', async () => {
  const list = { status: 'available', busy: false, checkpoints: [{ id: 'c1', runId: 'r1' }] };
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(list), { status: 200 })));
  const firstRenders: unknown[] = [];
  function Reader({ id }: { id: string }) {
    const { data } = useProjectCheckpoints('remount-project', true, { poll: false });
    if (firstRenders.length < Number(id)) firstRenders.push(data ?? null);
    return null;
  }
  const first = render(<Reader id="1" />);
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  first.unmount();
  render(<Reader id="2" />);
  expect(firstRenders[0]).toBeNull();
  expect(firstRenders[1]).toEqual(list);
});
