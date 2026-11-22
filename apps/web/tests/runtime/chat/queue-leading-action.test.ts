import { describe, expect, it } from 'vitest';

import { queuedLeadingAction, queuedRowCarriesMoreThanText } from '../../../src/runtime/chat/queue-leading-action';

describe('queuedLeadingAction', () => {
  it('just sends when nothing is running', () => {
    expect(queuedLeadingAction({ turnInFlight: false, midTurnSteering: true, row: {} })).toBe('send-now');
    expect(queuedLeadingAction({ turnInFlight: false, midTurnSteering: false, row: {} })).toBe('send-now');
  });

  it('steers a plain-text row only when the daemon says the turn can take it', () => {
    expect(queuedLeadingAction({ turnInFlight: true, midTurnSteering: true, row: {} })).toBe('steer');
    expect(queuedLeadingAction({ turnInFlight: true, midTurnSteering: false, row: {} })).toBe('stop-and-send');
  });

  it('stops and sends a row that carries more than text', () => {
    expect(queuedLeadingAction({
      turnInFlight: true,
      midTurnSteering: true,
      row: { attachments: [{ path: 'a.png' }] },
    })).toBe('stop-and-send');
  });
});

describe('queuedRowCarriesMoreThanText', () => {
  it('is false for text with empty extras', () => {
    expect(queuedRowCarriesMoreThanText({})).toBe(false);
    expect(queuedRowCarriesMoreThanText({ attachments: [], meta: { skillIds: [], context: { skillIds: [], workspaceItems: [] } } })).toBe(false);
  });

  it('is true for files, skills, plugins, research or selected context', () => {
    expect(queuedRowCarriesMoreThanText({ attachments: [{}] })).toBe(true);
    expect(queuedRowCarriesMoreThanText({ meta: { skillIds: ['hud'] } })).toBe(true);
    expect(queuedRowCarriesMoreThanText({ meta: { appliedPluginSnapshotId: 'snap-1' } })).toBe(true);
    expect(queuedRowCarriesMoreThanText({ meta: { research: { enabled: true } } })).toBe(true);
    expect(queuedRowCarriesMoreThanText({ meta: { context: { workspaceItems: [{ kind: 'project' }] } } })).toBe(true);
  });
});
