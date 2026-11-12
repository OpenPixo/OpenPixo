// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  closeSetupGate,
  homeSubmitOpensSetup,
  newGameNeedsSetup,
  setupGateClosed,
} from '../../src/components/new-game/setup-routing';

const image = new File(['x'], 'cave.png', { type: 'image/png' });

afterEach(() => sessionStorage.clear());

describe('homeSubmitOpensSetup', () => {
  it('sends a plain idea, with or without images, to the setup dialog', () => {
    expect(homeSubmitOpensSetup({ projectKind: 'other' })).toBe(true);
    expect(homeSubmitOpensSetup({ projectKind: 'prototype', attachments: [image] })).toBe(true);
    expect(homeSubmitOpensSetup({ projectKind: 'other', contextPlugins: [], linkedDirs: [], contextMcpServers: [] })).toBe(true);
  });

  it('leaves projects that are not games alone', () => {
    for (const projectKind of ['image', 'video', 'audio']) {
      expect(homeSubmitOpensSetup({ projectKind })).toBe(false);
    }
    expect(homeSubmitOpensSetup({ projectKind: 'other', projectMetadata: { kind: 'other', skipDiscoveryBrief: true } })).toBe(false);
  });

  it('keeps starts that bind to a project the dialog cannot make', () => {
    expect(homeSubmitOpensSetup({ projectKind: 'other', pluginId: 'plugin' })).toBe(false);
    expect(homeSubmitOpensSetup({ projectKind: 'other', appliedPluginSnapshotId: 'snapshot' })).toBe(false);
    expect(homeSubmitOpensSetup({ projectKind: 'other', skillId: 'skill' })).toBe(false);
    expect(homeSubmitOpensSetup({ projectKind: 'other', workingDir: 'C:\\Games\\fox' })).toBe(false);
    expect(homeSubmitOpensSetup({ projectKind: 'other', linkedDirs: ['C:\\Art'] })).toBe(false);
    expect(homeSubmitOpensSetup({ projectKind: 'other', contextPlugins: [{ id: 'x' }] })).toBe(false);
    expect(homeSubmitOpensSetup({ projectKind: 'other', initialRunContext: { workspaceItems: [] } })).toBe(false);
  });

  it('keeps attachments the setup could not carry as references', () => {
    const notes = new File(['x'], 'notes.pdf', { type: 'application/pdf' });
    expect(homeSubmitOpensSetup({ projectKind: 'other', attachments: [notes] })).toBe(false);
    expect(homeSubmitOpensSetup({ projectKind: 'other', attachments: Array.from({ length: 7 }, () => image) })).toBe(false);
  });
});

describe('newGameNeedsSetup', () => {
  const complete = { genre: 'x', platforms: ['web' as const], art: { styleId: 'a' }, display: { width: 640, height: 360 }, controls: ['mouse' as const] };
  const planning = { status: 'planning' as const, startedAt: 1 };

  it('is true only for a game about to be planned with an unfinished setup', () => {
    expect(newGameNeedsSetup({ gamePlan: planning })).toBe(true);
    expect(newGameNeedsSetup({ gamePlan: planning, gameSetup: { genre: 'x' } })).toBe(true);
    expect(newGameNeedsSetup({ gamePlan: planning, gameSetup: complete })).toBe(false);
    expect(newGameNeedsSetup({ gamePlan: { status: 'approved', startedAt: 1, approvedAt: 2 } })).toBe(false);
    // An imported game has no plan state, so nothing interrupts it.
    expect(newGameNeedsSetup({})).toBe(false);
    expect(newGameNeedsSetup(null)).toBe(false);
  });

  it('remembers that the user closed it for this session, per project', () => {
    expect(setupGateClosed('a')).toBe(false);
    closeSetupGate('a');
    expect(setupGateClosed('a')).toBe(true);
    expect(setupGateClosed('b')).toBe(false);
  });
});
