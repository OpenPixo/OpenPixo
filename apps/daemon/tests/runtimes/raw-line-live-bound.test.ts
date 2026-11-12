import { describe, expect, it } from 'vitest';

import { createClaudeStreamHandler } from '../../src/runtimes/claude-stream.js';
import { createJsonEventStreamHandler } from '../../src/runtimes/json-event-stream.js';

/*
 * Live-stream half of "a run event never carries an unbounded payload".
 *
 * Every stdout line a runtime parser does not recognise is handed to the SSE
 * fan-out (and the daemon's in-memory run buffer) as `{ type: 'raw', line }`.
 * Nothing renders it, yet the browser keeps it in the message it holds. The
 * line must be bounded where it is produced, by every parser that produces one,
 * not only when it is stored.
 */

/** The per-event budget (UTF-8 bytes of one event's JSON). */
const PERSISTED_EVENT_BUDGET_BYTES = 64 * 1024;

type Event = Record<string, unknown>;
type Parser = { feed(chunk: string): void; flush(): void };

const PARSERS: Array<[string, (onEvent: (event: Event) => void) => Parser]> = [
  ['claude-stream', (onEvent) => createClaudeStreamHandler(onEvent)],
  ...(['opencode', 'codex'] as const).map(
    (kind): [string, (onEvent: (event: Event) => void) => Parser] => [
      `json-event-stream (${kind})`,
      (onEvent) => createJsonEventStreamHandler(kind, onEvent),
    ],
  ),
];

function rawEventsFor(
  makeParser: (onEvent: (event: Event) => void) => Parser,
  input: string,
): Event[] {
  const events: Event[] = [];
  const parser = makeParser((event) => events.push(event));
  parser.feed(input);
  parser.flush();
  return events.filter((event) => event.type === 'raw');
}

function expectBounded(event: Event | undefined, original: string) {
  expect(event).toBeDefined();
  const line = String(event!.line);
  expect(Buffer.byteLength(JSON.stringify(event))).toBeLessThanOrEqual(PERSISTED_EVENT_BUDGET_BYTES);
  expect(line.startsWith(original.slice(0, 32))).toBe(true);
  expect(line).toContain(`of ${Buffer.byteLength(original)} bytes`);
  expect(event!.truncated).toEqual({ originalBytes: Buffer.byteLength(original) });
}

describe('raw stdout lines are bounded on the live event stream', () => {
  // Not JSON, so every parser falls through to `raw`.
  const oversizedText = `WARN unparsed agent output ${'x'.repeat(200_000)} END`;

  it.each(PARSERS)('%s bounds an oversized newline-terminated line', (_name, makeParser) => {
    const raw = rawEventsFor(makeParser, `${oversizedText}\n`);
    expect(raw).toHaveLength(1);
    expectBounded(raw[0], oversizedText);
  });

  it.each(PARSERS)('%s bounds an oversized trailing line released by flush()', (_name, makeParser) => {
    const raw = rawEventsFor(makeParser, oversizedText);
    expect(raw).toHaveLength(1);
    expectBounded(raw[0], oversizedText);
  });

  it.each(PARSERS)('%s passes a line that fits through unchanged', (_name, makeParser) => {
    const small = 'WARN a short unparsed line';
    expect(rawEventsFor(makeParser, `${small}\n`)).toEqual([{ type: 'raw', line: small }]);
  });
});
