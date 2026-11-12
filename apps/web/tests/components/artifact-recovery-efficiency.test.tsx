// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createArtifactParser } from '../../src/artifacts/parser';
import { hasRecoverableArtifactMessage } from '../../src/components/ProjectView';
import type { ChatMessage } from '../../src/types';

vi.mock('../../src/artifacts/parser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/artifacts/parser')>();
  return { ...actual, createArtifactParser: vi.fn(actual.createArtifactParser) };
});

const HTML = `<!doctype html><html><head><title>Game</title></head><body>${'<p>level</p>'.repeat(40)}</body></html>`;

function finishedReply(content: string): ChatMessage {
  return {
    id: 'finished',
    role: 'assistant',
    content,
    createdAt: 1,
    runId: 'run-finished',
    runStatus: 'succeeded',
  } satisfies ChatMessage;
}

function parses() {
  return vi.mocked(createArtifactParser).mock.calls.length;
}

describe('recoverable-artifact eligibility while another row streams', () => {
  afterEach(() => {
    vi.mocked(createArtifactParser).mockClear();
  });

  it('parses an unchanged finished reply once across 50 streamed updates', () => {
    const finished = finishedReply('A long reply with no artifact and no files. '.repeat(200));
    let streaming: ChatMessage = {
      id: 'streaming', role: 'assistant', content: '', createdAt: 2, runId: 'run-live', runStatus: 'running',
    };

    for (let update = 0; update < 50; update += 1) {
      streaming = { ...streaming, content: `${streaming.content}more ` };
      const messages = [finished, streaming];
      expect(messages.some((message) => hasRecoverableArtifactMessage(message))).toBe(false);
    }

    expect(parses()).toBe(1);
  });

  it('remembers a positive verdict too', () => {
    const finished = finishedReply(HTML);

    expect(hasRecoverableArtifactMessage(finished)).toBe(true);
    expect(hasRecoverableArtifactMessage(finished)).toBe(true);

    expect(parses()).toBe(1);
  });

  it('asks again for a new message object, because its text may differ', () => {
    const prose = finishedReply('just prose');
    expect(hasRecoverableArtifactMessage(prose)).toBe(false);

    expect(hasRecoverableArtifactMessage({ ...prose, content: HTML })).toBe(true);
    expect(parses()).toBe(2);
  });

  it('does not let a remembered verdict outlive the cheap checks on a new object', () => {
    const finished = finishedReply(HTML);
    expect(hasRecoverableArtifactMessage(finished)).toBe(true);

    const delivered = { ...finished, producedFiles: [{ name: 'game.html' } as never] };
    expect(hasRecoverableArtifactMessage(delivered)).toBe(false);
    expect(parses()).toBe(1);
  });

  it('never parses a row that is not eligible on its fields alone', () => {
    const running = { ...finishedReply(HTML), runStatus: 'running' } satisfies ChatMessage;
    const user = { ...finishedReply(HTML), role: 'user' } satisfies ChatMessage;

    expect(hasRecoverableArtifactMessage(running)).toBe(false);
    expect(hasRecoverableArtifactMessage(user)).toBe(false);
    expect(parses()).toBe(0);
  });
});
