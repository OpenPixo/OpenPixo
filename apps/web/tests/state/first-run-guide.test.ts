// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  advanceFirstRunGuide,
  closeFirstRunHint,
  declineFirstRunGuide,
  finishFirstRunGuide,
  publishFirstRunGuide,
  readFirstRunGuide,
  resetFirstRunGuideForTests,
  resumeFirstRunGuide,
  skipFirstRunGuide,
  startFirstRunGuide,
} from '../../src/state/first-run-guide';

/** Answers each save when told to, with the config as the daemon has it then. */
function daemon() {
  const answers: ((config: unknown) => void)[] = [];
  const fetchMock = vi.fn((_url: RequestInfo | URL, _init?: RequestInit) => new Promise<Response>((resolve) => {
    answers.push((config) => resolve(Response.json({ config })));
  }));
  vi.stubGlobal('fetch', fetchMock);
  const saved = (call: number) => JSON.parse(String(fetchMock.mock.calls[call]?.[1]?.body)).firstRunGuide;
  return { fetchMock, answers, saved };
}

beforeEach(() => resetFirstRunGuideForTests());
afterEach(() => { resetFirstRunGuideForTests(); vi.unstubAllGlobals(); });

describe('the walkthrough store', () => {
  it('tells "not read yet" from "never offered"', () => {
    expect(readFirstRunGuide()).toBeUndefined();
    publishFirstRunGuide(undefined);
    expect(readFirstRunGuide()).toBeNull();
  });

  it('walks to the end, showing and saving each move', () => {
    const { fetchMock, saved } = daemon();
    startFirstRunGuide('sample');
    expect(readFirstRunGuide()).toEqual({ status: 'active', step: 'play', projectId: 'sample' });
    expect(fetchMock).toHaveBeenLastCalledWith('/api/app-config', expect.objectContaining({ method: 'PUT' }));
    advanceFirstRunGuide();
    advanceFirstRunGuide();
    advanceFirstRunGuide();
    expect(saved(3)).toEqual({ status: 'active', step: 'make', projectId: 'sample' });
    advanceFirstRunGuide();
    expect(readFirstRunGuide()).toEqual({ status: 'done', step: 'make', projectId: 'sample' });
  });

  it('goes on from where it was skipped, and starts over once finished', () => {
    daemon();
    startFirstRunGuide('sample');
    advanceFirstRunGuide();
    skipFirstRunGuide();
    expect(readFirstRunGuide()).toMatchObject({ status: 'skipped', step: 'tune' });
    resumeFirstRunGuide();
    expect(readFirstRunGuide()).toMatchObject({ status: 'active', step: 'tune', projectId: 'sample' });
    finishFirstRunGuide();
    resumeFirstRunGuide();
    expect(readFirstRunGuide()).toMatchObject({ status: 'active', step: 'play' });
  });

  it('does not let a config read from before a change undo it', async () => {
    const { answers } = daemon();
    startFirstRunGuide('sample');
    advanceFirstRunGuide();
    // App re-reads the config while both saves are still on their way.
    publishFirstRunGuide({ status: 'active', step: 'play', projectId: 'sample' });
    expect(readFirstRunGuide()).toMatchObject({ step: 'tune' });
    answers[0]!({ firstRunGuide: { status: 'active', step: 'play', projectId: 'sample' } });
    await vi.waitFor(() => expect(readFirstRunGuide()).toMatchObject({ step: 'tune' }));
    answers[1]!({ firstRunGuide: { status: 'active', step: 'tune', projectId: 'sample' } });
    // With nothing left to save, what the daemon has is what shows (`pixo config set`).
    await vi.waitFor(() => {
      publishFirstRunGuide('skipped');
      expect(readFirstRunGuide()).toMatchObject({ status: 'skipped' });
    });
  });

  it('keeps going in this window when the daemon cannot save', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    startFirstRunGuide('sample');
    await Promise.resolve();
    advanceFirstRunGuide();
    expect(readFirstRunGuide()).toMatchObject({ status: 'active', step: 'tune' });
  });

  it('closes each hint once, and gives an experienced user none', () => {
    const { fetchMock } = daemon();
    closeFirstRunHint('plan');
    expect(fetchMock).not.toHaveBeenCalled();
    startFirstRunGuide('sample');
    closeFirstRunHint('share');
    closeFirstRunHint('plan');
    closeFirstRunHint('plan');
    expect(readFirstRunGuide()).toMatchObject({ status: 'active', hintsSeen: ['plan', 'share'] });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    declineFirstRunGuide();
    expect(readFirstRunGuide()).toEqual({ status: 'skipped', step: 'play', hintsSeen: ['plan', 'art', 'stage', 'share'] });
  });
});
