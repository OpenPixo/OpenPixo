// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { clearProjectComposerPrefill, queueProjectComposerPrefill, subscribeProjectComposerPrefill, takeProjectComposerPrefill } from '../../src/state/composer-prefill';

afterEach(() => { clearProjectComposerPrefill('first'); clearProjectComposerPrefill('second'); sessionStorage.clear(); });

describe('project composer prefill', () => {
  it('hands a draft to its project once without sending it', () => {
    queueProjectComposerPrefill('first', 'Create a knight sprite');
    expect(takeProjectComposerPrefill('second')).toBeUndefined();
    expect(takeProjectComposerPrefill('first')?.text).toBe('Create a knight sprite');
    expect(takeProjectComposerPrefill('first')).toBeUndefined();
  });

  it('gives repeated examples distinct draft signals', () => {
    queueProjectComposerPrefill('first', 'Same example');
    const first = takeProjectComposerPrefill('first');
    queueProjectComposerPrefill('first', 'Same example');
    expect(takeProjectComposerPrefill('first')?.nonce).not.toBe(first?.nonce);
  });

  it('tells an open project about a draft queued for it, and no other project', () => {
    const seen: (string | undefined)[] = [];
    const stop = subscribeProjectComposerPrefill('first', () => seen.push(takeProjectComposerPrefill('first')?.text));
    queueProjectComposerPrefill('second', 'Not yours');
    expect(seen).toEqual([]);
    queueProjectComposerPrefill('first', 'Add multiplayer');
    expect(seen).toEqual(['Add multiplayer']);
    stop();
    queueProjectComposerPrefill('first', 'After closing');
    expect(seen).toEqual(['Add multiplayer']);
    expect(takeProjectComposerPrefill('first')?.text).toBe('After closing');
  });
});
