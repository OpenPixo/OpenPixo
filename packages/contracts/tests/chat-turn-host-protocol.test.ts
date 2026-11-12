import { describe, expect, it } from 'vitest';

import { renderChatTurnHostProtocolInstructions } from '../src/prompts/chat-turn-host-protocol.js';

const KEY = '0123456789abcdef';

describe('chat turn host protocol', () => {
  it('renders the same keyed done, next-step, and focus protocol for ordinary chat', () => {
    const result = renderChatTurnHostProtocolInstructions(KEY);

    expect(result.doneMarker).toContain(`<pixo-done key="${KEY}"/>`);
    expect(result.nextSteps).toContain(`<pixo-next key="${KEY}" value="Add an orders list page"/>`);
    expect(result.nextSteps).not.toContain('</pixo-next>');
    expect(result.artifactFocus).toContain(`<pixo-focus key="${KEY}"`);
    expect(result.text).not.toContain('OD Next host handoff gate');
  });
});
